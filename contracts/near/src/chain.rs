use near_sdk::env;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chain {
    Evm(u64),
    Near,
}

pub fn near_network() -> &'static str {
    if env::current_account_id().as_str().ends_with(".testnet") {
        "testnet"
    } else {
        "mainnet"
    }
}

pub fn near_chain_key() -> String {
    format!("near:{}", near_network())
}

pub fn evm_chain_key(chain_id: u64) -> String {
    format!("eip155:{chain_id}")
}

/// Chains are named with CAIP-2 strings so a NEAR request id can never be read as an EVM
/// chain id and so `verify_consensus` commands stay readable for people checking a verdict.
pub fn parse_chain(input: &str) -> Result<Chain, String> {
    let unknown = || {
        format!(
            "unknown chain {input}: use eip155:<chain id> or {}",
            near_chain_key()
        )
    };
    let (namespace, reference) = input.trim().split_once(':').ok_or_else(unknown)?;
    match namespace {
        "eip155" => {
            let valid = !reference.is_empty()
                && reference.chars().all(|c| c.is_ascii_digit())
                && !reference.starts_with('0');
            let chain_id = if valid {
                reference.parse::<u64>().ok()
            } else {
                None
            };
            chain_id.map(Chain::Evm).ok_or_else(unknown)
        }
        "near" if reference == near_network() => Ok(Chain::Near),
        _ => Err(unknown()),
    }
}
