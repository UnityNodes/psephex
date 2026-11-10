use crate::owner::owner_delay_ns;
use crate::{AiOracle, AiOracleExt, EvmChain, ModelKey, NearRequest};
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId};

#[near(serializers = [borsh])]
pub struct AiOracleV3 {
    pub owner: AccountId,
    pub signer: AccountId,
    pub path: String,
    pub chains: IterableMap<u64, EvmChain>,
    pub model_keys: IterableMap<String, ModelKey>,
    pub fulfilled: IterableSet<(u64, u64)>,
    pub relayers: IterableSet<AccountId>,
    pub pending: IterableSet<(u64, u64)>,
    pub max_fee_per_gas_cap: u128,
    pub near_fee: u128,
    pub near_requests: LookupMap<u64, NearRequest>,
    pub last_near_request_id: u64,
}

#[near]
impl AiOracle {
    /// Runs after every deploy of new code, inside the same batch. It reads either the v3 layout
    /// (no owner timelock yet) or the current one, so a later upgrade with the same layout also
    /// goes through here. Both paths refuse while an MPC signature is in flight: the deploy batch
    /// can land after a request entered `pending`, and a code change under it could strand it.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(owner_delay_seconds: Option<u64>) -> Self {
        let raw = env::storage_read(b"STATE")
            .unwrap_or_else(|| env::panic_str("no contract state to migrate"));
        if let Ok(old) = near_sdk::borsh::from_slice::<AiOracleV3>(&raw) {
            require!(
                old.pending.is_empty(),
                "pending signatures must finish before migration"
            );
            let seconds = owner_delay_seconds
                .unwrap_or_else(|| env::panic_str("v3 state needs owner_delay_seconds"));
            return Self {
                owner: old.owner,
                signer: old.signer,
                path: old.path,
                chains: old.chains,
                model_keys: old.model_keys,
                fulfilled: old.fulfilled,
                relayers: old.relayers,
                pending: old.pending,
                max_fee_per_gas_cap: old.max_fee_per_gas_cap,
                near_fee: old.near_fee,
                near_requests: old.near_requests,
                last_near_request_id: old.last_near_request_id,
                owner_delay_ns: owner_delay_ns(seconds),
                proposals: IterableMap::new(b"o"),
                last_proposal_id: 0,
            };
        }
        let mut current: AiOracle = near_sdk::borsh::from_slice(&raw)
            .unwrap_or_else(|_| env::panic_str("unknown contract state layout"));
        require!(
            current.pending.is_empty(),
            "pending signatures must finish before migration"
        );
        if let Some(seconds) = owner_delay_seconds {
            current.owner_delay_ns = owner_delay_ns(seconds);
        }
        current
    }
}
