use super::*;
use near_sdk::mock::MockAction;

const OWNER: &str = "owner.testnet";
const STRANGER: &str = "stranger.testnet";
const DAY_NS: u64 = 86_400 * 1_000_000_000;
const NEW_MODEL: &str = "google/gemma-4-26b";

fn at(who: &str, timestamp_ns: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("oracle.psephex.testnet".parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .block_timestamp(timestamp_ns)
        .build());
}

fn upload_at(who: &str, timestamp_ns: u64, code: &[u8]) {
    let mut ctx = VMContextBuilder::new()
        .current_account_id("oracle.psephex.testnet".parse().unwrap())
        .predecessor_account_id(who.parse().unwrap())
        .block_timestamp(timestamp_ns)
        .build();
    ctx.input = std::rc::Rc::from(code);
    testing_env!(ctx);
}

fn add_model() -> OwnerAction {
    OwnerAction::SetModelKey {
        model: NEW_MODEL.to_string(),
        provider: "phala".to_string(),
        scheme: "dstack-v1".to_string(),
        public_key_hex: "ab".repeat(32),
    }
}

fn upgrade(code: &[u8], migrate_args: &str) -> OwnerAction {
    OwnerAction::Upgrade {
        code_sha256: hex::encode(env::sha256_array(code)),
        migrate_args: migrate_args.to_string(),
    }
}

fn has_model(c: &AiOracle, model: &str) -> bool {
    c.models().iter().any(|m| m.model == model)
}

#[test]
fn a_proposed_model_change_waits_for_the_delay() {
    let mut c = setup();
    at(OWNER, 1_000);
    let id = c.propose(add_model());
    assert!(!has_model(&c, NEW_MODEL));
    let view = &c.proposals()[0];
    assert_eq!(view.id, id);
    assert_eq!(view.ready_at_ns.0, 1_000 + DAY_NS);
    assert!(!view.ready);
    at(OWNER, 1_000 + DAY_NS);
    assert!(c.proposals()[0].ready);
    c.execute(id);
    assert!(has_model(&c, NEW_MODEL));
    assert!(c.proposals().is_empty());
}

#[test]
#[should_panic(expected = "the delay for this proposal has not passed")]
fn execute_before_the_delay_is_refused() {
    let mut c = setup();
    at(OWNER, 1_000);
    let id = c.propose(add_model());
    at(OWNER, 1_000 + DAY_NS - 1);
    c.execute(id);
}

#[test]
fn propose_logs_the_change_and_when_it_can_run() {
    let mut c = setup();
    at(OWNER, 5);
    c.propose(OwnerAction::RemoveModelKey {
        model: MODEL.to_string(),
    });
    let logs = near_sdk::test_utils::get_logs();
    let event: Value =
        serde_json::from_str(logs.last().unwrap().strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(event["event"], "owner_change_proposed");
    assert_eq!(event["data"][0]["id"], 1);
    assert_eq!(event["data"][0]["action"]["kind"], "remove_model_key");
    assert_eq!(event["data"][0]["action"]["model"], MODEL);
    assert_eq!(event["data"][0]["ready_at_ns"], (5 + DAY_NS).to_string());
}

#[test]
#[should_panic(expected = "only owner")]
fn a_stranger_cannot_propose() {
    let mut c = setup();
    at(STRANGER, 0);
    c.propose(add_model());
}

#[test]
#[should_panic(expected = "only owner")]
fn a_stranger_cannot_execute_a_ready_proposal() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(add_model());
    at(STRANGER, DAY_NS);
    c.execute(id);
}

#[test]
#[should_panic(expected = "only owner")]
fn a_relayer_cannot_propose() {
    let mut c = setup();
    at(OWNER, 0);
    c.add_relayer("relayer.testnet".parse().unwrap());
    at("relayer.testnet", 0);
    c.propose(add_model());
}

#[test]
fn cancel_drops_the_proposal() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(add_model());
    c.cancel(id);
    assert!(c.proposals().is_empty());
    at(OWNER, DAY_NS);
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.execute(id)));
    assert!(err.is_err());
    assert!(!has_model(&c, NEW_MODEL));
}

#[test]
#[should_panic(expected = "only owner")]
fn a_stranger_cannot_cancel() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(add_model());
    at(STRANGER, 0);
    c.cancel(id);
}

#[test]
fn every_verdict_changing_action_goes_through_the_delay() {
    let mut c = setup();
    at(OWNER, 0);
    c.fulfilled.insert((CHAIN_ID, 4));
    let ids = [
        c.propose(OwnerAction::SetChain {
            chain_id: 421614,
            name: "Arbitrum Sepolia".to_string(),
            oracle_address: "0x2222222222222222222222222222222222222222".to_string(),
        }),
        c.propose(OwnerAction::ResetFulfilled {
            chain: BASE.to_string(),
            request_id: 4,
        }),
        c.propose(OwnerAction::RemoveModelKey {
            model: MODEL.to_string(),
        }),
    ];
    assert_eq!(c.chains().len(), 1);
    assert!(c.is_fulfilled(base(), 4));
    assert!(has_model(&c, MODEL));
    at(OWNER, DAY_NS);
    for id in ids {
        c.execute(id);
    }
    assert_eq!(c.chains().len(), 2);
    assert!(!c.is_fulfilled(base(), 4));
    assert!(!has_model(&c, MODEL));
    let id = c.propose(OwnerAction::RemoveChain { chain_id: 421614 });
    at(OWNER, 2 * DAY_NS);
    c.execute(id);
    assert_eq!(c.chains().len(), 1);
}

#[test]
fn a_new_delay_applies_only_to_later_proposals() {
    let mut c = setup();
    at(OWNER, 0);
    let shorten = c.propose(OwnerAction::SetOwnerDelay { seconds: 3_600 });
    let earlier = c.propose(add_model());
    at(OWNER, DAY_NS);
    c.execute(shorten);
    assert_eq!(c.owner_delay_seconds().0, 3_600);
    let later = c.propose(OwnerAction::RemoveModelKey {
        model: MODEL.to_string(),
    });
    let views = c.proposals();
    let ready_of = |id: u64| views.iter().find(|v| v.id == id).unwrap().ready_at_ns.0;
    assert_eq!(ready_of(earlier), DAY_NS);
    assert_eq!(ready_of(later), DAY_NS + 3_600 * 1_000_000_000);
}

#[test]
#[should_panic(expected = "owner delay must be between 60 and 2592000 seconds")]
fn the_delay_cannot_be_set_below_a_minute() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::SetOwnerDelay { seconds: 59 });
}

#[test]
#[should_panic(expected = "owner delay must be between 60 and 2592000 seconds")]
fn the_delay_cannot_be_set_above_thirty_days() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::SetOwnerDelay {
        seconds: 30 * 86_400 + 1,
    });
}

#[test]
#[should_panic(expected = "unsupported signature scheme: rsa")]
fn propose_checks_the_model_scheme() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::SetModelKey {
        model: NEW_MODEL.to_string(),
        provider: "phala".to_string(),
        scheme: "rsa".to_string(),
        public_key_hex: "ab".repeat(32),
    });
}

#[test]
#[should_panic(expected = "public key must be 32 bytes")]
fn propose_checks_the_model_key_length() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::SetModelKey {
        model: NEW_MODEL.to_string(),
        provider: "phala".to_string(),
        scheme: "dstack-v1".to_string(),
        public_key_hex: "ab".repeat(31),
    });
}

#[test]
#[should_panic(expected = "invalid EVM address")]
fn propose_checks_the_chain_address() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::SetChain {
        chain_id: 421614,
        name: "Arbitrum Sepolia".to_string(),
        oracle_address: "0x1234".to_string(),
    });
}

#[test]
#[should_panic(expected = "no such model")]
fn propose_refuses_to_remove_an_unknown_model() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::RemoveModelKey {
        model: "nobody/model".to_string(),
    });
}

#[test]
#[should_panic(expected = "no such chain")]
fn propose_refuses_to_remove_an_unknown_chain() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::RemoveChain { chain_id: 1 });
}

#[test]
#[should_panic(expected = "this method needs an eip155 chain")]
fn reset_fulfilled_is_only_for_evm_chains() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::ResetFulfilled {
        chain: "near:testnet".to_string(),
        request_id: 1,
    });
}

#[test]
#[should_panic(expected = "too many open proposals")]
fn open_proposals_are_capped() {
    let mut c = setup();
    at(OWNER, 0);
    for _ in 0..17 {
        c.propose(add_model());
    }
}

#[test]
#[should_panic(expected = "an upgrade runs through execute_upgrade")]
fn an_upgrade_cannot_run_through_execute() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(upgrade(b"wasm", "{}"));
    at(OWNER, DAY_NS);
    c.execute(id);
}

#[test]
#[should_panic(expected = "migrate args must be JSON")]
fn migrate_args_must_parse() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"wasm", "{owner_delay_seconds: 1}"));
}

#[test]
#[should_panic(expected = "migrate args must be a JSON object")]
fn migrate_args_must_be_an_object() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"wasm", "[86400]"));
}

#[test]
#[should_panic(expected = "an upgrade for this code is already announced")]
fn the_same_code_cannot_be_announced_twice() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"wasm", "{}"));
    c.propose(upgrade(b"wasm", r#"{"owner_delay_seconds":60}"#));
}

#[test]
#[should_panic(expected = "code sha256 must be 32 bytes")]
fn upgrade_needs_a_full_sha256() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(OwnerAction::Upgrade {
        code_sha256: "00".repeat(31),
        migrate_args: "{}".to_string(),
    });
}

#[test]
fn announced_code_deploys_with_its_migration_in_one_batch() {
    let mut c = setup();
    let code = b"new oracle wasm".to_vec();
    at(OWNER, 0);
    let mut action = upgrade(&code, r#"{"owner_delay_seconds":86400}"#);
    if let OwnerAction::Upgrade { code_sha256, .. } = &mut action {
        *code_sha256 = format!("0x{}", code_sha256.to_uppercase());
    }
    c.propose(action);
    upload_at(OWNER, DAY_NS, &code);
    drop(c.execute_upgrade());
    assert!(c.proposals().is_empty());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id.as_str(), "oracle.psephex.testnet");
    match &receipts[0].actions[..] {
        [MockAction::DeployContract { code: deployed, .. }, MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        }] => {
            assert_eq!(deployed, &code);
            assert_eq!(method_name, b"migrate");
            assert_eq!(args, br#"{"owner_delay_seconds":86400}"#);
            assert_eq!(attached_deposit.as_yoctonear(), 0);
            assert!(prepaid_gas.as_tgas() >= 100);
        }
        other => panic!("unexpected actions {other:?}"),
    }
}

#[test]
fn every_upgrade_calls_migrate_even_with_empty_args() {
    let mut c = setup();
    let code = b"same layout wasm".to_vec();
    at(OWNER, 0);
    c.propose(upgrade(&code, "{}"));
    upload_at(OWNER, DAY_NS, &code);
    drop(c.execute_upgrade());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert!(matches!(
        &receipts[0].actions[..],
        [MockAction::DeployContract { .. }, MockAction::FunctionCallWeight { method_name, args, .. }]
            if method_name == b"migrate" && args == b"{}"
    ));
}

#[test]
fn the_right_upgrade_runs_after_another_proposal_is_removed() {
    let mut c = setup();
    at(OWNER, 0);
    let first = c.propose(add_model());
    c.propose(upgrade(b"old code", "{}"));
    c.propose(upgrade(b"new code", r#"{"owner_delay_seconds":7200}"#));
    c.cancel(first);
    upload_at(OWNER, DAY_NS, b"new code");
    drop(c.execute_upgrade());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert!(matches!(
        &receipts[0].actions[..],
        [MockAction::DeployContract { code, .. }, MockAction::FunctionCallWeight { args, .. }]
            if code == b"new code" && args == br#"{"owner_delay_seconds":7200}"#
    ));
    assert_eq!(c.proposals().len(), 1);
}

#[test]
#[should_panic(expected = "this proposal expired, announce it again")]
fn a_proposal_expires_seven_days_after_it_is_ready() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(add_model());
    at(OWNER, DAY_NS + 7 * DAY_NS + 1);
    assert!(c.proposals()[0].expired);
    c.execute(id);
}

#[test]
#[should_panic(expected = "this proposal expired, announce it again")]
fn an_announced_upgrade_expires_too() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"announced", "{}"));
    upload_at(OWNER, 8 * DAY_NS + 1, b"announced");
    drop(c.execute_upgrade());
}

#[test]
fn a_proposal_still_runs_on_the_last_day_of_its_window() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(add_model());
    at(OWNER, 8 * DAY_NS);
    let view = &c.proposals()[0];
    assert_eq!(view.expires_at_ns.0, 8 * DAY_NS);
    assert!(view.ready && !view.expired);
    c.execute(id);
    assert!(has_model(&c, NEW_MODEL));
}

#[test]
#[should_panic(expected = "raising the gas cap goes through propose")]
fn raising_the_gas_cap_is_not_immediate() {
    let mut c = setup();
    at(OWNER, 0);
    c.set_max_fee_per_gas_cap(U128(FEE_CAP.0 + 1));
}

#[test]
fn raising_the_gas_cap_waits_for_the_delay() {
    let mut c = setup();
    at(OWNER, 0);
    let id = c.propose(OwnerAction::SetMaxFeePerGasCap {
        cap: U128(FEE_CAP.0 * 2),
    });
    assert_eq!(c.max_fee_per_gas_cap(), FEE_CAP);
    at(OWNER, DAY_NS);
    c.execute(id);
    assert_eq!(c.max_fee_per_gas_cap().0, FEE_CAP.0 * 2);
}

#[test]
fn owner_actions_parse_from_the_json_near_cli_sends() {
    let cases = [
        r#"{"kind":"set_model_key","model":"m","provider":"phala","scheme":"dstack-v1","public_key_hex":"ab"}"#,
        r#"{"kind":"remove_model_key","model":"m"}"#,
        r#"{"kind":"set_chain","chain_id":421614,"name":"Arbitrum Sepolia","oracle_address":"0x792bca54672763af3b1faa1fb62d3cb2fcff6111"}"#,
        r#"{"kind":"remove_chain","chain_id":421614}"#,
        r#"{"kind":"reset_fulfilled","chain":"eip155:84532","request_id":4}"#,
        r#"{"kind":"set_owner_delay","seconds":86400}"#,
        r#"{"kind":"set_max_fee_per_gas_cap","cap":"4000000000"}"#,
        r#"{"kind":"upgrade","code_sha256":"00","migrate_args":"{\"owner_delay_seconds\":86400}"}"#,
    ];
    for text in cases {
        let action: OwnerAction = serde_json::from_str(text).unwrap();
        let back = serde_json::to_value(&action).unwrap();
        assert_eq!(back, serde_json::from_str::<Value>(text).unwrap());
    }
}

#[test]
#[should_panic(expected = "no announced upgrade for this code")]
fn unannounced_code_is_refused() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"announced", "{}"));
    upload_at(OWNER, DAY_NS, b"something else");
    drop(c.execute_upgrade());
}

#[test]
#[should_panic(expected = "the delay for this proposal has not passed")]
fn an_upgrade_waits_for_the_delay() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"announced", "{}"));
    upload_at(OWNER, DAY_NS - 1, b"announced");
    drop(c.execute_upgrade());
}

#[test]
#[should_panic(expected = "only owner")]
fn a_stranger_cannot_upgrade() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"announced", "{}"));
    upload_at(STRANGER, DAY_NS, b"announced");
    drop(c.execute_upgrade());
}

#[test]
#[should_panic(expected = "pending signatures must finish before an upgrade")]
fn an_upgrade_waits_for_pending_signatures() {
    let mut c = setup();
    at(OWNER, 0);
    c.propose(upgrade(b"announced", "{}"));
    c.pending.insert((CHAIN_ID, 3));
    upload_at(OWNER, DAY_NS, b"announced");
    drop(c.execute_upgrade());
}

#[test]
fn immediate_owner_settings_cannot_change_a_verdict() {
    let mut c = setup();
    at(OWNER, 0);
    c.add_relayer("relayer.testnet".parse().unwrap());
    c.set_max_fee_per_gas_cap(U128(1));
    c.set_near_fee(NEAR_FEE);
    assert!(c.proposals().is_empty());
    assert_eq!(c.models().len(), 1);
}
