use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};
use omni_transaction::evm::utils::parse_eth_address;
use omni_transaction::{TransactionBuilder, TxBuilder, EVM};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

mod chain;
mod migrate;
mod near_requests;
mod owner;

pub use chain::{evm_chain_key, near_chain_key, parse_chain, Chain};
pub use near_requests::{NearRequest, NearRequestView};
pub use owner::{OwnerAction, ProposalView};

const SIGN_GAS: Gas = Gas::from_tgas(50);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const EVM_GAS_LIMIT: u128 = 300_000;
const FIXED_SEED: u64 = 42;
const MAX_TOKENS: u32 = 8;
const MIN_MODELS: u32 = 3;
const MAX_QUESTION_BYTES: usize = 2000;
const SCHEME_NEARAI_V1: &str = "nearai-v1";
const SCHEME_DSTACK_V1: &str = "dstack-v1";

fn is_supported_scheme(scheme: &str) -> bool {
    scheme == SCHEME_NEARAI_V1 || scheme == SCHEME_DSTACK_V1
}
const EVENT_STANDARD: &str = "psephex";
const EVENT_VERSION: &str = "1.1.0";
const FULFILL_SIGNATURE: &str = "fulfill(uint256,uint8,bytes32)";

const ANSWER_UNKNOWN: u8 = 0;
const ANSWER_YES: u8 = 1;
const ANSWER_NO: u8 = 2;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AiOracle {
    owner: AccountId,
    signer: AccountId,
    path: String,
    chains: IterableMap<u64, EvmChain>,
    model_keys: IterableMap<String, ModelKey>,
    fulfilled: IterableSet<(u64, u64)>,
    relayers: IterableSet<AccountId>,
    pending: IterableSet<(u64, u64)>,
    max_fee_per_gas_cap: u128,
    near_fee: u128,
    near_requests: LookupMap<u64, NearRequest>,
    last_near_request_id: u64,
    owner_delay_ns: u64,
    proposals: IterableMap<u64, owner::Proposal>,
    last_proposal_id: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct EvmChain {
    name: String,
    oracle_address: String,
}

#[near(serializers = [json])]
pub struct ChainInfo {
    pub chain: String,
    pub chain_id: u64,
    pub name: String,
    pub oracle_address: String,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct ModelKey {
    provider: String,
    scheme: String,
    public_key: Vec<u8>,
}

#[near(serializers = [json])]
pub struct ModelInfo {
    pub model: String,
    pub provider: String,
    pub scheme: String,
    pub public_key: String,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct ChatTemplateKwargs {
    enable_thinking: bool,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: u8,
    seed: u64,
    max_tokens: u32,
    stream: bool,
    chat_template_kwargs: ChatTemplateKwargs,
}

#[near(serializers = [json])]
pub struct VerifyResult {
    pub ok: bool,
    pub answer: String,
    pub reason: String,
    pub signed_text: String,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ModelAnswer {
    pub model: String,
    pub response_body: String,
    pub signature_hex: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Vote {
    pub model: String,
    pub answer: String,
}

#[near(serializers = [json])]
pub struct ConsensusResult {
    pub ok: bool,
    pub answer: String,
    pub reason: String,
    pub required: u32,
    pub votes: Vec<Vote>,
}

#[near(serializers = [json])]
pub struct BuiltTx {
    pub unsigned_tx: String,
    pub payload: String,
    pub calldata: String,
    pub answer_code: u8,
}

fn normalize_address(address: &str) -> String {
    let a = address.trim().to_lowercase();
    let a = a.strip_prefix("0x").unwrap_or(&a).to_string();
    require!(
        a.len() == 40 && a.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid EVM address"
    );
    a
}

fn decode_hex_exact(input: &str, expected_len: usize, what: &str) -> Result<Vec<u8>, String> {
    let s = input.trim();
    let s = s
        .strip_prefix("0x")
        .or_else(|| s.strip_prefix("0X"))
        .unwrap_or(s);
    let bytes = hex::decode(s).map_err(|_| format!("{what} is not valid hex"))?;
    if bytes.len() != expected_len {
        return Err(format!(
            "{what} must be {expected_len} bytes, got {}",
            bytes.len()
        ));
    }
    Ok(bytes)
}

fn normalize_answer(content: &str) -> Option<(String, u8)> {
    let trimmed = content.trim();
    let trimmed = trimmed.strip_suffix('.').unwrap_or(trimmed).trim();
    let upper = trimmed.to_uppercase();
    match upper.as_str() {
        "YES" => Some((upper, ANSWER_YES)),
        "NO" => Some((upper, ANSWER_NO)),
        "UNKNOWN" => Some((upper, ANSWER_UNKNOWN)),
        _ => None,
    }
}

fn extract_content(response_body: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(response_body)
        .map_err(|_| "response body is not valid JSON".to_string())?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "choices[0].message.content missing".to_string())
}

fn emit_event(event: &str, data: Value) {
    let event = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data]
    });
    env::log_str(&format!("EVENT_JSON:{event}"));
}

fn check_question_len(question: &str) -> Result<(), String> {
    if question.len() > MAX_QUESTION_BYTES {
        return Err(format!(
            "question too long: {} bytes, max {MAX_QUESTION_BYTES}",
            question.len()
        ));
    }
    Ok(())
}

fn fulfill_selector() -> [u8; 4] {
    let hash = env::keccak256_array(FULFILL_SIGNATURE.as_bytes());
    [hash[0], hash[1], hash[2], hash[3]]
}

fn fulfill_calldata(request_id: u64, answer_code: u8, question_hash: [u8; 32]) -> Vec<u8> {
    let mut data = Vec::with_capacity(100);
    data.extend_from_slice(&fulfill_selector());
    data.extend_from_slice(&[0u8; 24]);
    data.extend_from_slice(&request_id.to_be_bytes());
    data.extend_from_slice(&[0u8; 31]);
    data.push(answer_code);
    data.extend_from_slice(&question_hash);
    data
}

#[near]
impl AiOracle {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner: AccountId,
        signer: AccountId,
        path: String,
        chain_id: u64,
        chain_name: String,
        oracle_address: String,
        max_fee_per_gas_cap: U128,
        near_fee: U128,
        owner_delay_seconds: u64,
    ) -> Self {
        require!(max_fee_per_gas_cap.0 > 0, "fee cap must be positive");
        let mut contract = Self {
            owner,
            signer,
            path,
            chains: IterableMap::new(b"c"),
            model_keys: IterableMap::new(b"m"),
            fulfilled: IterableSet::new(b"F"),
            relayers: IterableSet::new(b"r"),
            pending: IterableSet::new(b"P"),
            max_fee_per_gas_cap: max_fee_per_gas_cap.0,
            near_fee: near_requests::checked_near_fee(near_fee.0),
            near_requests: LookupMap::new(b"n"),
            last_near_request_id: 0,
            owner_delay_ns: owner::owner_delay_ns(owner_delay_seconds),
            proposals: IterableMap::new(b"o"),
            last_proposal_id: 0,
        };
        contract.put_chain(chain_id, chain_name, oracle_address);
        contract
    }

    fn put_chain(&mut self, chain_id: u64, name: String, oracle_address: String) {
        require!(chain_id > 0, "chain id must be positive");
        let name = name.trim().to_string();
        require!(!name.is_empty(), "chain name must not be empty");
        self.chains.insert(
            chain_id,
            EvmChain {
                name,
                oracle_address: normalize_address(&oracle_address),
            },
        );
    }

    fn evm_chain(&self, chain_id: u64) -> Result<&EvmChain, String> {
        self.chains
            .get(&chain_id)
            .ok_or_else(|| format!("chain {} is not registered", evm_chain_key(chain_id)))
    }

    fn evm_chain_id(chain: &str) -> u64 {
        match parse_chain(chain) {
            Ok(Chain::Evm(chain_id)) => chain_id,
            Ok(Chain::Near) => env::panic_str("this method needs an eip155 chain"),
            Err(e) => env::panic_str(&e),
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }

    fn assert_owner_or_relayer(&self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || self.relayers.contains(&caller),
            "only owner or relayer"
        );
    }

    pub fn add_relayer(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        self.relayers.insert(account_id)
    }

    pub fn remove_relayer(&mut self, account_id: AccountId) -> bool {
        self.assert_owner();
        self.relayers.remove(&account_id)
    }

    pub fn relayers(&self) -> Vec<AccountId> {
        self.relayers.iter().cloned().collect()
    }

    pub fn set_max_fee_per_gas_cap(&mut self, cap: U128) {
        self.assert_owner();
        require!(cap.0 > 0, "fee cap must be positive");
        require!(
            cap.0 <= self.max_fee_per_gas_cap,
            "raising the gas cap goes through propose"
        );
        self.max_fee_per_gas_cap = cap.0;
    }

    pub fn max_fee_per_gas_cap(&self) -> U128 {
        U128(self.max_fee_per_gas_cap)
    }

    pub(crate) fn set_model_key(
        &mut self,
        model: String,
        provider: String,
        scheme: String,
        public_key_hex: String,
    ) {
        self.assert_owner();
        let provider = provider.trim().to_string();
        require!(!provider.is_empty(), "provider must not be empty");
        if !is_supported_scheme(&scheme) {
            env::panic_str(&format!("unsupported signature scheme: {scheme}"));
        }
        let public_key = decode_hex_exact(&public_key_hex, 32, "public key")
            .unwrap_or_else(|e| env::panic_str(&e));
        if let Some((other, _)) = self
            .model_keys
            .iter()
            .find(|(m, k)| **m != model && k.public_key == public_key)
        {
            env::panic_str(&format!("public key already registered for model {other}"));
        }
        self.model_keys.insert(
            model,
            ModelKey {
                provider,
                scheme,
                public_key,
            },
        );
    }

    pub(crate) fn remove_model_key(&mut self, model: String) {
        self.assert_owner();
        self.model_keys.remove(&model);
    }

    pub(crate) fn set_chain(&mut self, chain_id: u64, name: String, oracle_address: String) {
        self.assert_owner();
        require!(
            !self.pending.iter().any(|(c, _)| *c == chain_id),
            "chain has signatures in progress"
        );
        self.put_chain(chain_id, name, oracle_address);
    }

    pub(crate) fn remove_chain(&mut self, chain_id: u64) -> bool {
        self.assert_owner();
        require!(
            !self.pending.iter().any(|(c, _)| *c == chain_id),
            "chain has signatures in progress"
        );
        self.chains.remove(&chain_id).is_some()
    }

    pub fn chains(&self) -> Vec<ChainInfo> {
        self.chains
            .iter()
            .map(|(chain_id, c)| ChainInfo {
                chain: evm_chain_key(*chain_id),
                chain_id: *chain_id,
                name: c.name.clone(),
                oracle_address: format!("0x{}", c.oracle_address),
            })
            .collect()
    }

    pub(crate) fn reset_fulfilled(&mut self, chain: String, request_id: u64) -> bool {
        self.assert_owner();
        let key = (Self::evm_chain_id(&chain), request_id);
        let was_pending = self.pending.remove(&key);
        let was_fulfilled = self.fulfilled.remove(&key);
        was_pending || was_fulfilled
    }

    pub fn models(&self) -> Vec<ModelInfo> {
        self.model_keys
            .iter()
            .map(|(model, key)| ModelInfo {
                model: model.clone(),
                provider: key.provider.clone(),
                scheme: key.scheme.clone(),
                public_key: hex::encode(&key.public_key),
            })
            .collect()
    }

    pub fn config(&self) -> Value {
        json!({
            "owner": self.owner,
            "signer": self.signer,
            "path": self.path,
            "chains": self.chains(),
            "near_chain": near_chain_key(),
            "near_fee": U128(self.near_fee),
            "last_near_request_id": self.last_near_request_id,
            "models": self.model_keys.len(),
            "owner_delay_seconds": self.owner_delay_seconds(),
            "open_proposals": self.proposals.len(),
        })
    }

    pub fn is_fulfilled(&self, chain: String, request_id: u64) -> bool {
        match parse_chain(&chain) {
            Ok(Chain::Evm(chain_id)) => self.fulfilled.contains(&(chain_id, request_id)),
            Ok(Chain::Near) => self
                .near_requests
                .get(&request_id)
                .is_some_and(|r| r.answer.is_some()),
            Err(e) => env::panic_str(&e),
        }
    }

    pub fn is_pending(&self, chain: String, request_id: u64) -> bool {
        match parse_chain(&chain) {
            Ok(Chain::Evm(chain_id)) => self.pending.contains(&(chain_id, request_id)),
            Ok(Chain::Near) => false,
            Err(e) => env::panic_str(&e),
        }
    }

    /// The EVM prompt is kept byte for byte as in v2, so answers signed for Base requests before
    /// the multichain migration still verify. The NEAR prompt names the contract account instead
    /// of an EVM address, so a signed answer for one source can never be replayed on another.
    fn request_content(
        &self,
        chain: &str,
        request_id: u64,
        question: &str,
    ) -> Result<String, String> {
        check_question_len(question)?;
        match parse_chain(chain)? {
            Chain::Evm(chain_id) => {
                let target = self.evm_chain(chain_id)?;
                Ok(format!(
                    "You are a neutral oracle resolving request #{} for the AiOracle contract 0x{} on EVM chain {}. Question: {} Answer with exactly one word: YES, NO or UNKNOWN.",
                    request_id, target.oracle_address, chain_id, question
                ))
            }
            Chain::Near => Ok(format!(
                "You are a neutral oracle resolving request #{} for the NEAR contract {}. Question: {} Answer with exactly one word: YES, NO or UNKNOWN.",
                request_id,
                env::current_account_id(),
                question
            )),
        }
    }

    pub fn build_request(
        &self,
        chain: String,
        request_id: u64,
        question: String,
        model: String,
    ) -> String {
        let content = self
            .request_content(&chain, request_id, &question)
            .unwrap_or_else(|e| env::panic_str(&e));
        let body = ChatRequest {
            model,
            messages: vec![ChatMessage {
                role: "user",
                content,
            }],
            temperature: 0,
            seed: FIXED_SEED,
            max_tokens: MAX_TOKENS,
            stream: false,
            chat_template_kwargs: ChatTemplateKwargs {
                enable_thinking: false,
            },
        };
        serde_json::to_string(&body).unwrap()
    }

    pub fn question_hash(&self, question: String) -> String {
        format!(
            "0x{}",
            hex::encode(env::keccak256_array(question.as_bytes()))
        )
    }

    /// NEAR AI signs `model:sha256(request):sha256(response)`, while the Phala dstack gateway
    /// signs `sha256(request):sha256(response)`. The model name is inside the hashed request
    /// body either way, so both bind the answer to the model; the text follows the scheme the
    /// model was registered with, and a signature made for one format never verifies under the other.
    pub fn signed_text(
        &self,
        chain: String,
        request_id: u64,
        question: String,
        model: String,
        response_body: String,
    ) -> String {
        let request_body = self.build_request(chain, request_id, question, model.clone());
        let req_hash = hex::encode(env::sha256_array(request_body.as_bytes()));
        let resp_hash = hex::encode(env::sha256_array(response_body.as_bytes()));
        match self.model_keys.get(&model).map(|k| k.scheme.as_str()) {
            Some(SCHEME_DSTACK_V1) => format!("{req_hash}:{resp_hash}"),
            _ => format!("{model}:{req_hash}:{resp_hash}"),
        }
    }

    fn check_signed_answer(
        &self,
        chain: &str,
        request_id: u64,
        question: String,
        model: &str,
        response_body: &str,
        signature_hex: &str,
    ) -> (String, Result<Result<String, String>, String>) {
        let signed_text = self.signed_text(
            chain.to_string(),
            request_id,
            question,
            model.to_string(),
            response_body.to_string(),
        );
        let Some(key) = self.model_keys.get(model) else {
            return (signed_text, Err("unknown model".to_string()));
        };
        if !is_supported_scheme(&key.scheme) {
            return (
                signed_text,
                Err(format!("unsupported signature scheme: {}", key.scheme)),
            );
        }
        let public_key: [u8; 32] = key.public_key.as_slice().try_into().unwrap();
        let signature = match decode_hex_exact(signature_hex, 64, "signature") {
            Ok(s) => s,
            Err(e) => return (signed_text, Err(e)),
        };
        let signature: [u8; 64] = signature.as_slice().try_into().unwrap();
        if !env::ed25519_verify(&signature, signed_text.as_bytes(), &public_key) {
            return (signed_text, Err("invalid signature".to_string()));
        }
        let parsed = extract_content(response_body).and_then(|content| {
            normalize_answer(&content)
                .map(|(answer, _)| answer)
                .ok_or_else(|| "unparseable answer".to_string())
        });
        (signed_text, Ok(parsed))
    }

    pub fn verify_answer(
        &self,
        chain: String,
        request_id: u64,
        question: String,
        model: String,
        response_body: String,
        signature_hex: String,
    ) -> VerifyResult {
        if let Err(reason) = self.request_content(&chain, request_id, &question) {
            return VerifyResult {
                ok: false,
                answer: String::new(),
                reason,
                signed_text: String::new(),
            };
        }
        let (signed_text, checked) = self.check_signed_answer(
            &chain,
            request_id,
            question,
            &model,
            &response_body,
            &signature_hex,
        );
        match checked {
            Ok(Ok(answer)) => VerifyResult {
                ok: true,
                answer,
                reason: String::new(),
                signed_text,
            },
            Ok(Err(reason)) | Err(reason) => VerifyResult {
                ok: false,
                answer: String::new(),
                reason,
                signed_text,
            },
        }
    }

    pub fn verify_consensus(
        &self,
        chain: String,
        request_id: u64,
        question: String,
        answers: Vec<ModelAnswer>,
    ) -> ConsensusResult {
        let total = self.model_keys.len();
        let required = total / 2 + 1;
        let fail = |reason: String| ConsensusResult {
            ok: false,
            answer: String::new(),
            reason,
            required,
            votes: vec![],
        };
        if let Err(reason) = self.request_content(&chain, request_id, &question) {
            return fail(reason);
        }
        if total < MIN_MODELS {
            return fail(format!("at least {MIN_MODELS} registered models required"));
        }
        let mut seen = BTreeSet::new();
        let covers_all = answers.len() as u32 == total
            && answers
                .iter()
                .all(|a| self.model_keys.contains_key(&a.model) && seen.insert(a.model.clone()));
        if !covers_all {
            return fail("answers must cover every registered model exactly once".to_string());
        }
        let mut votes = Vec::with_capacity(answers.len());
        for a in &answers {
            let (_, checked) = self.check_signed_answer(
                &chain,
                request_id,
                question.clone(),
                &a.model,
                &a.response_body,
                &a.signature_hex,
            );
            match checked {
                Ok(parsed) => votes.push(Vote {
                    model: a.model.clone(),
                    answer: parsed.unwrap_or_else(|_| "UNKNOWN".to_string()),
                }),
                Err(reason) => return fail(format!("{}: {}", a.model, reason)),
            }
        }
        let winner = ["YES", "NO", "UNKNOWN"].into_iter().find(|candidate| {
            votes.iter().filter(|v| v.answer == *candidate).count() as u32 >= required
        });
        match winner {
            Some(answer) => ConsensusResult {
                ok: true,
                answer: answer.to_string(),
                reason: String::new(),
                required,
                votes,
            },
            None => ConsensusResult {
                ok: true,
                answer: "UNKNOWN".to_string(),
                reason: "no majority".to_string(),
                required,
                votes,
            },
        }
    }

    pub fn build_fulfill_tx(
        &self,
        chain: String,
        request_id: u64,
        question: String,
        answer: String,
        nonce: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> BuiltTx {
        let chain_id = Self::evm_chain_id(&chain);
        let target = self
            .evm_chain(chain_id)
            .unwrap_or_else(|e| env::panic_str(&e));
        let (_, answer_code) =
            normalize_answer(&answer).unwrap_or_else(|| env::panic_str("unparseable answer"));
        let question_hash = env::keccak256_array(question.as_bytes());
        let calldata = fulfill_calldata(request_id, answer_code, question_hash);
        let tx = TransactionBuilder::new::<EVM>()
            .nonce(nonce)
            .to(parse_eth_address(&target.oracle_address))
            .value(0)
            .input(calldata.clone())
            .max_priority_fee_per_gas(max_priority_fee_per_gas.0)
            .max_fee_per_gas(max_fee_per_gas.0)
            .gas_limit(EVM_GAS_LIMIT)
            .chain_id(chain_id)
            .build();
        let unsigned = tx.build_for_signing();
        let hash = env::keccak256_array(&unsigned);
        BuiltTx {
            unsigned_tx: hex::encode(&unsigned),
            payload: hex::encode(hash),
            calldata: hex::encode(calldata),
            answer_code,
        }
    }

    pub fn fulfill_on_evm(
        &mut self,
        chain: String,
        request_id: u64,
        question: String,
        answers: Vec<ModelAnswer>,
        nonce: u64,
        max_fee_per_gas: U128,
        max_priority_fee_per_gas: U128,
    ) -> Promise {
        self.assert_owner_or_relayer();
        let chain_id = Self::evm_chain_id(&chain);
        let key = (chain_id, request_id);
        require!(!self.fulfilled.contains(&key), "request already fulfilled");
        require!(!self.pending.contains(&key), "request signing in progress");
        require!(
            max_fee_per_gas.0 <= self.max_fee_per_gas_cap,
            "max_fee_per_gas above cap"
        );
        require!(
            max_priority_fee_per_gas.0 <= max_fee_per_gas.0,
            "max_priority_fee_per_gas above max_fee_per_gas"
        );
        check_question_len(&question).unwrap_or_else(|e| env::panic_str(&e));
        let consensus = self.verify_consensus(chain.clone(), request_id, question.clone(), answers);
        if !consensus.ok {
            env::panic_str(&consensus.reason);
        }
        let built = self.build_fulfill_tx(
            chain,
            request_id,
            question,
            consensus.answer.clone(),
            nonce,
            max_fee_per_gas,
            max_priority_fee_per_gas,
        );
        self.pending.insert(key);
        let args = json!({
            "request": {
                "path": self.path,
                "payload_v2": { "Ecdsa": built.payload },
                "domain_id": 0
            }
        });
        Promise::new(self.signer.clone())
            .function_call(
                "sign".to_string(),
                serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(1),
                SIGN_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_signed(
                        chain_id,
                        request_id,
                        built.unsigned_tx,
                        built.payload,
                        consensus.answer,
                        consensus.votes,
                    ),
            )
    }

    #[private]
    pub fn on_signed(
        &mut self,
        #[callback_result] result: Result<Value, PromiseError>,
        chain_id: u64,
        request_id: u64,
        unsigned_tx: String,
        payload: String,
        answer: String,
        votes: Vec<Vote>,
    ) -> Value {
        let key = (chain_id, request_id);
        let chain = evm_chain_key(chain_id);
        self.pending.remove(&key);
        match result {
            Ok(signature) => {
                self.fulfilled.insert(key);
                emit_event(
                    "fulfilled",
                    json!({ "chain": chain, "request_id": request_id, "answer": answer, "votes": votes }),
                );
                json!({ "ok": true, "chain": chain, "request_id": request_id, "unsigned_tx": unsigned_tx, "payload": payload, "signature": signature })
            }
            Err(_) => {
                emit_event(
                    "sign_failed",
                    json!({ "chain": chain, "request_id": request_id }),
                );
                json!({ "ok": false, "chain": chain, "request_id": request_id, "unsigned_tx": unsigned_tx, "payload": payload })
            }
        }
    }
}

#[cfg(test)]
mod tests;
