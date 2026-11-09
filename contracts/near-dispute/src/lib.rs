use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};
use serde_json::json;

const MAX_QUESTION_BYTES: usize = 2000;
const ASK_GAS: Gas = Gas::from_tgas(30);
const ON_ASKED_GAS: Gas = Gas::from_tgas(15);
const RECORD_OVERHEAD_BYTES: u64 = 40;
const STORAGE_PREFIX_BYTES: u64 = 1;
const KEY_BYTES: u64 = 8;
const MAX_ACCOUNT_ID_LEN: usize = 64;
const EVENT_STANDARD: &str = "psephex-dispute";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Case {
    pub claimant: AccountId,
    pub counterparty: AccountId,
    pub amount: U128,
    pub oracle_deposit: U128,
    pub deadline_ns: U64,
    pub question: String,
    pub escalated: bool,
    pub settled: bool,
    pub winner: Option<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Dispute {
    oracle: AccountId,
    timeout_ns: u64,
    min_stake: u128,
    opening: LookupMap<u64, Case>,
    cases: LookupMap<u64, Case>,
    last_opening: u64,
}

fn emit(event: &str, data: serde_json::Value) {
    let event = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data]
    });
    env::log_str(&format!("EVENT_JSON:{event}"));
}

fn storage_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * u128::from(bytes)
}

/// A case stays in storage after it settles, so the claimant pays for its record out of the
/// attached deposit; otherwise anyone could drain the contract by opening cheap disputes.
fn case_storage_bytes(case: &Case) -> u64 {
    let value = near_sdk::borsh::to_vec(case).unwrap_or_else(|_| env::abort());
    STORAGE_PREFIX_BYTES + KEY_BYTES + value.len() as u64 + RECORD_OVERHEAD_BYTES
}

fn transfer(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

#[near]
impl Dispute {
    #[init]
    pub fn new(oracle: AccountId, timeout_sec: u64, min_stake: U128) -> Self {
        require!(timeout_sec > 0, "timeout must be positive");
        Self {
            oracle,
            timeout_ns: timeout_sec * 1_000_000_000,
            min_stake: min_stake.0,
            opening: LookupMap::new(b"o"),
            cases: LookupMap::new(b"c"),
            last_opening: 0,
        }
    }

    pub fn config(&self) -> serde_json::Value {
        json!({
            "oracle": self.oracle,
            "timeout_sec": self.timeout_ns / 1_000_000_000,
            "min_stake": U128(self.min_stake),
        })
    }

    /// Upper bound of the storage part of the deposit, priced for the longest account ids, so a
    /// wallet can attach `stake + oracle_deposit + storage_deposit(question)` without a retry.
    pub fn storage_deposit(&self, question: String) -> U128 {
        let longest: AccountId = "a"
            .repeat(MAX_ACCOUNT_ID_LEN)
            .parse()
            .unwrap_or_else(|_| env::abort());
        let sample = Case {
            claimant: longest.clone(),
            counterparty: longest.clone(),
            amount: U128(0),
            oracle_deposit: U128(0),
            deadline_ns: U64(0),
            question,
            escalated: false,
            settled: false,
            winner: Some(longest),
        };
        U128(storage_cost(case_storage_bytes(&sample)))
    }

    #[payable]
    pub fn open_dispute(
        &mut self,
        question: String,
        counterparty: AccountId,
        oracle_deposit: U128,
    ) -> Promise {
        let length = question.len();
        if length > MAX_QUESTION_BYTES {
            env::panic_str(&format!(
                "question too long: {length} bytes, max {MAX_QUESTION_BYTES}"
            ));
        }
        require!(!question.trim().is_empty(), "question must not be empty");
        let claimant = env::predecessor_account_id();
        require!(
            counterparty != claimant,
            "counterparty must differ from claimant"
        );
        let attached = env::attached_deposit().as_yoctonear();
        let mut case = Case {
            claimant,
            counterparty,
            amount: U128(0),
            oracle_deposit,
            deadline_ns: U64(env::block_timestamp() + self.timeout_ns),
            question: question.clone(),
            escalated: false,
            settled: false,
            winner: None,
        };
        let longer = if case.claimant.len() >= case.counterparty.len() {
            case.claimant.clone()
        } else {
            case.counterparty.clone()
        };
        let settled_shape = Case {
            winner: Some(longer),
            ..case.clone()
        };
        let storage = storage_cost(case_storage_bytes(&settled_shape));
        let costs = oracle_deposit.0 + storage;
        require!(
            attached > costs,
            "attach a stake above oracle deposit and storage"
        );
        let stake = attached - costs;
        if stake < self.min_stake {
            env::panic_str(&format!(
                "stake too low: {stake} yoctoNEAR, min {}",
                self.min_stake
            ));
        }
        case.amount = U128(stake);
        let nonce = self.last_opening + 1;
        self.last_opening = nonce;
        self.opening.insert(nonce, case);
        let args = json!({ "question": question, "callback": true });
        Promise::new(self.oracle.clone())
            .function_call(
                "ask".to_string(),
                serde_json::to_vec(&args).unwrap_or_else(|_| env::abort()),
                NearToken::from_yoctonear(oracle_deposit.0),
                ASK_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_ASKED_GAS)
                    .on_asked(nonce),
            )
    }

    /// A failed `ask` returns the whole deposit to the claimant; a successful one files the
    /// case under the oracle request id that `on_answer` will later carry.
    #[private]
    pub fn on_asked(
        &mut self,
        #[callback_result] result: Result<u64, PromiseError>,
        nonce: u64,
    ) -> Option<u64> {
        let Some(case) = self.opening.remove(&nonce) else {
            emit("orphan_ask", json!({ "nonce": nonce }));
            return None;
        };
        match result {
            Ok(request_id) => {
                emit(
                    "dispute_opened",
                    json!({
                        "request_id": request_id,
                        "claimant": case.claimant,
                        "counterparty": case.counterparty,
                        "amount": case.amount,
                        "deadline_ns": case.deadline_ns,
                    }),
                );
                self.cases.insert(request_id, case);
                Some(request_id)
            }
            Err(_) => {
                let back = case.amount.0 + case.oracle_deposit.0;
                emit(
                    "ask_failed",
                    json!({ "nonce": nonce, "claimant": case.claimant, "refunded": U128(back) }),
                );
                transfer(&case.claimant, back);
                None
            }
        }
    }

    pub fn on_answer(&mut self, request_id: u64, answer: String) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "only the oracle"
        );
        let mut case = self
            .cases
            .get(&request_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown dispute"));
        require!(!case.settled, "dispute already settled");
        let winner = match answer.as_str() {
            "YES" => case.claimant.clone(),
            "NO" => case.counterparty.clone(),
            _ => {
                case.escalated = true;
                self.cases.insert(request_id, case);
                emit("escalated", json!({ "request_id": request_id }));
                return;
            }
        };
        case.settled = true;
        case.winner = Some(winner.clone());
        let amount = case.amount.0;
        self.cases.insert(request_id, case);
        emit(
            "settled",
            json!({ "request_id": request_id, "winner": winner, "amount": U128(amount) }),
        );
        transfer(&winner, amount);
    }

    pub fn refund(&mut self, request_id: u64) {
        let mut case = self
            .cases
            .get(&request_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown dispute"));
        require!(!case.settled, "dispute already settled");
        if !case.escalated && env::block_timestamp() < case.deadline_ns.0 {
            env::panic_str(&format!(
                "too early: refund opens at {} ns",
                case.deadline_ns.0
            ));
        }
        case.settled = true;
        let claimant = case.claimant.clone();
        let amount = case.amount.0;
        self.cases.insert(request_id, case);
        emit(
            "refunded",
            json!({ "request_id": request_id, "claimant": claimant, "amount": U128(amount) }),
        );
        transfer(&claimant, amount);
    }

    pub fn get_case(&self, request_id: u64) -> Option<Case> {
        self.cases.get(&request_id).cloned()
    }
}

#[cfg(test)]
mod tests;
