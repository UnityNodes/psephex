use crate::{
    decode_hex_exact, emit_event, is_supported_scheme, normalize_address, AiOracle, AiOracleExt,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, Gas, NearToken, Promise};
use serde_json::json;

pub const MIN_OWNER_DELAY_SECONDS: u64 = 60;
pub const MAX_OWNER_DELAY_SECONDS: u64 = 30 * 24 * 60 * 60;
const MAX_OPEN_PROPOSALS: u32 = 16;
const MIGRATE_GAS: Gas = Gas::from_tgas(100);
const MIGRATE_METHOD: &str = "migrate";
const EXECUTION_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * NANOS_PER_SECOND;
const NANOS_PER_SECOND: u64 = 1_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OwnerAction {
    SetModelKey {
        model: String,
        provider: String,
        scheme: String,
        public_key_hex: String,
    },
    RemoveModelKey {
        model: String,
    },
    SetChain {
        chain_id: u64,
        name: String,
        oracle_address: String,
    },
    RemoveChain {
        chain_id: u64,
    },
    ResetFulfilled {
        chain: String,
        request_id: u64,
    },
    SetOwnerDelay {
        seconds: u64,
    },
    SetMaxFeePerGasCap {
        cap: U128,
    },
    Upgrade {
        code_sha256: String,
        migrate_args: String,
    },
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Proposal {
    action: OwnerAction,
    proposed_at_ns: u64,
    ready_at_ns: u64,
}

#[near(serializers = [json])]
pub struct ProposalView {
    pub id: u64,
    pub action: OwnerAction,
    pub proposed_at_ns: U64,
    pub ready_at_ns: U64,
    pub expires_at_ns: U64,
    pub ready: bool,
    pub expired: bool,
}

pub fn owner_delay_ns(seconds: u64) -> u64 {
    require!(
        (MIN_OWNER_DELAY_SECONDS..=MAX_OWNER_DELAY_SECONDS).contains(&seconds),
        format!(
            "owner delay must be between {MIN_OWNER_DELAY_SECONDS} and {MAX_OWNER_DELAY_SECONDS} seconds"
        )
    );
    seconds * NANOS_PER_SECOND
}

fn expires_at(ready_at_ns: u64) -> u64 {
    ready_at_ns.saturating_add(EXECUTION_WINDOW_NS)
}

fn assert_runnable(p: &Proposal) {
    let now = env::block_timestamp();
    require!(
        now >= p.ready_at_ns,
        "the delay for this proposal has not passed"
    );
    require!(
        now <= expires_at(p.ready_at_ns),
        "this proposal expired, announce it again"
    );
}

fn normalized_sha256(hex_hash: &str) -> String {
    let bytes =
        decode_hex_exact(hex_hash, 32, "code sha256").unwrap_or_else(|e| env::panic_str(&e));
    hex::encode(bytes)
}

#[near]
impl AiOracle {
    /// Every change that decides which answers count (the model keys, the EVM targets, a reset of
    /// a settled request, the contract code) waits `owner_delay` after it is announced on chain, so
    /// a party with a case in flight sees it coming and can leave before it applies. A proposal
    /// can run for seven days after its delay, so an old announcement cannot be pulled out later.
    /// Relayers, the NEAR fee and lowering the gas cap stay immediate: none of them can change a
    /// verdict.
    pub fn propose(&mut self, action: OwnerAction) -> u64 {
        self.assert_owner();
        require!(
            self.proposals.len() < MAX_OPEN_PROPOSALS,
            "too many open proposals, execute or cancel one first"
        );
        let action = self.checked_action(action);
        let now = env::block_timestamp();
        let ready_at_ns = now.saturating_add(self.owner_delay_ns);
        self.last_proposal_id += 1;
        let id = self.last_proposal_id;
        self.proposals.insert(
            id,
            Proposal {
                action: action.clone(),
                proposed_at_ns: now,
                ready_at_ns,
            },
        );
        emit_event(
            "owner_change_proposed",
            json!({ "id": id, "action": action, "ready_at_ns": U64(ready_at_ns) }),
        );
        id
    }

    pub fn cancel(&mut self, proposal_id: u64) {
        self.assert_owner();
        require!(
            self.proposals.remove(&proposal_id).is_some(),
            "no such proposal"
        );
        emit_event("owner_change_cancelled", json!({ "id": proposal_id }));
    }

    pub fn execute(&mut self, proposal_id: u64) {
        self.assert_owner();
        let proposal = self
            .proposals
            .get(&proposal_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such proposal"));
        require!(
            !matches!(proposal.action, OwnerAction::Upgrade { .. }),
            "an upgrade runs through execute_upgrade with the code as input"
        );
        assert_runnable(&proposal);
        self.proposals.remove(&proposal_id);
        self.apply(proposal.action.clone());
        emit_event(
            "owner_change_executed",
            json!({ "id": proposal_id, "action": proposal.action }),
        );
    }

    /// The call input is the raw wasm. It runs only for code whose sha256 was announced and has
    /// waited the delay. Deploy and `migrate` with the announced arguments are one batch on this
    /// account, so a failing migration leaves the old code in place instead of a half-migrated
    /// contract. Every upgrade calls `migrate`, and `migrate` checks again that no MPC signature
    /// is in flight, because a request can enter `pending` between this call and the batch.
    pub fn execute_upgrade(&mut self) -> Promise {
        self.assert_owner();
        require!(
            self.pending.is_empty(),
            "pending signatures must finish before an upgrade"
        );
        let code = env::input().unwrap_or_else(|| env::panic_str("no code in the call input"));
        let hash = hex::encode(env::sha256_array(&code));
        let (id, proposal) = self
            .proposals
            .iter()
            .find(|(_, p)| {
                matches!(&p.action, OwnerAction::Upgrade { code_sha256, .. } if *code_sha256 == hash)
            })
            .map(|(id, p)| (*id, p.clone()))
            .unwrap_or_else(|| env::panic_str("no announced upgrade for this code"));
        assert_runnable(&proposal);
        self.proposals.remove(&id);
        emit_event(
            "owner_change_executed",
            json!({ "id": id, "action": proposal.action }),
        );
        let OwnerAction::Upgrade { migrate_args, .. } = proposal.action else {
            env::panic_str("the matched proposal is not an upgrade")
        };
        Promise::new(env::current_account_id())
            .deploy_contract(code)
            .function_call(
                MIGRATE_METHOD.to_string(),
                migrate_args.into_bytes(),
                NearToken::from_yoctonear(0),
                MIGRATE_GAS,
            )
    }

    pub fn proposals(&self) -> Vec<ProposalView> {
        let now = env::block_timestamp();
        self.proposals
            .iter()
            .map(|(id, p)| ProposalView {
                id: *id,
                action: p.action.clone(),
                proposed_at_ns: U64(p.proposed_at_ns),
                ready_at_ns: U64(p.ready_at_ns),
                expires_at_ns: U64(expires_at(p.ready_at_ns)),
                ready: now >= p.ready_at_ns,
                expired: now > expires_at(p.ready_at_ns),
            })
            .collect()
    }

    pub fn owner_delay_seconds(&self) -> U64 {
        U64(self.owner_delay_ns / NANOS_PER_SECOND)
    }

    fn checked_action(&self, action: OwnerAction) -> OwnerAction {
        match action {
            OwnerAction::SetModelKey {
                model,
                provider,
                scheme,
                public_key_hex,
            } => {
                require!(!model.trim().is_empty(), "model must not be empty");
                require!(!provider.trim().is_empty(), "provider must not be empty");
                if !is_supported_scheme(&scheme) {
                    env::panic_str(&format!("unsupported signature scheme: {scheme}"));
                }
                decode_hex_exact(&public_key_hex, 32, "public key")
                    .unwrap_or_else(|e| env::panic_str(&e));
                OwnerAction::SetModelKey {
                    model,
                    provider,
                    scheme,
                    public_key_hex,
                }
            }
            OwnerAction::RemoveModelKey { model } => {
                require!(self.model_keys.contains_key(&model), "no such model");
                OwnerAction::RemoveModelKey { model }
            }
            OwnerAction::SetChain {
                chain_id,
                name,
                oracle_address,
            } => {
                require!(chain_id > 0, "chain id must be positive");
                require!(!name.trim().is_empty(), "chain name must not be empty");
                normalize_address(&oracle_address);
                OwnerAction::SetChain {
                    chain_id,
                    name,
                    oracle_address,
                }
            }
            OwnerAction::RemoveChain { chain_id } => {
                require!(self.chains.contains_key(&chain_id), "no such chain");
                OwnerAction::RemoveChain { chain_id }
            }
            OwnerAction::ResetFulfilled { chain, request_id } => {
                Self::evm_chain_id(&chain);
                OwnerAction::ResetFulfilled { chain, request_id }
            }
            OwnerAction::SetOwnerDelay { seconds } => {
                owner_delay_ns(seconds);
                OwnerAction::SetOwnerDelay { seconds }
            }
            OwnerAction::SetMaxFeePerGasCap { cap } => {
                require!(cap.0 > 0, "fee cap must be positive");
                OwnerAction::SetMaxFeePerGasCap { cap }
            }
            OwnerAction::Upgrade {
                code_sha256,
                migrate_args,
            } => {
                let parsed: serde_json::Value = serde_json::from_str(&migrate_args)
                    .unwrap_or_else(|_| env::panic_str("migrate args must be JSON"));
                require!(parsed.is_object(), "migrate args must be a JSON object");
                let code_sha256 = normalized_sha256(&code_sha256);
                require!(
                    !self.proposals.values().any(|p| matches!(
                        &p.action,
                        OwnerAction::Upgrade { code_sha256: open, .. } if *open == code_sha256
                    )),
                    "an upgrade for this code is already announced"
                );
                OwnerAction::Upgrade {
                    code_sha256,
                    migrate_args,
                }
            }
        }
    }

    fn apply(&mut self, action: OwnerAction) {
        match action {
            OwnerAction::SetModelKey {
                model,
                provider,
                scheme,
                public_key_hex,
            } => self.set_model_key(model, provider, scheme, public_key_hex),
            OwnerAction::RemoveModelKey { model } => self.remove_model_key(model),
            OwnerAction::SetChain {
                chain_id,
                name,
                oracle_address,
            } => self.set_chain(chain_id, name, oracle_address),
            OwnerAction::RemoveChain { chain_id } => {
                self.remove_chain(chain_id);
            }
            OwnerAction::ResetFulfilled { chain, request_id } => {
                self.reset_fulfilled(chain, request_id);
            }
            OwnerAction::SetOwnerDelay { seconds } => self.owner_delay_ns = owner_delay_ns(seconds),
            OwnerAction::SetMaxFeePerGasCap { cap } => self.max_fee_per_gas_cap = cap.0,
            OwnerAction::Upgrade { .. } => {
                env::panic_str("an upgrade runs through execute_upgrade with the code as input")
            }
        }
    }
}
