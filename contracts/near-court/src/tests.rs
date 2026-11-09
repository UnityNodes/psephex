use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;

const ORACLE: &str = "oracle.psephex.testnet";
const SELF: &str = "court.psephex.testnet";
const OWNER: &str = "psephex.testnet";
const ARBITER: &str = "arbiter.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MIN_STAKE: u128 = NEAR / 100;
const BOND: u128 = NEAR / 50;
const ORACLE_DEPOSIT: u128 = NEAR / 50;
const CLAIM: &str = "I delivered the 100-row dataset agent B ordered.";
const EVIDENCE: &str = "dataset.csv has 100 rows and the agreed columns.";
const RESPONSE: &str = "Only 60 rows were delivered.";
const T0: u64 = 1_000_000;
const WINDOW: u64 = 120 * NS_PER_SEC;

fn ctx(predecessor: &str, deposit: u128, now_ns: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(SELF.parse().unwrap())
        .predecessor_account_id(predecessor.parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now_ns)
        .build());
}

fn setup() -> Court {
    ctx(OWNER, 0, T0);
    Court::new(
        OWNER.parse().unwrap(),
        ORACLE.parse().unwrap(),
        ARBITER.parse().unwrap(),
        U128(MIN_STAKE),
        U128(BOND),
        120,
        120,
        600,
    )
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

fn ask_args() -> serde_json::Value {
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
            assert_eq!(attached_deposit.as_yoctonear(), ORACLE_DEPOSIT);
            serde_json::from_slice(args).unwrap()
        }
        other => panic!("unexpected {other:?}"),
    }
}

fn open(c: &mut Court, stake: u128) -> u64 {
    let total =
        stake + ORACLE_DEPOSIT + c.storage_deposit(CLAIM.to_string(), EVIDENCE.to_string()).0;
    ctx(ALICE, total, T0);
    c.open_case(
        CLAIM.to_string(),
        EVIDENCE.to_string(),
        BOB.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    )
}

fn to_verdict(c: &mut Court, answer: &str) -> u64 {
    let id = open(c, MIN_STAKE * 5);
    ctx(BOB, 0, T0 + 10);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(SELF, 0, T0 + 20);
    assert_eq!(c.on_asked(Ok(7), id), Some(7));
    ctx(ORACLE, 0, T0 + 30);
    c.on_answer(7, answer.to_string());
    id
}

#[test]
fn opening_a_case_waits_for_the_counterparty() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE * 3);
    assert_eq!(id, 1);
    let case = c.get_case(1).unwrap();
    assert_eq!(case.stage, Stage::AwaitingResponse);
    assert_eq!(case.claimant.as_str(), ALICE);
    assert_eq!(case.counterparty.as_str(), BOB);
    assert_eq!(case.amount.0, MIN_STAKE * 3);
    assert_eq!(case.respond_by_ns.0, T0 + WINDOW);
    assert!(get_created_receipts().is_empty());
    assert_eq!(events()[0]["event"], "opened");
}

#[test]
fn counterparty_response_goes_to_the_oracle_with_both_sides() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    let args = ask_args();
    let q = args["question"].as_str().unwrap();
    assert_eq!(args["callback"], true);
    assert_eq!(
        q,
        format!("Claim by {ALICE}: {CLAIM}\nEvidence from {ALICE}: {EVIDENCE}\nResponse from {BOB}: {RESPONSE}\nBased only on the evidence above, is the claim true?")
    );
    assert_eq!(c.get_case(id).unwrap().stage, Stage::Asking);
    assert_eq!(c.question_for(id), q);
}

#[test]
#[should_panic(expected = "only the counterparty can respond")]
fn only_the_counterparty_responds() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(ALICE, 0, T0 + 5);
    drop(c.respond(id, "I agree with myself".to_string()));
}

#[test]
#[should_panic(expected = "the response window is over")]
fn a_late_response_is_refused() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + WINDOW);
    drop(c.respond(id, RESPONSE.to_string()));
}

#[test]
#[should_panic(expected = "the counterparty can still respond")]
fn submit_waits_for_the_response_window() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(ALICE, 0, T0 + WINDOW - 1);
    drop(c.submit(id));
}

#[test]
fn silence_is_recorded_and_anyone_can_submit_after_the_window() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx("carol.testnet", 0, T0 + WINDOW);
    drop(c.submit(id));
    let q = ask_args()["question"].as_str().unwrap().to_string();
    assert!(q.contains(&format!(
        "Response from {BOB}: No response within the response window."
    )));
}

#[test]
#[should_panic(expected = "the case is not waiting for a response")]
fn a_case_is_asked_once() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(BOB, 0, T0 + 6);
    drop(c.respond(id, "again".to_string()));
}

#[test]
fn a_refused_ask_returns_stake_and_oracle_deposit() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE * 2);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(SELF, 0, T0 + 6);
    assert_eq!(c.on_asked(Err(PromiseError::Failed), id), None);
    assert_eq!(transfers_to(ALICE), vec![MIN_STAKE * 2 + ORACLE_DEPOSIT]);
    assert_eq!(c.get_case(id).unwrap().stage, Stage::Refunded);
    ctx(SELF, 0, T0 + 7);
    assert_eq!(c.on_asked(Ok(9), id), None);
    assert!(c.case_by_request(9).is_none());
}

#[test]
fn the_verdict_opens_the_appeal_window() {
    let mut c = setup();
    let id = to_verdict(&mut c, "YES");
    let case = c.get_case(id).unwrap();
    assert_eq!(case.stage, Stage::Decided);
    assert_eq!(case.verdict.as_deref(), Some("YES"));
    assert_eq!(case.appeal_by_ns.unwrap().0, T0 + 30 + WINDOW);
    assert_eq!(c.case_by_request(7), Some(id));
}

#[test]
fn an_unexpected_answer_is_unknown() {
    let mut c = setup();
    let id = to_verdict(&mut c, "MAYBE");
    assert_eq!(c.get_case(id).unwrap().verdict.as_deref(), Some("UNKNOWN"));
}

#[test]
#[should_panic(expected = "only the oracle")]
fn only_the_oracle_answers() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(SELF, 0, T0 + 6);
    c.on_asked(Ok(7), id);
    ctx(ALICE, 0, T0 + 7);
    c.on_answer(7, "YES".to_string());
}

#[test]
#[should_panic(expected = "unknown request")]
fn an_answer_for_an_unknown_request_panics() {
    let mut c = setup();
    ctx(ORACLE, 0, T0);
    c.on_answer(99, "YES".to_string());
}

#[test]
#[should_panic(expected = "the appeal window is still open")]
fn finalize_waits_for_the_appeal_window() {
    let mut c = setup();
    let id = to_verdict(&mut c, "YES");
    ctx("carol.testnet", 0, T0 + 30 + WINDOW - 1);
    c.finalize(id);
}

#[test]
fn finalize_pays_by_the_verdict() {
    for (answer, payee) in [("YES", ALICE), ("NO", BOB), ("UNKNOWN", ALICE)] {
        let mut c = setup();
        let id = to_verdict(&mut c, answer);
        ctx("carol.testnet", 0, T0 + 30 + WINDOW);
        c.finalize(id);
        assert_eq!(transfers_to(payee), vec![MIN_STAKE * 5], "{answer}");
        let case = c.get_case(id).unwrap();
        assert_eq!(case.stage, Stage::Settled);
        assert_eq!(case.winner.unwrap().as_str(), payee);
    }
}

#[test]
fn the_losing_side_appeals_with_the_exact_bond() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND, T0 + 40);
    c.appeal(id);
    let case = c.get_case(id).unwrap();
    assert_eq!(case.stage, Stage::Appealed);
    assert_eq!(case.appellant.unwrap().as_str(), ALICE);
    assert_eq!(case.appeal_bond.0, BOND);
}

#[test]
#[should_panic(expected = "attach exactly the appeal bond")]
fn an_appeal_needs_the_exact_bond() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND - 1, T0 + 40);
    c.appeal(id);
}

#[test]
#[should_panic(expected = "only a party can appeal")]
fn outsiders_cannot_appeal() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx("carol.testnet", BOND, T0 + 40);
    c.appeal(id);
}

#[test]
#[should_panic(expected = "the appeal window is over")]
fn a_late_appeal_is_refused() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND, T0 + 30 + WINDOW);
    c.appeal(id);
}

#[test]
#[should_panic(expected = "only a decided case can be finalized")]
fn an_appealed_case_waits_for_the_arbiter() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND, T0 + 40);
    c.appeal(id);
    ctx("carol.testnet", 0, T0 + 30 + WINDOW);
    c.finalize(id);
}

#[test]
fn the_arbiter_decides_and_the_winner_takes_stake_and_bond() {
    for (ruling, payee) in [("claimant", ALICE), ("counterparty", BOB)] {
        let mut c = setup();
        let id = to_verdict(&mut c, "NO");
        ctx(ALICE, BOND, T0 + 40);
        c.appeal(id);
        ctx(ARBITER, 0, T0 + 50);
        c.arbitrate(id, ruling.to_string());
        assert_eq!(transfers_to(payee), vec![MIN_STAKE * 5 + BOND], "{ruling}");
        assert_eq!(c.get_case(id).unwrap().winner.unwrap().as_str(), payee);
        assert_eq!(events().last().unwrap()["event"], "arbitrated");
    }
}

#[test]
#[should_panic(expected = "only the arbiter")]
fn only_the_arbiter_arbitrates() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND, T0 + 40);
    c.appeal(id);
    ctx(ALICE, 0, T0 + 50);
    c.arbitrate(id, "claimant".to_string());
}

#[test]
#[should_panic(expected = "winner must be claimant or counterparty")]
fn the_ruling_names_a_side() {
    let mut c = setup();
    let id = to_verdict(&mut c, "NO");
    ctx(ALICE, BOND, T0 + 40);
    c.appeal(id);
    ctx(ARBITER, 0, T0 + 50);
    c.arbitrate(id, "both".to_string());
}

#[test]
fn refund_after_the_oracle_timeout() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(SELF, 0, T0 + 6);
    c.on_asked(Ok(7), id);
    ctx(BOB, 0, T0 + 6 + 600 * NS_PER_SEC);
    c.refund(id);
    assert_eq!(transfers_to(ALICE), vec![MIN_STAKE]);
    assert_eq!(c.get_case(id).unwrap().stage, Stage::Refunded);
}

#[test]
#[should_panic(expected = "the oracle can still answer")]
fn refund_waits_for_the_oracle_timeout() {
    let mut c = setup();
    let id = open(&mut c, MIN_STAKE);
    ctx(BOB, 0, T0 + 5);
    drop(c.respond(id, RESPONSE.to_string()));
    ctx(SELF, 0, T0 + 6);
    c.on_asked(Ok(7), id);
    ctx(BOB, 0, T0 + 7);
    c.refund(id);
}

#[test]
#[should_panic(expected = "stake too low")]
fn the_stake_has_a_minimum() {
    let mut c = setup();
    let total = MIN_STAKE / 2
        + ORACLE_DEPOSIT
        + c.storage_deposit(CLAIM.to_string(), EVIDENCE.to_string()).0;
    ctx(ALICE, total, T0);
    c.open_case(
        CLAIM.to_string(),
        EVIDENCE.to_string(),
        BOB.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    );
}

#[test]
#[should_panic(expected = "evidence too long")]
fn fields_have_a_byte_limit() {
    let mut c = setup();
    ctx(ALICE, NEAR, T0);
    c.open_case(
        CLAIM.to_string(),
        "x".repeat(MAX_FIELD_BYTES + 1),
        BOB.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    );
}

#[test]
#[should_panic(expected = "claim must not be empty")]
fn the_claim_is_required() {
    let mut c = setup();
    ctx(ALICE, NEAR, T0);
    c.open_case(
        " ".to_string(),
        EVIDENCE.to_string(),
        BOB.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    );
}

#[test]
#[should_panic(expected = "counterparty must differ from claimant")]
fn no_case_against_yourself() {
    let mut c = setup();
    ctx(ALICE, NEAR, T0);
    c.open_case(
        CLAIM.to_string(),
        EVIDENCE.to_string(),
        ALICE.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    );
}

#[test]
fn the_longest_case_fits_the_oracle_limit() {
    let longest = "a".repeat(64);
    let case = Case {
        claimant: longest.parse().unwrap(),
        counterparty: format!("b{}", "a".repeat(63)).parse().unwrap(),
        amount: U128(0),
        oracle_deposit: U128(0),
        claim: "é".repeat(MAX_FIELD_BYTES / 2),
        evidence: "x".repeat(MAX_FIELD_BYTES),
        response: Some("y".repeat(MAX_FIELD_BYTES)),
        stage: Stage::AwaitingResponse,
        opened_ns: U64(0),
        respond_by_ns: U64(0),
        request_id: None,
        answer_by_ns: None,
        verdict: None,
        appeal_by_ns: None,
        appellant: None,
        appeal_bond: U128(0),
        winner: None,
    };
    assert!(
        oracle_question(&case).len() <= 2000,
        "{}",
        oracle_question(&case).len()
    );
}

#[test]
fn storage_charge_covers_the_finished_case() {
    let mut c = setup();
    let charge = c.storage_deposit(CLAIM.to_string(), EVIDENCE.to_string()).0;
    let total = MIN_STAKE * 5 + ORACLE_DEPOSIT + charge;
    ctx(BOB, total, T0);
    let before = env::storage_usage();
    let id = c.open_case(
        CLAIM.to_string(),
        EVIDENCE.to_string(),
        ALICE.parse().unwrap(),
        U128(ORACLE_DEPOSIT),
    );
    c.cases.flush();
    let mut case = c.get_case(id).unwrap();
    case.response = Some("y".repeat(MAX_FIELD_BYTES));
    case.request_id = Some(7);
    case.answer_by_ns = Some(U64(1));
    case.verdict = Some("UNKNOWN".to_string());
    case.appeal_by_ns = Some(U64(1));
    case.appellant = Some(BOB.parse().unwrap());
    case.winner = Some(BOB.parse().unwrap());
    c.cases.insert(id, case);
    c.by_request.insert(7, id);
    c.cases.flush();
    c.by_request.flush();
    let used = env::storage_usage() - before;
    assert!(u128::from(used) * env::storage_byte_cost().as_yoctonear() <= charge);
}

#[test]
fn cases_are_listed_by_page() {
    let mut c = setup();
    for _ in 0..3 {
        open(&mut c, MIN_STAKE);
    }
    let ids: Vec<u64> = c.cases(0, 10).iter().map(|v| v.case_id).collect();
    assert_eq!(ids, vec![1, 2, 3]);
    assert_eq!(c.cases(2, 1).len(), 1);
    assert!(c.cases(4, 10).is_empty());
    assert_eq!(c.config()["last_case_id"], 3);
}

#[test]
fn the_owner_changes_arbiter_and_windows() {
    let mut c = setup();
    ctx(OWNER, 0, T0);
    c.set_arbiter("kleros.testnet".parse().unwrap());
    c.set_params(U128(MIN_STAKE), U128(BOND * 2), 60, 3600, 900);
    let cfg = c.config();
    assert_eq!(cfg["arbiter"], "kleros.testnet");
    assert_eq!(cfg["appeal_window_sec"], 3600);
    assert_eq!(cfg["appeal_bond"], (BOND * 2).to_string());
}

#[test]
#[should_panic(expected = "only owner")]
fn strangers_cannot_change_the_arbiter() {
    let mut c = setup();
    ctx(ALICE, 0, T0);
    c.set_arbiter(ALICE.parse().unwrap());
}

#[test]
#[should_panic(expected = "windows must be positive")]
fn windows_must_be_positive() {
    ctx(OWNER, 0, T0);
    Court::new(
        OWNER.parse().unwrap(),
        ORACLE.parse().unwrap(),
        ARBITER.parse().unwrap(),
        U128(MIN_STAKE),
        U128(BOND),
        0,
        120,
        600,
    );
}
