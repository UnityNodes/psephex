use crate::{
    check_question_len, emit_event, near_chain_key, AiOracle, AiOracleExt, ModelAnswer, Vote,
    CALLBACK_GAS,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, Promise, PromiseError, PromiseOrValue,
};
use serde_json::{json, Value};

const MAX_NEAR_FEE: u128 = 1_000_000_000_000_000_000_000_000;
const RECORD_OVERHEAD_BYTES: u64 = 40;
const MAX_ACCOUNT_ID_LEN: usize = 64;
const MAX_PAGE: u64 = 100;
const CLIENT_GAS: Gas = Gas::from_tgas(30);
const WITHDRAW_RESERVE: NearToken = NearToken::from_near(1);
const STORAGE_PREFIX_BYTES: u64 = 1;
const KEY_BYTES: u64 = 8;

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct NearRequest {
    pub asker: AccountId,
    pub question: String,
    pub paid: u128,
    pub created_ns: u64,
    pub callback: bool,
    pub answer: Option<String>,
    pub votes: Vec<Vote>,
    pub answered_ns: Option<u64>,
}

#[near(serializers = [json])]
pub struct NearRequestView {
    pub chain: String,
    pub request_id: u64,
    pub asker: AccountId,
    pub question: String,
    pub question_hash: String,
    pub paid: U128,
    pub created_ns: U64,
    pub callback: bool,
    pub answer: Option<String>,
    pub votes: Vec<Vote>,
    pub answered_ns: Option<U64>,
}

pub(crate) fn checked_near_fee(fee: u128) -> u128 {
    require!(fee <= MAX_NEAR_FEE, "near fee above 1 NEAR");
    fee
}

fn storage_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * u128::from(bytes)
}

fn request_storage_bytes(request: &NearRequest) -> u64 {
    let value = near_sdk::borsh::to_vec(request).unwrap_or_else(|_| env::abort());
    STORAGE_PREFIX_BYTES + KEY_BYTES + value.len() as u64 + RECORD_OVERHEAD_BYTES
}

fn view(request_id: u64, r: &NearRequest) -> NearRequestView {
    NearRequestView {
        chain: near_chain_key(),
        request_id,
        asker: r.asker.clone(),
        question: r.question.clone(),
        question_hash: format!(
            "0x{}",
            hex::encode(env::keccak256_array(r.question.as_bytes()))
        ),
        paid: U128(r.paid),
        created_ns: U64(r.created_ns),
        callback: r.callback,
        answer: r.answer.clone(),
        votes: r.votes.clone(),
        answered_ns: r.answered_ns.map(U64),
    }
}

impl AiOracle {
    /// The asker pays for the record in its final, answered shape, otherwise a stream of cheap
    /// requests would make the contract pay for every stored verdict out of the balance it needs
    /// for MPC signing on other chains.
    pub(crate) fn ask_charge(&self, asker: AccountId, question: String) -> u128 {
        let longest_model = self
            .model_keys
            .keys()
            .max_by_key(|m| m.len())
            .cloned()
            .unwrap_or_default();
        let vote = Vote {
            model: longest_model,
            answer: "UNKNOWN".to_string(),
        };
        let answered = NearRequest {
            asker,
            question,
            paid: 0,
            created_ns: 0,
            callback: false,
            answer: Some("UNKNOWN".to_string()),
            votes: vec![vote; self.model_keys.len() as usize],
            answered_ns: Some(0),
        };
        self.near_fee + storage_cost(request_storage_bytes(&answered))
    }
}

#[near]
impl AiOracle {
    pub fn set_near_fee(&mut self, fee: U128) {
        self.assert_owner();
        self.near_fee = checked_near_fee(fee.0);
    }

    pub fn near_fee(&self) -> U128 {
        U128(self.near_fee)
    }

    pub fn ask_deposit(&self, question: String) -> U128 {
        check_question_len(&question).unwrap_or_else(|e| env::panic_str(&e));
        let longest_asker: AccountId = "a"
            .repeat(MAX_ACCOUNT_ID_LEN)
            .parse()
            .unwrap_or_else(|_| env::abort());
        U128(self.ask_charge(longest_asker, question))
    }

    #[payable]
    pub fn ask(&mut self, question: String, callback: Option<bool>) -> u64 {
        check_question_len(&question).unwrap_or_else(|e| env::panic_str(&e));
        require!(!question.trim().is_empty(), "question must not be empty");
        let asker = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let required = self.ask_charge(asker.clone(), question.clone());
        if deposit < required {
            env::panic_str(&format!(
                "attach at least {required} yoctoNEAR: fee {} plus storage {}",
                self.near_fee,
                required - self.near_fee
            ));
        }
        let request = NearRequest {
            asker: asker.clone(),
            question,
            paid: required,
            created_ns: env::block_timestamp(),
            callback: callback.unwrap_or(false),
            answer: None,
            votes: vec![],
            answered_ns: None,
        };
        let request_id = self.last_near_request_id + 1;
        self.last_near_request_id = request_id;
        let question_hash = format!(
            "0x{}",
            hex::encode(env::keccak256_array(request.question.as_bytes()))
        );
        self.near_requests.insert(request_id, request);
        emit_event(
            "asked",
            json!({
                "chain": near_chain_key(),
                "request_id": request_id,
                "asker": asker,
                "question_hash": question_hash,
                "paid": U128(required),
            }),
        );
        let refund = deposit - required;
        if refund > 0 {
            Promise::new(asker)
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
        request_id
    }

    pub fn fulfill_on_near(
        &mut self,
        request_id: u64,
        answers: Vec<ModelAnswer>,
    ) -> PromiseOrValue<Value> {
        self.assert_owner_or_relayer();
        let mut request = self
            .near_requests
            .get(&request_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown NEAR request"));
        require!(request.answer.is_none(), "request already fulfilled");
        let chain = near_chain_key();
        let consensus =
            self.verify_consensus(chain.clone(), request_id, request.question.clone(), answers);
        if !consensus.ok {
            env::panic_str(&consensus.reason);
        }
        let answer = consensus.answer;
        request.answer = Some(answer.clone());
        request.votes = consensus.votes.clone();
        request.answered_ns = Some(env::block_timestamp());
        let asker = request.asker.clone();
        let callback = request.callback;
        self.near_requests.insert(request_id, request);
        emit_event(
            "fulfilled",
            json!({ "chain": chain, "request_id": request_id, "answer": answer, "votes": consensus.votes }),
        );
        if !callback {
            return PromiseOrValue::Value(
                json!({ "ok": true, "chain": chain, "request_id": request_id, "answer": answer }),
            );
        }
        let args = json!({ "request_id": request_id, "answer": answer });
        let promise = Promise::new(asker)
            .function_call(
                "on_answer".to_string(),
                serde_json::to_vec(&args).unwrap_or_else(|_| env::abort()),
                NearToken::from_yoctonear(0),
                CLIENT_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_client_answered(request_id),
            );
        PromiseOrValue::Promise(promise)
    }

    /// The asker's `on_answer` may return any value or fail; the verdict is already stored, so
    /// this callback only records whether delivery worked and never panics.
    #[private]
    pub fn on_client_answered(&mut self, request_id: u64) -> bool {
        let ok = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        emit_event(
            "callback",
            json!({ "chain": near_chain_key(), "request_id": request_id, "ok": ok }),
        );
        ok
    }

    pub fn last_near_request_id(&self) -> u64 {
        self.last_near_request_id
    }

    pub fn near_request(&self, request_id: u64) -> Option<NearRequestView> {
        self.near_requests
            .get(&request_id)
            .map(|r| view(request_id, r))
    }

    pub fn near_requests(&self, from_id: u64, limit: u64) -> Vec<NearRequestView> {
        let first = from_id.max(1);
        let last = first
            .saturating_add(limit.min(MAX_PAGE))
            .saturating_sub(1)
            .min(self.last_near_request_id);
        (first..=last)
            .filter_map(|id| self.near_requests.get(&id).map(|r| view(id, r)))
            .collect()
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        let locked = storage_cost(env::storage_usage()) + WITHDRAW_RESERVE.as_yoctonear();
        let available = env::account_balance().as_yoctonear().saturating_sub(locked);
        require!(amount.0 > 0, "amount must be positive");
        require!(amount.0 <= available, "amount above withdrawable balance");
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }
}
