export const NEAR_CLIENT_SNIPPET = `use near_sdk::{env, near, require, Gas, Promise};
use serde_json::json;

const ORACLE: &str = "oracle.psephex.testnet";

#[near]
impl MyContract {
    #[payable]
    pub fn ask_oracle(&mut self, question: String) -> Promise {
        let args = json!({ "question": question, "callback": true });
        Promise::new(ORACLE.parse().unwrap()).function_call(
            "ask".to_string(),
            args.to_string().into_bytes(),
            env::attached_deposit(),
            Gas::from_tgas(30),
        )
    }

    pub fn on_answer(&mut self, request_id: u64, answer: String) {
        require!(env::predecessor_account_id().as_str() == ORACLE, "only the oracle");
        self.verdicts.insert(request_id, answer);
    }
}`;

export const NEAR_CLI_SNIPPET = `near contract call-function as-read-only oracle.psephex.testnet ask_deposit json-args '{"question":"Is 7 a prime number?"}' network-config testnet now

near contract call-function as-transaction oracle.psephex.testnet ask json-args '{"question":"Is 7 a prime number?"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as you.testnet network-config testnet sign-with-keychain send`;
