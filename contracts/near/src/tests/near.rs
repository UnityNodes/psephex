use super::*;
use near_sdk::mock::MockAction;
use near_sdk::{PromiseOrValue, PromiseResult, RuntimeFeesConfig};

const ALICE: &str = "alice.testnet";
const NEAR_Q: &str = "Contract: deliver a logo as a PNG file of at least 512x512 pixels. Evidence: the claimant delivered logo.png, 1024x1024 pixels. Was the contract fulfilled?";

fn near() -> String {
    near_chain_key()
}

fn near_answer(
    c: &AiOracle,
    request_id: u64,
    question: &str,
    i: usize,
    content: &str,
) -> ModelAnswer {
    let model = MODELS3[i];
    let response_body = response_with(content);
    let text = c.signed_text(
        near(),
        request_id,
        question.to_string(),
        model.to_string(),
        response_body.clone(),
    );
    ModelAnswer {
        model: model.to_string(),
        response_body,
        signature_hex: hex::encode(key_n(i).sign(text.as_bytes()).to_bytes()),
    }
}

fn near_answers(
    c: &AiOracle,
    request_id: u64,
    question: &str,
    contents: [&str; 3],
) -> Vec<ModelAnswer> {
    (0..3)
        .map(|i| near_answer(c, request_id, question, i, contents[i]))
        .collect()
}

fn setup_near() -> AiOracle {
    let c = setup3_with_relayer();
    ctx_as(ALICE, 0);
    c
}

fn required(c: &AiOracle, question: &str) -> u128 {
    c.ask_charge(ALICE.parse().unwrap(), question.to_string())
}

fn ask_as(
    c: &mut AiOracle,
    account: &str,
    deposit: u128,
    question: &str,
    callback: Option<bool>,
) -> u64 {
    ctx_as(account, deposit);
    c.ask(question.to_string(), callback)
}

#[test]
fn ask_stores_the_request_and_refunds_the_excess() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    let id = ask_as(&mut c, ALICE, need + 5, NEAR_Q, None);
    assert_eq!(id, 1);
    let r = c.near_request(1).unwrap();
    assert_eq!(r.chain, "near:testnet");
    assert_eq!(r.asker.as_str(), ALICE);
    assert_eq!(r.question, NEAR_Q);
    assert_eq!(r.paid, U128(need));
    assert!(!r.callback);
    assert!(r.answer.is_none());
    assert_eq!(r.question_hash, c.question_hash(NEAR_Q.to_string()));
    let refund = near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .find(|rc| rc.receiver_id.as_str() == ALICE)
        .expect("refund receipt");
    assert!(
        matches!(&refund.actions[..], [MockAction::Transfer { deposit, .. }] if deposit.as_yoctonear() == 5)
    );
    let asked = &event_logs()[0];
    assert_eq!(asked["event"], "asked");
    assert_eq!(asked["version"], "1.1.0");
    assert_eq!(asked["data"][0]["chain"], "near:testnet");
    assert_eq!(asked["data"][0]["request_id"], 1);
    assert_eq!(asked["data"][0]["asker"], ALICE);
}

#[test]
fn exact_deposit_creates_no_refund() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need, NEAR_Q, None);
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

#[test]
#[should_panic(expected = "attach at least")]
fn ask_rejects_a_deposit_below_fee_plus_storage() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need - 1, NEAR_Q, None);
}

#[test]
fn storage_charge_covers_the_answered_record_exactly() {
    let mut c = setup_near();
    let need = c.ask_charge(RELAYER.parse().unwrap(), NEAR_Q.to_string());
    ctx_as(RELAYER, need);
    let before = env::storage_usage();
    c.ask(NEAR_Q.to_string(), None);
    c.near_requests.flush();
    let asked = env::storage_usage() - before;
    let answers = near_answers(&c, 1, NEAR_Q, ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
    let _ = c.fulfill_on_near(1, answers);
    c.near_requests.flush();
    let answered = env::storage_usage() - before;
    assert!(answered > asked);
    let longest = MODELS3.iter().map(|m| m.len()).max().unwrap() as u64;
    let slack: u64 = MODELS3.iter().map(|m| longest - m.len() as u64).sum();
    assert_eq!(
        need - c.near_fee().0,
        u128::from(answered + slack) * env::storage_byte_cost().as_yoctonear()
    );
}

#[test]
fn ask_deposit_covers_the_longest_account_id() {
    let mut c = setup_near();
    let quote = c.ask_deposit(NEAR_Q.to_string()).0;
    assert!(quote > required(&c, NEAR_Q));
    let longest = "a".repeat(64);
    ask_as(&mut c, &longest, quote, NEAR_Q, None);
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

#[test]
#[should_panic(expected = "question must not be empty")]
fn ask_rejects_an_empty_question() {
    let mut c = setup_near();
    ask_as(&mut c, ALICE, 10u128.pow(24), "   ", None);
}

#[test]
#[should_panic(expected = "question too long")]
fn ask_rejects_a_question_over_the_limit() {
    let mut c = setup_near();
    ask_as(
        &mut c,
        ALICE,
        10u128.pow(24),
        &"x".repeat(MAX_QUESTION_BYTES + 1),
        None,
    );
}

#[test]
fn ids_increment_and_pages_are_capped() {
    let mut c = setup_near();
    let need = required(&c, "q");
    for _ in 0..3 {
        ask_as(&mut c, ALICE, need, "q", None);
    }
    assert_eq!(c.last_near_request_id(), 3);
    assert_eq!(c.config()["last_near_request_id"], 3);
    let ids = |v: Vec<NearRequestView>| v.iter().map(|r| r.request_id).collect::<Vec<_>>();
    assert_eq!(ids(c.near_requests(0, 10)), vec![1, 2, 3]);
    assert_eq!(ids(c.near_requests(2, 1)), vec![2]);
    assert_eq!(ids(c.near_requests(3, 10)), vec![3]);
    assert!(c.near_requests(4, 10).is_empty());
    assert!(c.near_requests(1, 0).is_empty());
    assert!(c.near_request(4).is_none());
    assert_eq!(ids(c.near_requests(1, u64::MAX)).len(), 3);
}

#[test]
fn near_prompt_names_the_contract_not_an_evm_address() {
    let c = setup_near();
    let body = c.build_request(near(), 1, NEAR_Q.to_string(), MODELS3[0].to_string());
    assert!(body.contains("resolving request #1 for the NEAR contract oracle.testnet. Question: "));
    assert!(!body.contains("EVM chain"));
    assert_ne!(
        body,
        c.build_request(base(), 1, NEAR_Q.to_string(), MODELS3[0].to_string())
    );
}

#[test]
fn relayer_fulfills_a_near_request_and_the_verdict_is_stored() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need, NEAR_Q, None);
    let answers = near_answers(&c, 1, NEAR_Q, ["YES", "NO", "YES"]);
    ctx_as(RELAYER, 0);
    let out = c.fulfill_on_near(1, answers);
    match out {
        PromiseOrValue::Value(v) => {
            assert_eq!(v["ok"], true);
            assert_eq!(v["answer"], "YES");
            assert_eq!(v["chain"], "near:testnet");
        }
        PromiseOrValue::Promise(_) => panic!("no callback was requested"),
    }
    let r = c.near_request(1).unwrap();
    assert_eq!(r.answer.as_deref(), Some("YES"));
    assert_eq!(r.votes.len(), 3);
    assert!(r.answered_ns.is_some());
    assert!(c.is_fulfilled(near(), 1));
    assert!(!c.is_pending(near(), 1));
    assert!(!c.is_fulfilled(base(), 1));
    let fulfilled = event_logs()
        .into_iter()
        .find(|e| e["event"] == "fulfilled")
        .unwrap();
    assert_eq!(fulfilled["data"][0]["chain"], "near:testnet");
    assert_eq!(fulfilled["data"][0]["answer"], "YES");
    assert_eq!(fulfilled["data"][0]["votes"][1]["answer"], "NO");
}

#[test]
fn verdict_comes_from_stored_question_not_relayer_input() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need, NEAR_Q, None);
    let other = "Was the contract breached?";
    let forged = near_answers(&c, 1, other, ["NO", "NO", "NO"]);
    ctx_as(RELAYER, 0);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.fulfill_on_near(1, forged)
    }));
    assert!(result.is_err());
}

#[test]
#[should_panic(expected = "invalid signature")]
fn answers_signed_for_base_do_not_fulfill_a_near_request() {
    let mut c = setup_near();
    let need = required(&c, QUESTION);
    ask_as(&mut c, ALICE, need, QUESTION, None);
    let base_answers = answers3(&c, 1, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_near(1, base_answers);
}

#[test]
#[should_panic(expected = "only owner or relayer")]
fn stranger_cannot_fulfill_a_near_request() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need, NEAR_Q, None);
    let answers = near_answers(&c, 1, NEAR_Q, ["YES", "YES", "YES"]);
    ctx_as(ALICE, 0);
    let _ = c.fulfill_on_near(1, answers);
}

#[test]
#[should_panic(expected = "unknown NEAR request")]
fn unknown_near_request_cannot_be_fulfilled() {
    let mut c = setup_near();
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_near(9, vec![]);
}

#[test]
#[should_panic(expected = "request already fulfilled")]
fn near_request_is_fulfilled_once() {
    let mut c = setup_near();
    let need = required(&c, NEAR_Q);
    ask_as(&mut c, ALICE, need, NEAR_Q, None);
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_near(1, near_answers(&c, 1, NEAR_Q, ["YES", "YES", "YES"]));
    let _ = c.fulfill_on_near(1, near_answers(&c, 1, NEAR_Q, ["NO", "NO", "NO"]));
}

#[test]
fn callback_request_calls_on_answer_of_the_asker() {
    let mut c = setup_near();
    let dispute = "dispute.testnet";
    let need = c.ask_deposit(NEAR_Q.to_string()).0;
    ask_as(&mut c, dispute, need, NEAR_Q, Some(true));
    assert!(c.near_request(1).unwrap().callback);
    let answers = near_answers(&c, 1, NEAR_Q, ["NO", "NO", "YES"]);
    ctx_as(RELAYER, 0);
    let out = c.fulfill_on_near(1, answers);
    assert!(matches!(out, PromiseOrValue::Promise(_)));
    drop(out);
    let receipts = near_sdk::test_utils::get_created_receipts();
    let call = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == dispute)
        .expect("on_answer receipt");
    match &call.actions[..] {
        [MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        }] => {
            assert_eq!(method_name, b"on_answer");
            let a: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a, json!({"request_id": 1, "answer": "NO"}));
            assert_eq!(attached_deposit.as_yoctonear(), 0);
            assert!(prepaid_gas.as_tgas() >= 30);
        }
        other => panic!("unexpected actions {other:?}"),
    }
    assert!(receipts
        .iter()
        .any(|r| r.receiver_id.as_str() == ORACLE_ACCOUNT));
}

fn with_promise_result(result: PromiseResult) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(ORACLE_ACCOUNT.parse().unwrap())
            .current_account_id(ORACLE_ACCOUNT.parse().unwrap())
            .build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

#[test]
fn failed_delivery_is_logged_without_panicking() {
    let mut c = setup_near();
    with_promise_result(PromiseResult::Failed);
    assert!(!c.on_client_answered(4));
    assert_eq!(
        event_logs(),
        vec![
            json!({"standard": "psephex", "version": "1.1.0", "event": "callback", "data": [{"chain": "near:testnet", "request_id": 4, "ok": false}]})
        ]
    );
}

#[test]
fn successful_delivery_with_any_return_value_is_ok() {
    let mut c = setup_near();
    with_promise_result(PromiseResult::Successful(b"\"settled\"".to_vec()));
    assert!(c.on_client_answered(4));
    with_promise_result(PromiseResult::Successful(vec![]));
    assert!(c.on_client_answered(5));
}

#[test]
fn owner_sets_the_near_fee_up_to_one_near() {
    let mut c = setup_near();
    owner_ctx();
    c.set_near_fee(U128(10u128.pow(24)));
    assert_eq!(c.near_fee(), U128(10u128.pow(24)));
}

#[test]
#[should_panic(expected = "near fee above 1 NEAR")]
fn near_fee_is_capped() {
    let mut c = setup_near();
    owner_ctx();
    c.set_near_fee(U128(10u128.pow(24) + 1));
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_set_the_near_fee() {
    let mut c = setup_near();
    ctx_as(RELAYER, 0);
    c.set_near_fee(U128(0));
}

fn owner_with_balance(near: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("owner.testnet".parse().unwrap())
        .current_account_id(ORACLE_ACCOUNT.parse().unwrap())
        .account_balance(NearToken::from_near(near))
        .storage_usage(10_000)
        .build());
}

#[test]
fn owner_withdraws_fees_above_the_reserve() {
    let mut c = setup_near();
    owner_with_balance(5);
    let _ = c.withdraw(U128(10u128.pow(24)));
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert!(receipts
        .iter()
        .any(|r| r.receiver_id.as_str() == "owner.testnet"));
}

#[test]
#[should_panic(expected = "amount above withdrawable balance")]
fn withdraw_keeps_one_near_and_storage() {
    let mut c = setup_near();
    owner_with_balance(5);
    let _ = c.withdraw(U128(4 * 10u128.pow(24)));
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_withdraw() {
    let mut c = setup_near();
    ctx_as(RELAYER, 0);
    let _ = c.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "this method needs an eip155 chain")]
fn fulfill_on_evm_refuses_the_near_chain() {
    let mut c = setup_near();
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_evm(near(), 1, NEAR_Q.to_string(), vec![], 0, U128(1), U128(1));
}
