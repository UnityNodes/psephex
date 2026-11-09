use crate::near_requests::checked_near_fee;
use crate::{AiOracle, AiOracleExt, EvmChain, ModelKey};
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId};

#[near(serializers = [borsh])]
pub struct AiOracleV2 {
    pub owner: AccountId,
    pub signer: AccountId,
    pub path: String,
    pub base_chain_id: u64,
    pub base_oracle_address: String,
    pub model_keys: IterableMap<String, ModelKey>,
    pub fulfilled: IterableSet<u64>,
    pub relayers: IterableSet<AccountId>,
    pub pending: IterableSet<u64>,
    pub max_fee_per_gas_cap: u128,
}

#[near]
impl AiOracle {
    /// v2 kept one EVM chain and fulfilled ids without a chain. Moving them under
    /// `(chain_id, id)` on the same account keeps the MPC path, so the EVM oracle address that
    /// Base trusts does not change, and already settled Base requests stay closed.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(base_chain_name: String, near_fee: U128) -> Self {
        let mut old: AiOracleV2 =
            env::state_read().unwrap_or_else(|| env::panic_str("no v2 state to migrate"));
        require!(
            old.pending.is_empty(),
            "pending signatures must finish before migration"
        );
        let mut fulfilled = IterableSet::new(b"F");
        for id in old.fulfilled.iter() {
            fulfilled.insert((old.base_chain_id, *id));
        }
        require!(old.base_chain_id > 0, "v2 chain id must be positive");
        old.fulfilled.clear();
        old.fulfilled.flush();
        old.pending.clear();
        old.pending.flush();
        let mut contract = Self {
            owner: old.owner,
            signer: old.signer,
            path: old.path,
            chains: IterableMap::new(b"c"),
            model_keys: old.model_keys,
            fulfilled,
            relayers: old.relayers,
            pending: IterableSet::new(b"P"),
            max_fee_per_gas_cap: old.max_fee_per_gas_cap,
            near_fee: checked_near_fee(near_fee.0),
            near_requests: LookupMap::new(b"n"),
            last_near_request_id: 0,
        };
        let name = base_chain_name.trim().to_string();
        require!(!name.is_empty(), "chain name must not be empty");
        contract.chains.insert(
            old.base_chain_id,
            EvmChain {
                name,
                oracle_address: old.base_oracle_address,
            },
        );
        contract
    }
}
