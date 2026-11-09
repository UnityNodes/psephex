use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};
use serde_json::json;

mod text;

pub use text::{oracle_question, MAX_FIELD_BYTES};

const ASK_GAS: Gas = Gas::from_tgas(30);
const ON_ASKED_GAS: Gas = Gas::from_tgas(15);
const RECORD_OVERHEAD_BYTES: u64 = 40;
const STORAGE_PREFIX_BYTES: u64 = 1;
const KEY_BYTES: u64 = 8;
const MAX_ACCOUNT_ID_LEN: usize = 64;
const MAX_PAGE: u64 = 50;
const NS_PER_SEC: u64 = 1_000_000_000;
const EVENT_STANDARD: &str = "psephex-court";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    AwaitingResponse,
    Asking,
    AwaitingVerdict,
    Decided,
    Appealed,
    Settled,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Case {
    pub claimant: AccountId,
    pub counterparty: AccountId,
    pub amount: U128,
    pub oracle_deposit: U128,
    pub claim: String,
    pub evidence: String,
    pub response: Option<String>,
    pub stage: Stage,
    pub opened_ns: U64,
    pub respond_by_ns: U64,
    pub request_id: Option<u64>,
    pub answer_by_ns: Option<U64>,
    pub verdict: Option<String>,
    pub appeal_by_ns: Option<U64>,
    pub appellant: Option<AccountId>,
    pub appeal_bond: U128,
    pub winner: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct CaseView {
    pub case_id: u64,
    #[serde(flatten)]
    pub case: Case,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Court {
    owner: AccountId,
    oracle: AccountId,
    arbiter: AccountId,
    min_stake: u128,
    appeal_bond: u128,
    response_window_ns: u64,
    appeal_window_ns: u64,
    answer_timeout_ns: u64,
    cases: LookupMap<u64, Case>,
    by_request: LookupMap<u64, u64>,
    last_case_id: u64,
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

fn record_bytes(value_len: usize) -> u64 {
    STORAGE_PREFIX_BYTES + KEY_BYTES + value_len as u64 + RECORD_OVERHEAD_BYTES
}

fn transfer(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

fn check_field(name: &str, value: &str) {
    if value.trim().is_empty() {
        env::panic_str(&format!("{name} must not be empty"));
    }
    if value.len() > MAX_FIELD_BYTES {
        env::panic_str(&format!(
            "{name} too long: {} bytes, max {MAX_FIELD_BYTES}",
            value.len()
        ));
    }
}

fn now() -> u64 {
    env::block_timestamp()
}

/// Every case keeps its full record after it ends, and the response, verdict and appeal fields
/// grow it later. The claimant pays for that final shape up front, priced with the longest
/// response and account ids, so neither side can make the court pay for storage.
fn final_storage_cost(claim: &str, evidence: &str) -> u128 {
    let longest: AccountId = "a"
        .repeat(MAX_ACCOUNT_ID_LEN)
        .parse()
        .unwrap_or_else(|_| env::abort());
    let shape = Case {
        claimant: longest.clone(),
        counterparty: longest.clone(),
        amount: U128(0),
        oracle_deposit: U128(0),
        claim: claim.to_string(),
        evidence: evidence.to_string(),
        response: Some("x".repeat(MAX_FIELD_BYTES)),
        stage: Stage::AwaitingResponse,
        opened_ns: U64(0),
        respond_by_ns: U64(0),
        request_id: Some(0),
        answer_by_ns: Some(U64(0)),
        verdict: Some("UNKNOWN".to_string()),
        appeal_by_ns: Some(U64(0)),
        appellant: Some(longest.clone()),
        appeal_bond: U128(0),
        winner: Some(longest),
    };
    let case_len = near_sdk::borsh::to_vec(&shape)
        .unwrap_or_else(|_| env::abort())
        .len();
    storage_cost(record_bytes(case_len) + record_bytes(8))
}

#[near]
impl Court {
    #[init]
    pub fn new(
        owner: AccountId,
        oracle: AccountId,
        arbiter: AccountId,
        min_stake: U128,
        appeal_bond: U128,
        response_window_sec: u64,
        appeal_window_sec: u64,
        answer_timeout_sec: u64,
    ) -> Self {
        let mut court = Self {
            owner,
            oracle,
            arbiter,
            min_stake: min_stake.0,
            appeal_bond: 0,
            response_window_ns: 0,
            appeal_window_ns: 0,
            answer_timeout_ns: 0,
            cases: LookupMap::new(b"c"),
            by_request: LookupMap::new(b"r"),
            last_case_id: 0,
        };
        court.put_params(
            appeal_bond.0,
            response_window_sec,
            appeal_window_sec,
            answer_timeout_sec,
        );
        court
    }

    fn put_params(
        &mut self,
        appeal_bond: u128,
        response_window_sec: u64,
        appeal_window_sec: u64,
        answer_timeout_sec: u64,
    ) {
        require!(appeal_bond > 0, "appeal bond must be positive");
        require!(
            response_window_sec > 0 && appeal_window_sec > 0 && answer_timeout_sec > 0,
            "windows must be positive"
        );
        self.appeal_bond = appeal_bond;
        self.response_window_ns = response_window_sec * NS_PER_SEC;
        self.appeal_window_ns = appeal_window_sec * NS_PER_SEC;
        self.answer_timeout_ns = answer_timeout_sec * NS_PER_SEC;
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }

    fn load(&self, case_id: u64) -> Case {
        self.cases
            .get(&case_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown case"))
    }

    pub fn set_arbiter(&mut self, arbiter: AccountId) {
        self.assert_owner();
        self.arbiter = arbiter;
    }

    pub fn set_params(
        &mut self,
        min_stake: U128,
        appeal_bond: U128,
        response_window_sec: u64,
        appeal_window_sec: u64,
        answer_timeout_sec: u64,
    ) {
        self.assert_owner();
        self.min_stake = min_stake.0;
        self.put_params(
            appeal_bond.0,
            response_window_sec,
            appeal_window_sec,
            answer_timeout_sec,
        );
    }

    pub fn config(&self) -> serde_json::Value {
        json!({
            "owner": self.owner,
            "oracle": self.oracle,
            "arbiter": self.arbiter,
            "min_stake": U128(self.min_stake),
            "appeal_bond": U128(self.appeal_bond),
            "response_window_sec": self.response_window_ns / NS_PER_SEC,
            "appeal_window_sec": self.appeal_window_ns / NS_PER_SEC,
            "answer_timeout_sec": self.answer_timeout_ns / NS_PER_SEC,
            "max_field_bytes": MAX_FIELD_BYTES,
            "last_case_id": self.last_case_id,
        })
    }

    pub fn storage_deposit(&self, claim: String, evidence: String) -> U128 {
        U128(final_storage_cost(&claim, &evidence))
    }

    #[payable]
    pub fn open_case(
        &mut self,
        claim: String,
        evidence: String,
        counterparty: AccountId,
        oracle_deposit: U128,
    ) -> u64 {
        check_field("claim", &claim);
        check_field("evidence", &evidence);
        let claimant = env::predecessor_account_id();
        require!(
            counterparty != claimant,
            "counterparty must differ from claimant"
        );
        require!(oracle_deposit.0 > 0, "oracle deposit must be positive");
        let costs = oracle_deposit.0 + final_storage_cost(&claim, &evidence);
        let attached = env::attached_deposit().as_yoctonear();
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
        let case_id = self.last_case_id + 1;
        self.last_case_id = case_id;
        let opened = now();
        let case = Case {
            claimant,
            counterparty,
            amount: U128(stake),
            oracle_deposit,
            claim,
            evidence,
            response: None,
            stage: Stage::AwaitingResponse,
            opened_ns: U64(opened),
            respond_by_ns: U64(opened + self.response_window_ns),
            request_id: None,
            answer_by_ns: None,
            verdict: None,
            appeal_by_ns: None,
            appellant: None,
            appeal_bond: U128(0),
            winner: None,
        };
        emit(
            "opened",
            json!({
                "case_id": case_id,
                "claimant": case.claimant,
                "counterparty": case.counterparty,
                "amount": case.amount,
                "respond_by_ns": case.respond_by_ns,
            }),
        );
        self.cases.insert(case_id, case);
        case_id
    }

    pub fn respond(&mut self, case_id: u64, response: String) -> Promise {
        check_field("response", &response);
        let mut case = self.load(case_id);
        require!(
            env::predecessor_account_id() == case.counterparty,
            "only the counterparty can respond"
        );
        require!(
            case.stage == Stage::AwaitingResponse,
            "the case is not waiting for a response"
        );
        require!(now() < case.respond_by_ns.0, "the response window is over");
        case.response = Some(response);
        emit("responded", json!({ "case_id": case_id }));
        self.ask(case_id, case)
    }

    pub fn submit(&mut self, case_id: u64) -> Promise {
        let case = self.load(case_id);
        require!(
            case.stage == Stage::AwaitingResponse,
            "the case is not waiting for a response"
        );
        require!(
            now() >= case.respond_by_ns.0,
            "the counterparty can still respond"
        );
        self.ask(case_id, case)
    }

    fn ask(&mut self, case_id: u64, mut case: Case) -> Promise {
        let question = oracle_question(&case);
        case.stage = Stage::Asking;
        let deposit = case.oracle_deposit.0;
        self.cases.insert(case_id, case);
        let args = json!({ "question": question, "callback": true });
        Promise::new(self.oracle.clone())
            .function_call(
                "ask".to_string(),
                serde_json::to_vec(&args).unwrap_or_else(|_| env::abort()),
                NearToken::from_yoctonear(deposit),
                ASK_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(ON_ASKED_GAS)
                    .on_asked(case_id),
            )
    }

    /// A refused `ask` sends the stake and the untouched oracle deposit back to the claimant; an
    /// accepted one ties the oracle request id to the case so `on_answer` can find it.
    #[private]
    pub fn on_asked(
        &mut self,
        #[callback_result] result: Result<u64, PromiseError>,
        case_id: u64,
    ) -> Option<u64> {
        let mut case = self.cases.get(&case_id).cloned()?;
        if case.stage != Stage::Asking {
            return None;
        }
        match result {
            Ok(request_id) => {
                case.stage = Stage::AwaitingVerdict;
                case.request_id = Some(request_id);
                case.answer_by_ns = Some(U64(now() + self.answer_timeout_ns));
                self.by_request.insert(request_id, case_id);
                self.cases.insert(case_id, case);
                emit(
                    "asked",
                    json!({ "case_id": case_id, "request_id": request_id }),
                );
                Some(request_id)
            }
            Err(_) => {
                let back = case.amount.0 + case.oracle_deposit.0;
                let claimant = case.claimant.clone();
                case.stage = Stage::Refunded;
                self.cases.insert(case_id, case);
                emit(
                    "ask_failed",
                    json!({ "case_id": case_id, "refunded": U128(back) }),
                );
                transfer(&claimant, back);
                None
            }
        }
    }

    pub fn on_answer(&mut self, request_id: u64, answer: String) {
        require!(
            env::predecessor_account_id() == self.oracle,
            "only the oracle"
        );
        let case_id = *self
            .by_request
            .get(&request_id)
            .unwrap_or_else(|| env::panic_str("unknown request"));
        let mut case = self.load(case_id);
        require!(
            case.stage == Stage::AwaitingVerdict,
            "the case is not waiting for a verdict"
        );
        let verdict = match answer.as_str() {
            "YES" | "NO" => answer,
            _ => "UNKNOWN".to_string(),
        };
        case.stage = Stage::Decided;
        case.verdict = Some(verdict.clone());
        case.appeal_by_ns = Some(U64(now() + self.appeal_window_ns));
        emit(
            "decided",
            json!({ "case_id": case_id, "verdict": verdict, "appeal_by_ns": case.appeal_by_ns }),
        );
        self.cases.insert(case_id, case);
    }

    #[payable]
    pub fn appeal(&mut self, case_id: u64) {
        let mut case = self.load(case_id);
        let who = env::predecessor_account_id();
        require!(
            who == case.claimant || who == case.counterparty,
            "only a party can appeal"
        );
        require!(
            case.stage == Stage::Decided,
            "only a decided case can be appealed"
        );
        let appeal_by = case.appeal_by_ns.map_or(0, |t| t.0);
        require!(now() < appeal_by, "the appeal window is over");
        require!(
            env::attached_deposit().as_yoctonear() == self.appeal_bond,
            "attach exactly the appeal bond"
        );
        case.stage = Stage::Appealed;
        case.appellant = Some(who.clone());
        case.appeal_bond = U128(self.appeal_bond);
        emit(
            "appealed",
            json!({ "case_id": case_id, "appellant": who, "bond": U128(self.appeal_bond) }),
        );
        self.cases.insert(case_id, case);
    }

    pub fn finalize(&mut self, case_id: u64) {
        let mut case = self.load(case_id);
        require!(
            case.stage == Stage::Decided,
            "only a decided case can be finalized"
        );
        let appeal_by = case.appeal_by_ns.map_or(u64::MAX, |t| t.0);
        require!(now() >= appeal_by, "the appeal window is still open");
        let winner = match case.verdict.as_deref() {
            Some("NO") => case.counterparty.clone(),
            _ => case.claimant.clone(),
        };
        let amount = case.amount.0;
        case.stage = Stage::Settled;
        case.winner = Some(winner.clone());
        emit(
            "settled",
            json!({ "case_id": case_id, "winner": winner, "amount": U128(amount), "by": "verdict" }),
        );
        self.cases.insert(case_id, case);
        transfer(&winner, amount);
    }

    pub fn arbitrate(&mut self, case_id: u64, winner: String) {
        require!(
            env::predecessor_account_id() == self.arbiter,
            "only the arbiter"
        );
        let mut case = self.load(case_id);
        require!(
            case.stage == Stage::Appealed,
            "the case is not under appeal"
        );
        let winner_account = match winner.as_str() {
            "claimant" => case.claimant.clone(),
            "counterparty" => case.counterparty.clone(),
            _ => env::panic_str("winner must be claimant or counterparty"),
        };
        let appellant = case
            .appellant
            .clone()
            .unwrap_or_else(|| env::panic_str("appeal without appellant"));
        let amount = case.amount.0;
        let bond = case.appeal_bond.0;
        case.stage = Stage::Settled;
        case.winner = Some(winner_account.clone());
        emit(
            "arbitrated",
            json!({ "case_id": case_id, "winner": winner_account, "amount": U128(amount), "appellant": appellant, "bond": U128(bond) }),
        );
        self.cases.insert(case_id, case);
        transfer(&winner_account, amount + bond);
    }

    pub fn refund(&mut self, case_id: u64) {
        let mut case = self.load(case_id);
        require!(
            case.stage == Stage::AwaitingVerdict,
            "only a case waiting for a verdict can be refunded"
        );
        let answer_by = case.answer_by_ns.map_or(u64::MAX, |t| t.0);
        require!(now() >= answer_by, "the oracle can still answer");
        let claimant = case.claimant.clone();
        let amount = case.amount.0;
        case.stage = Stage::Refunded;
        emit(
            "refunded",
            json!({ "case_id": case_id, "claimant": claimant, "amount": U128(amount) }),
        );
        self.cases.insert(case_id, case);
        transfer(&claimant, amount);
    }

    pub fn get_case(&self, case_id: u64) -> Option<Case> {
        self.cases.get(&case_id).cloned()
    }

    pub fn case_by_request(&self, request_id: u64) -> Option<u64> {
        self.by_request.get(&request_id).copied()
    }

    pub fn question_for(&self, case_id: u64) -> String {
        oracle_question(&self.load(case_id))
    }

    pub fn cases(&self, from_id: u64, limit: u64) -> Vec<CaseView> {
        let first = from_id.max(1);
        let last = first
            .saturating_add(limit.min(MAX_PAGE))
            .saturating_sub(1)
            .min(self.last_case_id);
        (first..=last)
            .filter_map(|id| {
                self.cases.get(&id).map(|c| CaseView {
                    case_id: id,
                    case: c.clone(),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests;
