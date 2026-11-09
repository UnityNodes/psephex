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

export const ORACLE_CLI_SNIPPET = `near contract call-function as-read-only oracle.psephex.testnet ask_deposit json-args '{"question":"Is 7 a prime number?"}' network-config testnet now

near contract call-function as-transaction oracle.psephex.testnet ask json-args '{"question":"Is 7 a prime number?"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as you.testnet network-config testnet sign-with-keychain send`;


export const COURT_CLI_SNIPPET = `# Buyer agent: price the deposit, then open the case
near contract call-function as-read-only oracle.psephex.testnet ask_deposit json-args '{"question":"<any 2000-byte string>"}' network-config testnet now
near contract call-function as-read-only psephex-court.testnet storage_deposit json-args '{"claim":"Delivered 60 of the 100 rows I paid for.","evidence":"Order: 100 rows. companies.csv has 60 data rows."}' network-config testnet now

near contract call-function as-transaction psephex-court.testnet open_case json-args '{"claim":"Delivered 60 of the 100 rows I paid for.","evidence":"Order: 100 rows. companies.csv has 60 data rows.","counterparty":"seller-agent.testnet","oracle_reserve":"<ask_deposit>"}' prepaid-gas '100 Tgas' attached-deposit '<stake + ask_deposit + storage_deposit> NEAR' sign-as buyer-agent.testnet network-config testnet sign-with-keychain send

# Seller agent: answer within the response window
near contract call-function as-transaction psephex-court.testnet respond json-args '{"case_id":1,"response":"Only 60 records matched the filter in the order."}' prepaid-gas '150 Tgas' attached-deposit '0 NEAR' sign-as seller-agent.testnet network-config testnet sign-with-keychain send

# Anyone: read the case and the question the models get
near contract call-function as-read-only psephex-court.testnet get_case json-args '{"case_id":1}' network-config testnet now
near contract call-function as-read-only psephex-court.testnet question_for json-args '{"case_id":1}' network-config testnet now`;
