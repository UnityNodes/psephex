use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;

const ORACLE: &str = "oracle.psephex.testnet";
const SELF: &str = "dispute.psephex.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const Q: &str = "Contract: deliver 10 pages. Evidence: 6 pages delivered. Was it fulfilled?";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN_STAKE: u128 = NEAR / 100;
const ORACLE_DEPOSIT: u128 = NEAR / 50;

fn ctx(predecessor: &str, deposit: u128, now_ns: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(SELF.parse().unwrap())
        .predecessor_account_id(predecessor.parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ns)
        .build());
}

fn setup() -> Dispute {
    ctx(ALICE, 0, 1_000);
    Dispute::new(ORACLE.parse().unwrap(), 300, U128(MIN_STAKE))
}

fn storage(c: &Dispute) -> u128 {
    c.storage_deposit(Q.to_string()).0
}

fn events() -> Vec<serde_json::Value> {
    get_logs()
        .iter()
        .filter_map(|l| {
            l.strip_prefix("EVENT_JSON:")
                .map(|s| serde_json::from_str(s).unwrap())
        })
        .collect()
}

fn open(c: &mut Dispute, stake: u128) -> u64 {
    let total = stake + ORACLE_DEPOSIT + storage(c);
    ctx(ALICE, total, 1_000);
    drop(c.open_dispute(Q.to_string(), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
    ctx(SELF, 0, 2_000);
    c.on_asked(Ok(7), 1).unwrap()
}

fn transfers_to(account: &str) -> Vec<u128> {
    get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id.as_str() == account)
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect()
}

#[test]
fn open_dispute_forwards_the_oracle_deposit_to_ask_with_callback() {
    let mut c = setup();
    let total = MIN_STAKE * 3 + ORACLE_DEPOSIT + storage(&c);
    ctx(ALICE, total, 1_000);
    drop(c.open_dispute(Q.to_string(), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
    let receipts = get_created_receipts();
    let ask = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == ORACLE)
        .expect("ask receipt");
    match &ask.actions[..] {
        [MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            ..
        }] => {
            assert_eq!(method_name, b"ask");
            let a: serde_json::Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a, json!({"question": Q, "callback": true}));
            assert_eq!(attached_deposit.as_yoctonear(), ORACLE_DEPOSIT);
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(receipts.iter().any(|r| r.receiver_id.as_str() == SELF));
}

#[test]
fn stake_is_what_remains_after_oracle_deposit_and_storage() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE * 3);
    let case = c.get_case(id).unwrap();
    assert_eq!(case.claimant.as_str(), ALICE);
    assert_eq!(case.counterparty.as_str(), BOB);
    assert!(case.amount.0 >= MIN_STAKE * 3);
    assert!(case.amount.0 < MIN_STAKE * 3 + storage(&c));
    assert_eq!(case.deadline_ns.0, 1_000 + 300 * 1_000_000_000);
    assert!(!case.settled && !case.escalated);
    assert_eq!(events().last().unwrap()["event"], "dispute_opened");
}

#[test]
#[should_panic(expected = "stake too low")]
fn stake_below_minimum_is_rejected() {
    let mut c = setup();
    let total = MIN_STAKE / 2 + ORACLE_DEPOSIT + storage(&c) / 2;
    ctx(ALICE, total, 1_000);
    drop(c.open_dispute(Q.to_string(), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
}

#[test]
#[should_panic(expected = "attach a stake above oracle deposit and storage")]
fn deposit_that_does_not_cover_costs_is_rejected() {
    let mut c = setup();
    ctx(ALICE, ORACLE_DEPOSIT, 1_000);
    drop(c.open_dispute(Q.to_string(), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
}

#[test]
#[should_panic(expected = "counterparty must differ from claimant")]
fn claimant_cannot_dispute_with_themselves() {
    let mut c = setup();
    ctx(ALICE, NEAR, 1_000);
    drop(c.open_dispute(Q.to_string(), ALICE.parse().unwrap(), U128(ORACLE_DEPOSIT)));
}

#[test]
#[should_panic(expected = "question too long")]
fn long_question_is_rejected_before_asking() {
    let mut c = setup();
    ctx(ALICE, NEAR, 1_000);
    drop(c.open_dispute("x".repeat(2001), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
}

#[test]
fn failed_ask_refunds_stake_and_oracle_deposit() {
    let mut c = setup();
    let total = MIN_STAKE * 2 + ORACLE_DEPOSIT + storage(&c);
    ctx(ALICE, total, 1_000);
    drop(c.open_dispute(Q.to_string(), BOB.parse().unwrap(), U128(ORACLE_DEPOSIT)));
    ctx(SELF, 0, 2_000);
    assert_eq!(c.on_asked(Err(PromiseError::Failed), 1), None);
    let refunded = transfers_to(ALICE);
    assert_eq!(refunded.len(), 1);
    assert!(refunded[0] >= MIN_STAKE * 2 + ORACLE_DEPOSIT);
    assert!(c.get_case(1).is_none());
    assert_eq!(events().last().unwrap()["event"], "ask_failed");
}

#[test]
fn second_on_asked_for_the_same_nonce_does_nothing() {
    let mut c = setup();
    open(&mut c, MIN_STAKE);
    ctx(SELF, 0, 3_000);
    assert_eq!(c.on_asked(Ok(8), 1), None);
    assert!(c.get_case(8).is_none());
    assert_eq!(events()[0]["event"], "orphan_ask");
}

#[test]
fn yes_pays_the_claimant() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE * 2);
    let amount = c.get_case(id).unwrap().amount.0;
    ctx(ORACLE, 0, 3_000);
    c.on_answer(id, "YES".to_string());
    assert_eq!(transfers_to(ALICE), vec![amount]);
    let case = c.get_case(id).unwrap();
    assert!(case.settled);
    assert_eq!(case.winner.unwrap().as_str(), ALICE);
}

#[test]
fn no_pays_the_counterparty() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE * 2);
    let amount = c.get_case(id).unwrap().amount.0;
    ctx(ORACLE, 0, 3_000);
    c.on_answer(id, "NO".to_string());
    assert_eq!(transfers_to(BOB), vec![amount]);
    assert_eq!(events()[0]["event"], "settled");
}

#[test]
fn unknown_escalates_and_allows_an_early_refund() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    let amount = c.get_case(id).unwrap().amount.0;
    ctx(ORACLE, 0, 3_000);
    c.on_answer(id, "UNKNOWN".to_string());
    let case = c.get_case(id).unwrap();
    assert!(case.escalated && !case.settled);
    ctx(BOB, 0, 4_000);
    c.refund(id);
    assert_eq!(transfers_to(ALICE), vec![amount]);
    assert!(c.get_case(id).unwrap().settled);
}

#[test]
#[should_panic(expected = "only the oracle")]
fn only_the_oracle_delivers_answers() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(ALICE, 0, 3_000);
    c.on_answer(id, "YES".to_string());
}

#[test]
#[should_panic(expected = "dispute already settled")]
fn settled_dispute_cannot_be_paid_twice() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(ORACLE, 0, 3_000);
    c.on_answer(id, "YES".to_string());
    c.on_answer(id, "NO".to_string());
}

#[test]
#[should_panic(expected = "too early")]
fn refund_waits_for_the_deadline() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(ALICE, 0, 5_000);
    c.refund(id);
}

#[test]
fn refund_after_deadline_returns_the_stake() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    let amount = c.get_case(id).unwrap().amount.0;
    ctx(BOB, 0, 1_000 + 300 * 1_000_000_000);
    c.refund(id);
    assert_eq!(transfers_to(ALICE), vec![amount]);
}

#[test]
#[should_panic(expected = "dispute already settled")]
fn answer_after_refund_is_rejected() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, 1_000 + 300 * 1_000_000_000);
    c.refund(id);
    ctx(ORACLE, 0, 1_000 + 301 * 1_000_000_000);
    c.on_answer(id, "YES".to_string());
}

#[test]
#[should_panic(expected = "unknown dispute")]
fn answer_for_an_unknown_id_panics_so_the_oracle_logs_a_failed_delivery() {
    let mut c = setup();
    ctx(ORACLE, 0, 3_000);
    c.on_answer(42, "YES".to_string());
}

#[test]
fn storage_charge_covers_the_settled_record() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    let before = env::storage_usage();
    ctx(ORACLE, 0, 3_000);
    c.on_answer(id, "YES".to_string());
    c.cases.flush();
    let grown = env::storage_usage().saturating_sub(before);
    assert!(u128::from(grown) * env::storage_byte_cost().as_yoctonear() <= storage(&c));
}

#[test]
#[should_panic(expected = "timeout must be positive")]
fn zero_timeout_is_rejected() {
    ctx(ALICE, 0, 0);
    Dispute::new(ORACLE.parse().unwrap(), 0, U128(0));
}
