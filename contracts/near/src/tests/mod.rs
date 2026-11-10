use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const MODEL: &str = "Qwen/Qwen3.5-122B-A10B";
const QUESTION: &str = "Did the Ethereum Dencun upgrade activate on mainnet before April 2024?";
const BASE_ORACLE: &str = "0x1111111111111111111111111111111111111111";
const CHAIN_ID: u64 = 84532;
const BASE: &str = "eip155:84532";
const NEAR_FEE: U128 = U128(10_000_000_000_000_000_000_000);

fn base() -> String {
    BASE.to_string()
}
const SELECTOR_FROM_CAST_SIG: [u8; 4] = [0x3b, 0x3b, 0x45, 0x8b];
const FEE_CAP: U128 = U128(2_000_000_000);

fn test_key() -> SigningKey {
    let mut secret = [0u8; 32];
    for (i, b) in secret.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(7).wrapping_add(13);
    }
    SigningKey::from_bytes(&secret)
}

fn owner_ctx() {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("owner.testnet".parse().unwrap())
        .build());
}

fn setup() -> AiOracle {
    owner_ctx();
    let mut c = AiOracle::new(
        "owner.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        "base-1".to_string(),
        CHAIN_ID,
        "Base Sepolia".to_string(),
        BASE_ORACLE.to_string(),
        FEE_CAP,
        NEAR_FEE,
    );
    let pk = test_key().verifying_key();
    c.set_model_key(
        MODEL.to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(pk.as_bytes()),
    );
    c
}

fn response_with(content: &str) -> String {
    format!(
        r#"{{"id":"chatcmpl-9f1e2d3c4b5a","object":"chat.completion","created":1762550000,"model":"{MODEL}","choices":[{{"index":0,"message":{{"role":"assistant","content":"{content}","reasoning_content":null,"tool_calls":[]}},"logprobs":null,"finish_reason":"stop","stop_reason":null}}],"usage":{{"prompt_tokens":71,"total_tokens":72,"completion_tokens":1,"prompt_tokens_details":null}},"prompt_logprobs":null}}"#
    )
}

fn sign_for(c: &AiOracle, request_id: u64, question: &str, model: &str, response: &str) -> String {
    let text = c.signed_text(
        base(),
        request_id,
        question.to_string(),
        model.to_string(),
        response.to_string(),
    );
    hex::encode(test_key().sign(text.as_bytes()).to_bytes())
}

#[test]
fn build_request_is_deterministic_and_contains_inputs() {
    let c = setup();
    let a = c.build_request(base(), 7, QUESTION.to_string(), MODEL.to_string());
    let b = c.build_request(base(), 7, QUESTION.to_string(), MODEL.to_string());
    assert_eq!(a, b);
    assert!(a.contains(QUESTION));
    assert!(a.contains("request #7 "));
    assert!(a.contains("84532"));
    assert!(a.contains("0x1111111111111111111111111111111111111111"));
    assert!(a.starts_with(&format!(
        r#"{{"model":"{MODEL}","messages":[{{"role":"user","content":"#
    )));
    assert!(a.ends_with(r#","temperature":0,"seed":42,"max_tokens":8,"stream":false,"chat_template_kwargs":{"enable_thinking":false}}"#));
    let v: Value = serde_json::from_str(&a).unwrap();
    let keys: Vec<&str> = v.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    assert_eq!(
        keys,
        vec![
            "model",
            "messages",
            "temperature",
            "seed",
            "max_tokens",
            "stream",
            "chat_template_kwargs"
        ]
    );
    assert_ne!(
        a,
        c.build_request(base(), 8, QUESTION.to_string(), MODEL.to_string())
    );
}

#[test]
fn signed_text_shape_matches_docs() {
    let c = setup();
    let resp = response_with("YES");
    let text = c.signed_text(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
    );
    let parts: Vec<&str> = text.rsplitn(3, ':').collect();
    assert_eq!(parts.len(), 3);
    assert_eq!(parts[2], MODEL);
    assert_eq!(parts[1].len(), 64);
    assert_eq!(parts[0].len(), 64);
    assert!(parts[0]
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()));
    assert!(parts[1]
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase()));
    assert_eq!(parts[0], hex::encode(env::sha256_array(resp.as_bytes())));
}

#[test]
fn valid_signature_yields_yes() {
    let c = setup();
    let resp = response_with("YES");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        sig.clone(),
    );
    assert!(r.ok, "{}", r.reason);
    assert_eq!(r.answer, "YES");
    assert_eq!(r.reason, "");
    let with_prefix = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        format!("0x{}", sig.to_uppercase()),
    );
    assert!(with_prefix.ok);
    let no = response_with("NO");
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        no.clone(),
        sign_for(&c, 1, QUESTION, MODEL, &no),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "NO");
    let unk = response_with("UNKNOWN");
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        unk.clone(),
        sign_for(&c, 1, QUESTION, MODEL, &unk),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "UNKNOWN");
}

#[test]
fn tampered_response_fails() {
    let c = setup();
    let resp = response_with("NO");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let tampered = resp.replace(r#""content":"NO""#, r#""content":"YES""#);
    assert_ne!(tampered, resp);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        tampered,
        sig.clone(),
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "invalid signature");
    assert_eq!(r.answer, "");
    let whitespace = format!("{resp} ");
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        whitespace,
        sig,
    );
    assert!(!r.ok);
}

#[test]
fn different_question_or_request_id_fails() {
    let c = setup();
    let resp = response_with("YES");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let r = c.verify_answer(
        base(),
        1,
        format!("{QUESTION} Really?"),
        MODEL.to_string(),
        resp.clone(),
        sig.clone(),
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "invalid signature");
    let r = c.verify_answer(
        base(),
        2,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp,
        sig,
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "invalid signature");
}

#[test]
fn unknown_model_fails() {
    let c = setup();
    let resp = response_with("YES");
    let other = "deepseek-ai/DeepSeek-V3.1";
    let sig = sign_for(&c, 1, QUESTION, other, &resp);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        other.to_string(),
        resp.clone(),
        sig,
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "unknown model");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let mut c2 = c;
    c2.remove_model_key(MODEL.to_string());
    assert!(c2.models().is_empty());
    let r = c2.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp,
        sig,
    );
    assert_eq!(r.reason, "unknown model");
}

#[test]
fn answer_normalization_is_strict_one_word() {
    let c = setup();
    let cases: [(&str, Option<&str>); 9] = [
        ("Yes.", Some("YES")),
        (" yes ", Some("YES")),
        ("No", Some("NO")),
        ("unknown.", Some("UNKNOWN")),
        ("YES\\n", Some("YES")),
        ("The answer is YES", None),
        ("YES, definitely", None),
        ("Yes..", None),
        ("", None),
    ];
    for (content, expected) in cases {
        let resp = response_with(content);
        let sig = sign_for(&c, 3, QUESTION, MODEL, &resp);
        let r = c.verify_answer(
            base(),
            3,
            QUESTION.to_string(),
            MODEL.to_string(),
            resp,
            sig,
        );
        match expected {
            Some(a) => {
                assert!(r.ok, "{content:?}: {}", r.reason);
                assert_eq!(r.answer, a, "{content:?}");
            }
            None => {
                assert!(!r.ok, "{content:?}");
                assert_eq!(r.reason, "unparseable answer", "{content:?}");
                assert_eq!(r.answer, "");
            }
        }
    }
}

#[test]
fn malformed_inputs_fail_gracefully() {
    let c = setup();
    let resp = response_with("YES");
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        "0xabcd".to_string(),
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "signature must be 64 bytes, got 2");
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        "zz".repeat(64),
    );
    assert_eq!(r.reason, "signature is not valid hex");
    let not_json = "not json at all";
    let sig = sign_for(&c, 1, QUESTION, MODEL, not_json);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        not_json.to_string(),
        sig,
    );
    assert_eq!(r.reason, "response body is not valid JSON");
    let no_choices = r#"{"id":"x","choices":[]}"#;
    let sig = sign_for(&c, 1, QUESTION, MODEL, no_choices);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        no_choices.to_string(),
        sig,
    );
    assert_eq!(r.reason, "choices[0].message.content missing");
}

#[test]
fn calldata_matches_base_fulfill_abi() {
    let c = setup();
    let built = c.build_fulfill_tx(
        base(),
        258,
        QUESTION.to_string(),
        "yes.".to_string(),
        0,
        U128(2_000_000_000),
        U128(1_000_000_000),
    );
    let data = hex::decode(&built.calldata).unwrap();
    assert_eq!(data.len(), 100);
    assert_eq!(&data[0..4], &SELECTOR_FROM_CAST_SIG);
    assert_eq!(
        &data[0..4],
        &env::keccak256_array(FULFILL_SIGNATURE.as_bytes())[0..4]
    );
    assert_eq!(&data[4..34], &[0u8; 30]);
    assert_eq!(data[34], 1);
    assert_eq!(data[35], 2);
    assert_eq!(&data[36..67], &[0u8; 31]);
    assert_eq!(data[67], ANSWER_YES);
    assert_eq!(built.answer_code, 1);
    let qh = c.question_hash(QUESTION.to_string());
    assert_eq!(format!("0x{}", hex::encode(&data[68..100])), qh);
    assert_eq!(built.payload.len(), 64);
    assert!(built.unsigned_tx.starts_with("02"));
    assert_eq!(
        built.payload,
        hex::encode(env::keccak256_array(
            hex::decode(&built.unsigned_tx).unwrap()
        ))
    );
    let unsigned = hex::decode(&built.unsigned_tx).unwrap();
    let to = hex::decode(BASE_ORACLE.trim_start_matches("0x")).unwrap();
    assert!(unsigned.windows(20).any(|w| w == to.as_slice()));
    assert!(unsigned.windows(100).any(|w| w == data.as_slice()));
    assert_eq!(
        c.build_fulfill_tx(
            base(),
            1,
            QUESTION.to_string(),
            "NO".to_string(),
            0,
            U128(1),
            U128(1)
        )
        .answer_code,
        2
    );
    assert_eq!(
        c.build_fulfill_tx(
            base(),
            1,
            QUESTION.to_string(),
            "unknown".to_string(),
            0,
            U128(1),
            U128(1)
        )
        .answer_code,
        0
    );
}

#[test]
fn question_hash_is_keccak_hex() {
    let c = setup();
    let h = c.question_hash("hello".to_string());
    assert_eq!(
        h,
        "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
    );
}

#[test]
#[should_panic(expected = "only owner")]
fn only_owner_sets_keys() {
    let mut c = setup();
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("mallory.testnet".parse().unwrap())
        .build());
    c.set_model_key(
        "x".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        "00".repeat(32),
    );
}

#[test]
#[should_panic(expected = "public key must be 32 bytes, got 31")]
fn rejects_short_public_key() {
    let mut c = setup();
    c.set_model_key(
        "x".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        "00".repeat(31),
    );
}

#[test]
fn review_calldata_equals_cast_calldata_output() {
    let c = setup();
    let built = c.build_fulfill_tx(
        base(),
        258,
        QUESTION.to_string(),
        "YES".to_string(),
        0,
        U128(1),
        U128(1),
    );
    assert_eq!(
        built.calldata,
        "3b3b458b0000000000000000000000000000000000000000000000000000000000000102000000000000000000000000000000000000000000000000000000000000000124f851ebe22469538e91325418375a89b845f25da49545adeab51d3a33bb2ef7"
    );
    assert_eq!(
        c.question_hash(QUESTION.to_string()),
        "0x24f851ebe22469538e91325418375a89b845f25da49545adeab51d3a33bb2ef7"
    );
    let unsigned = hex::decode(&built.unsigned_tx).unwrap();
    assert!(unsigned.windows(4).any(|w| w == [0x83, 0x04, 0x93, 0xe0]));
    let max = c.build_fulfill_tx(
        base(),
        u64::MAX,
        QUESTION.to_string(),
        "NO".to_string(),
        u64::MAX,
        U128(u128::MAX),
        U128(u128::MAX),
    );
    let data = hex::decode(&max.calldata).unwrap();
    assert_eq!(
        &data[4..36],
        &[[0u8; 24].as_slice(), &[0xff; 8]].concat()[..]
    );
}

#[test]
fn review_keccak_of_ukrainian_question_matches_cast_and_solidity() {
    let c = setup();
    let q = "Чи об'єднали \"Дніпро\" з Кам'янським у 2024 році?";
    assert_eq!(q.len(), 80);
    assert_eq!(
        c.question_hash(q.to_string()),
        "0x25d369988a06be585d634f617697a6071c6d8a720206e5ca0708aa3c4b764594"
    );
    assert_eq!(
        c.question_hash(String::new()),
        "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    );
}

#[test]
fn review_view_methods_do_not_panic_on_malformed_input() {
    let c = setup();
    let bodies = [
        r#"{"choices":{"0":{"message":{"content":"YES"}}}}"#,
        r#"{"choices":[{"message":{"content":123}}]}"#,
        r#"{"choices":[{"message":{"content":null}}]}"#,
        r#"{"choices":[{"message":"YES"}]}"#,
        r#"{"choices":[null]}"#,
        r#"{"choices":"YES"}"#,
        r#"[]"#,
        r#"null"#,
        r#""YES""#,
        "",
        "{",
        r#"{"choices":[{"message":{"content":"\ud800"}}]}"#,
    ];
    for body in bodies {
        let sig = sign_for(&c, 1, QUESTION, MODEL, body);
        let r = c.verify_answer(
            base(),
            1,
            QUESTION.to_string(),
            MODEL.to_string(),
            body.to_string(),
            sig,
        );
        assert!(!r.ok, "{body:?}");
        assert!(
            r.reason == "response body is not valid JSON"
                || r.reason == "choices[0].message.content missing",
            "{body:?}: {}",
            r.reason
        );
    }
    let deep = format!("{}{}", "[".repeat(5000), "]".repeat(5000));
    let sig = sign_for(&c, 1, QUESTION, MODEL, &deep);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        deep,
        sig,
    );
    assert_eq!(r.reason, "response body is not valid JSON");
    let resp = response_with("YES");
    for bad_sig in [
        "",
        "0x",
        "0X",
        "abc",
        " ",
        "0x0x",
        &"0".repeat(127),
        &"0".repeat(129),
        &"g".repeat(128),
    ] {
        let r = c.verify_answer(
            base(),
            1,
            QUESTION.to_string(),
            MODEL.to_string(),
            resp.clone(),
            bad_sig.to_string(),
        );
        assert!(!r.ok, "{bad_sig:?}");
        assert!(
            r.reason.starts_with("signature"),
            "{bad_sig:?}: {}",
            r.reason
        );
    }
    let zero_sig = format!(" {} ", "0".repeat(128));
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        zero_sig,
    );
    assert_eq!(r.reason, "invalid signature");
    let r = c.verify_answer(
        base(),
        u64::MAX,
        String::new(),
        String::new(),
        String::new(),
        String::new(),
    );
    assert_eq!(r.reason, "unknown model");
    assert_eq!(
        c.signed_text(base(), 0, String::new(), String::new(), String::new())
            .matches(':')
            .count(),
        2
    );
}

#[test]
fn review_model_id_with_colon_and_leading_whitespace_signature() {
    owner_ctx();
    let mut c = AiOracle::new(
        "owner.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        "base-1".to_string(),
        CHAIN_ID,
        "Base Sepolia".to_string(),
        BASE_ORACLE.to_string(),
        FEE_CAP,
        NEAR_FEE,
    );
    let model = "org/model:tag";
    c.set_model_key(
        model.to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        format!(
            "0X{}",
            hex::encode(test_key().verifying_key().as_bytes()).to_uppercase()
        ),
    );
    let resp = response_with("no");
    let sig = sign_for(&c, 1, QUESTION, model, &resp);
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        model.to_string(),
        resp.clone(),
        format!("  {sig}\n"),
    );
    assert!(r.ok, "{}", r.reason);
    assert_eq!(r.answer, "NO");
    assert!(r.signed_text.starts_with("org/model:tag:"));
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        "org/model".to_string(),
        resp,
        sig,
    );
    assert_eq!(r.reason, "unknown model");
}

#[test]
fn review_signature_from_other_registered_model_key_is_rejected() {
    let mut c = setup();
    let other_model = "other/model";
    let other_secret = [9u8; 32];
    let other_key = SigningKey::from_bytes(&other_secret);
    c.set_model_key(
        other_model.to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(other_key.verifying_key().as_bytes()),
    );
    let resp = response_with("YES");
    let text = c.signed_text(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
    );
    let sig = hex::encode(other_key.sign(text.as_bytes()).to_bytes());
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        sig,
    );
    assert_eq!(r.reason, "invalid signature");
    let two_part_text = text.split_once(':').unwrap().1.to_string();
    let sig = hex::encode(test_key().sign(two_part_text.as_bytes()).to_bytes());
    let r = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp,
        sig,
    );
    assert_eq!(r.reason, "invalid signature");
}

#[test]
#[should_panic(expected = "unparseable answer")]
fn review_build_fulfill_tx_panics_on_garbage_answer() {
    let c = setup();
    c.build_fulfill_tx(
        base(),
        1,
        QUESTION.to_string(),
        "maybe".to_string(),
        0,
        U128(1),
        U128(1),
    );
}

fn mallory_ctx() {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("mallory.testnet".parse().unwrap())
        .build());
}

fn callback_ctx() {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("owner.testnet".parse().unwrap())
        .current_account_id("owner.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}

const ARB: &str = "eip155:421614";
const ARB_ID: u64 = 421614;

fn tx(c: &AiOracle, chain: &str) -> BuiltTx {
    c.build_fulfill_tx(
        chain.to_string(),
        1,
        QUESTION.to_string(),
        "YES".to_string(),
        0,
        U128(1),
        U128(1),
    )
}

#[test]
fn set_chain_normalizes_and_changes_tx_target() {
    let mut c = setup();
    let before = tx(&c, BASE);
    c.set_chain(
        CHAIN_ID,
        " Base Sepolia ".to_string(),
        "  0x846983bA5E8DF5AD877AAeEc13E0C953D81C1095 ".to_string(),
    );
    assert_eq!(
        c.chains()[0].oracle_address,
        "0x846983ba5e8df5ad877aaeec13e0c953d81c1095"
    );
    assert_eq!(c.chains()[0].name, "Base Sepolia");
    c.set_chain(
        CHAIN_ID,
        "Base Sepolia".to_string(),
        "2222222222222222222222222222222222222222".to_string(),
    );
    let after = tx(&c, BASE);
    assert_eq!(before.calldata, after.calldata);
    assert_ne!(before.unsigned_tx, after.unsigned_tx);
    let unsigned = hex::decode(&after.unsigned_tx).unwrap();
    assert!(unsigned.windows(20).any(|w| w == [0x22u8; 20]));
    assert!(!unsigned.windows(20).any(|w| w == [0x11u8; 20]));
    assert!(c
        .build_request(base(), 1, QUESTION.to_string(), MODEL.to_string())
        .contains("0x2222222222222222222222222222222222222222"));
}

#[test]
#[should_panic(expected = "invalid EVM address")]
fn set_chain_rejects_bad_length() {
    let mut c = setup();
    c.set_chain(ARB_ID, "Arbitrum Sepolia".to_string(), "0x1234".to_string());
}

#[test]
#[should_panic(expected = "invalid EVM address")]
fn set_chain_rejects_non_hex() {
    let mut c = setup();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        format!("0x{}", "g".repeat(40)),
    );
}

#[test]
#[should_panic(expected = "chain name must not be empty")]
fn set_chain_rejects_empty_name() {
    let mut c = setup();
    c.set_chain(ARB_ID, "  ".to_string(), BASE_ORACLE.to_string());
}

#[test]
#[should_panic(expected = "chain id must be positive")]
fn set_chain_rejects_zero_chain_id() {
    let mut c = setup();
    c.set_chain(0, "Zero".to_string(), BASE_ORACLE.to_string());
}

#[test]
#[should_panic(expected = "only owner")]
fn set_chain_rejects_non_owner() {
    let mut c = setup();
    mallory_ctx();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        BASE_ORACLE.to_string(),
    );
}

#[test]
fn second_chain_gets_its_own_request_text_and_tx() {
    let mut c = setup();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        "0x2222222222222222222222222222222222222222".to_string(),
    );
    let base_tx = tx(&c, BASE);
    let arb_tx = tx(&c, ARB);
    assert_eq!(base_tx.calldata, arb_tx.calldata);
    assert_ne!(base_tx.payload, arb_tx.payload);
    assert_eq!(&base_tx.unsigned_tx[6..14], "83014a34");
    assert_eq!(&arb_tx.unsigned_tx[6..14], "83066eee");
    let base_req = c.build_request(base(), 1, QUESTION.to_string(), MODEL.to_string());
    let arb_req = c.build_request(ARB.to_string(), 1, QUESTION.to_string(), MODEL.to_string());
    assert!(base_req.contains("0x1111111111111111111111111111111111111111 on EVM chain 84532."));
    assert!(arb_req.contains("0x2222222222222222222222222222222222222222 on EVM chain 421614."));
    assert_eq!(c.chains().len(), 2);
    assert_eq!(c.config()["chains"].as_array().unwrap().len(), 2);
}

#[test]
fn answer_signed_for_one_chain_fails_on_another() {
    let mut c = setup();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        BASE_ORACLE.to_string(),
    );
    let resp = response_with("YES");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let on_base = c.verify_answer(
        base(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        sig.clone(),
    );
    let on_arb = c.verify_answer(
        ARB.to_string(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp.clone(),
        sig.clone(),
    );
    let on_near = c.verify_answer(
        near_chain_key(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
        resp,
        sig,
    );
    assert!(on_base.ok);
    assert!(!on_arb.ok);
    assert_eq!(on_arb.reason, "invalid signature");
    assert!(!on_near.ok);
    assert_eq!(on_near.reason, "invalid signature");
}

#[test]
fn unregistered_or_malformed_chain_fails_views_without_panic() {
    let c = setup();
    let resp = response_with("YES");
    for chain in [
        "eip155:1",
        "eip155:",
        "eip155:01",
        "eip155:abc",
        "near:otherchain",
        "solana:1",
        "",
        "84532",
    ] {
        let r = c.verify_answer(
            chain.to_string(),
            1,
            QUESTION.to_string(),
            MODEL.to_string(),
            resp.clone(),
            "00".repeat(64),
        );
        assert!(!r.ok, "{chain}");
        assert!(r.reason.contains("chain"), "{chain}: {}", r.reason);
        let k = c.verify_consensus(chain.to_string(), 1, QUESTION.to_string(), vec![]);
        assert!(!k.ok, "{chain}");
    }
}

#[test]
#[should_panic(expected = "chain eip155:1 is not registered")]
fn build_request_rejects_unregistered_chain() {
    let c = setup();
    c.build_request(
        "eip155:1".to_string(),
        1,
        QUESTION.to_string(),
        MODEL.to_string(),
    );
}

#[test]
#[should_panic(expected = "this method needs an eip155 chain")]
fn build_fulfill_tx_rejects_near_chain() {
    let c = setup();
    tx(&c, &near_chain_key());
}

#[test]
fn fulfilled_ids_are_per_chain() {
    let mut c = setup();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        BASE_ORACLE.to_string(),
    );
    callback_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        5,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    assert!(c.is_fulfilled(base(), 5));
    assert!(!c.is_fulfilled(ARB.to_string(), 5));
    assert!(!c.is_fulfilled(near_chain_key(), 5));
}

#[test]
fn remove_chain_drops_it_from_views() {
    let mut c = setup();
    c.set_chain(
        ARB_ID,
        "Arbitrum Sepolia".to_string(),
        BASE_ORACLE.to_string(),
    );
    assert!(c.remove_chain(ARB_ID));
    assert!(!c.remove_chain(ARB_ID));
    assert_eq!(c.chains().len(), 1);
}

#[test]
#[should_panic(expected = "chain has signatures in progress")]
fn remove_chain_refuses_while_signing() {
    let mut c = setup();
    c.pending.insert((CHAIN_ID, 3));
    c.remove_chain(CHAIN_ID);
}

#[test]
fn reset_fulfilled_removes_only_that_id_and_reports_presence() {
    let mut c = setup();
    callback_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        11,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        12,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    assert!(c.is_fulfilled(base(), 11));
    assert!(c.is_fulfilled(base(), 12));
    owner_ctx();
    assert!(c.reset_fulfilled(base(), 11));
    assert!(!c.is_fulfilled(base(), 11));
    assert!(c.is_fulfilled(base(), 12));
    assert!(!c.reset_fulfilled(base(), 11));
    assert!(!c.reset_fulfilled(base(), 999));
}

#[test]
#[should_panic(expected = "only owner")]
fn reset_fulfilled_rejects_non_owner() {
    let mut c = setup();
    callback_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        13,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    mallory_ctx();
    c.reset_fulfilled(base(), 13);
}

#[test]
fn reset_fulfilled_allows_fulfill_on_base_again() {
    let mut c = setup3();
    callback_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        9,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    assert!(c.is_fulfilled(base(), 9));
    let a = answers3(&c, 9, ["YES", "YES", "NO"]);
    assert!(c.reset_fulfilled(base(), 9));
    let _p = c.fulfill_on_evm(base(), 9, QUESTION.to_string(), a, 1, U128(1), U128(1));
    assert!(!c.is_fulfilled(base(), 9));
    let out = c.on_signed(
        Ok(json!({"big_r":"x"})),
        CHAIN_ID,
        9,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    assert_eq!(out["ok"], true);
    assert!(c.is_fulfilled(base(), 9));
}

#[test]
fn config_has_models_count_and_no_fulfilled_list() {
    let mut c = setup();
    callback_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        21,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    owner_ctx();
    let cfg = c.config();
    let keys: Vec<&str> = cfg
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(
        sorted,
        vec![
            "chains",
            "last_near_request_id",
            "models",
            "near_chain",
            "near_fee",
            "owner",
            "path",
            "signer"
        ]
    );
    assert!(cfg.get("fulfilled").is_none());
    assert_eq!(cfg["owner"], "owner.testnet");
    assert_eq!(cfg["signer"], "v1.signer-prod.testnet");
    assert_eq!(cfg["path"], "base-1");
    assert_eq!(cfg["chains"][0]["chain_id"], CHAIN_ID);
    assert_eq!(cfg["chains"][0]["oracle_address"], BASE_ORACLE);
    assert_eq!(cfg["near_fee"], "10000000000000000000000");
    assert_eq!(cfg["models"], 1);
    c.set_model_key(
        "other/model".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        "00".repeat(32),
    );
    assert_eq!(c.config()["models"], 2);
    c.remove_model_key(MODEL.to_string());
    c.remove_model_key("other/model".to_string());
    assert_eq!(c.config()["models"], 0);
    assert!(c.is_fulfilled(base(), 21));
}

fn v2_state() -> migrate::AiOracleV2 {
    let mut model_keys = IterableMap::new(b"m");
    model_keys.insert(
        MODEL.to_string(),
        ModelKey {
            provider: PROVIDER.to_string(),
            scheme: SCHEME.to_string(),
            public_key: test_key().verifying_key().as_bytes().to_vec(),
        },
    );
    let mut fulfilled = IterableSet::new(b"f");
    fulfilled.insert(1u64);
    fulfilled.insert(2u64);
    let mut relayers = IterableSet::new(b"r");
    relayers.insert("relayer.testnet".parse::<AccountId>().unwrap());
    let mut v2 = migrate::AiOracleV2 {
        owner: "owner.testnet".parse().unwrap(),
        signer: "v1.signer-prod.testnet".parse().unwrap(),
        path: "base-1".to_string(),
        base_chain_id: CHAIN_ID,
        base_oracle_address: "1111111111111111111111111111111111111111".to_string(),
        model_keys,
        fulfilled,
        relayers,
        pending: IterableSet::new(b"p"),
        max_fee_per_gas_cap: FEE_CAP.0,
    };
    v2.model_keys.flush();
    v2.fulfilled.flush();
    v2.relayers.flush();
    v2.pending.flush();
    v2
}

#[test]
fn v2_layout_matches_the_deployed_contract() {
    owner_ctx();
    let bytes = near_sdk::borsh::to_vec(&v2_state()).unwrap();
    let mut expected = Vec::new();
    let push_bytes = |out: &mut Vec<u8>, b: &[u8]| {
        out.extend_from_slice(&(b.len() as u32).to_le_bytes());
        out.extend_from_slice(b);
    };
    push_bytes(&mut expected, b"owner.testnet");
    push_bytes(&mut expected, b"v1.signer-prod.testnet");
    push_bytes(&mut expected, b"base-1");
    expected.extend_from_slice(&CHAIN_ID.to_le_bytes());
    push_bytes(&mut expected, b"1111111111111111111111111111111111111111");
    expected.extend_from_slice(&1u32.to_le_bytes());
    push_bytes(&mut expected, b"mv");
    push_bytes(&mut expected, b"mm");
    expected.extend_from_slice(&2u32.to_le_bytes());
    push_bytes(&mut expected, b"fv");
    push_bytes(&mut expected, b"fm");
    expected.extend_from_slice(&1u32.to_le_bytes());
    push_bytes(&mut expected, b"rv");
    push_bytes(&mut expected, b"rm");
    expected.extend_from_slice(&0u32.to_le_bytes());
    push_bytes(&mut expected, b"pv");
    push_bytes(&mut expected, b"pm");
    expected.extend_from_slice(&FEE_CAP.0.to_le_bytes());
    assert_eq!(bytes, expected);
}

fn self_ctx() {
    testing_env!(VMContextBuilder::new()
        .current_account_id("oracle.psephex.testnet".parse().unwrap())
        .predecessor_account_id("oracle.psephex.testnet".parse().unwrap())
        .build());
}

#[test]
fn migrate_keeps_base_history_models_and_relayers() {
    self_ctx();
    env::state_write(&v2_state());
    let c = AiOracle::migrate("Base Sepolia".to_string(), NEAR_FEE);
    assert!(c.is_fulfilled(base(), 1));
    assert!(c.is_fulfilled(base(), 2));
    assert!(!c.is_fulfilled(base(), 3));
    assert!(!c.is_fulfilled("eip155:421614".to_string(), 1));
    assert!(!c.is_fulfilled("near:testnet".to_string(), 1));
    assert_eq!(c.models().len(), 1);
    assert_eq!(c.models()[0].model, MODEL);
    assert_eq!(
        c.relayers(),
        vec!["relayer.testnet".parse::<AccountId>().unwrap()]
    );
    let chains = c.chains();
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0].chain, BASE);
    assert_eq!(chains[0].name, "Base Sepolia");
    assert_eq!(chains[0].oracle_address, BASE_ORACLE);
    assert_eq!(c.near_fee(), NEAR_FEE);
    assert_eq!(c.last_near_request_id(), 0);
    assert_eq!(c.max_fee_per_gas_cap(), FEE_CAP);
    assert_eq!(c.config()["owner"], "owner.testnet");
    assert_eq!(c.config()["path"], "base-1");
    assert_eq!(c.config()["near_chain"], "near:testnet");
    let old_fulfilled: IterableSet<u64> = IterableSet::new(b"f");
    assert!(old_fulfilled.is_empty() || !old_fulfilled.contains(&1));
    let req = c.build_request(base(), 7, QUESTION.to_string(), MODEL.to_string());
    assert!(req.contains("for the AiOracle contract 0x1111111111111111111111111111111111111111 on EVM chain 84532. Question: "));
}

#[test]
fn migrated_state_round_trips_through_borsh() {
    self_ctx();
    env::state_write(&v2_state());
    let mut c = AiOracle::migrate("Base Sepolia".to_string(), NEAR_FEE);
    c.chains.flush();
    c.fulfilled.flush();
    c.model_keys.flush();
    c.relayers.flush();
    c.pending.flush();
    let bytes = near_sdk::borsh::to_vec(&c).unwrap();
    let restored: AiOracle = near_sdk::borsh::from_slice(&bytes).unwrap();
    assert!(restored.is_fulfilled(base(), 1));
    assert_eq!(restored.config(), c.config());
}

#[test]
#[should_panic(expected = "pending signatures must finish before migration")]
fn migrate_refuses_while_a_signature_is_pending() {
    self_ctx();
    let mut v2 = v2_state();
    v2.pending.insert(9);
    v2.pending.flush();
    env::state_write(&v2);
    AiOracle::migrate("Base Sepolia".to_string(), NEAR_FEE);
}

const MODELS3: [&str; 3] = [
    "Qwen/Qwen3.8-27B",
    "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    "Qwen/Qwen3.6-35B-A3B-FP8",
];

fn key_n(i: usize) -> SigningKey {
    SigningKey::from_bytes(&[40 + i as u8; 32])
}

fn setup3() -> AiOracle {
    owner_ctx();
    let mut c = AiOracle::new(
        "owner.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        "base-1".to_string(),
        CHAIN_ID,
        "Base Sepolia".to_string(),
        BASE_ORACLE.to_string(),
        FEE_CAP,
        NEAR_FEE,
    );
    for (i, m) in MODELS3.iter().enumerate() {
        c.set_model_key(
            m.to_string(),
            PROVIDER.to_string(),
            SCHEME.to_string(),
            hex::encode(key_n(i).verifying_key().as_bytes()),
        );
    }
    c
}

fn answer_by(
    c: &AiOracle,
    request_id: u64,
    model_index: usize,
    signer_index: usize,
    content: &str,
) -> ModelAnswer {
    let model = MODELS3[model_index];
    let response_body = response_with(content);
    let text = c.signed_text(
        base(),
        request_id,
        QUESTION.to_string(),
        model.to_string(),
        response_body.clone(),
    );
    ModelAnswer {
        model: model.to_string(),
        response_body,
        signature_hex: hex::encode(key_n(signer_index).sign(text.as_bytes()).to_bytes()),
    }
}

fn answers3(c: &AiOracle, request_id: u64, contents: [&str; 3]) -> Vec<ModelAnswer> {
    (0..3)
        .map(|i| answer_by(c, request_id, i, i, contents[i]))
        .collect()
}

fn fulfill_ctx() {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("owner.testnet".parse().unwrap())
        .current_account_id("owner.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
}

#[test]
fn consensus_three_yes_is_yes() {
    let c = setup3();
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["YES", "YES", "YES"]),
    );
    assert!(r.ok, "{}", r.reason);
    assert_eq!(r.answer, "YES");
    assert_eq!(r.required, 2);
    assert_eq!(r.votes.len(), 3);
    assert!(r.votes.iter().all(|v| v.answer == "YES"));
}

#[test]
fn consensus_two_of_three_wins() {
    let c = setup3();
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["YES", "NO", "YES"]),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "YES");
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["NO", "UNKNOWN", "NO"]),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "NO");
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["UNKNOWN", "UNKNOWN", "YES"]),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "UNKNOWN");
}

#[test]
fn consensus_without_majority_is_unknown() {
    let c = setup3();
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["YES", "NO", "UNKNOWN"]),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "UNKNOWN");
    assert_eq!(r.reason, "no majority");
}

#[test]
fn consensus_counts_signed_unparseable_answer_as_unknown() {
    let c = setup3();
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["YES", "Maybe yes", "YES"]),
    );
    assert!(r.ok);
    assert_eq!(r.answer, "YES");
    assert_eq!(r.votes[1].answer, "UNKNOWN");
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        answers3(&c, 1, ["NO", "Maybe yes", "YES"]),
    );
    assert_eq!(r.answer, "UNKNOWN");
}

#[test]
fn consensus_requires_every_registered_model_exactly_once() {
    let c = setup3();
    let mut two = answers3(&c, 1, ["YES", "YES", "NO"]);
    two.pop();
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), two);
    assert!(!r.ok);
    assert_eq!(
        r.reason,
        "answers must cover every registered model exactly once"
    );
    let dup = vec![
        answer_by(&c, 1, 0, 0, "YES"),
        answer_by(&c, 1, 0, 0, "YES"),
        answer_by(&c, 1, 1, 1, "NO"),
    ];
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), dup);
    assert!(!r.ok);
    assert_eq!(
        r.reason,
        "answers must cover every registered model exactly once"
    );
    let mut four = answers3(&c, 1, ["YES", "YES", "NO"]);
    four.push(answer_by(&c, 1, 0, 0, "YES"));
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), four);
    assert!(!r.ok);
    assert_eq!(
        r.reason,
        "answers must cover every registered model exactly once"
    );
}

#[test]
fn consensus_rejects_unregistered_model() {
    let c = setup3();
    let mut a = answers3(&c, 1, ["YES", "YES", "NO"]);
    a[2].model = "openai/gpt-5".to_string();
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), a);
    assert!(!r.ok);
    assert_eq!(
        r.reason,
        "answers must cover every registered model exactly once"
    );
}

#[test]
fn consensus_rejects_any_bad_signature() {
    let c = setup3();
    let mut a = answers3(&c, 1, ["NO", "YES", "YES"]);
    a[0].response_body = response_with("YES");
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), a);
    assert!(!r.ok);
    assert_eq!(r.reason, format!("{}: invalid signature", MODELS3[0]));
    let mut a = answers3(&c, 1, ["YES", "YES", "YES"]);
    a[1].signature_hex = "00".repeat(64);
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), a);
    assert!(!r.ok);
    assert_eq!(r.reason, format!("{}: invalid signature", MODELS3[1]));
}

#[test]
fn consensus_rejects_signature_by_other_models_key() {
    let c = setup3();
    let a = vec![
        answer_by(&c, 1, 0, 0, "YES"),
        answer_by(&c, 1, 1, 0, "YES"),
        answer_by(&c, 1, 2, 2, "NO"),
    ];
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), a);
    assert!(!r.ok);
    assert_eq!(r.reason, format!("{}: invalid signature", MODELS3[1]));
}

#[test]
fn consensus_binds_request_id() {
    let c = setup3();
    let r = c.verify_consensus(
        base(),
        2,
        QUESTION.to_string(),
        answers3(&c, 1, ["YES", "YES", "YES"]),
    );
    assert!(!r.ok);
    assert!(r.reason.ends_with("invalid signature"));
}

#[test]
fn consensus_needs_at_least_three_registered_models() {
    let c = setup();
    let resp = response_with("YES");
    let sig = sign_for(&c, 1, QUESTION, MODEL, &resp);
    let r = c.verify_consensus(
        base(),
        1,
        QUESTION.to_string(),
        vec![ModelAnswer {
            model: MODEL.to_string(),
            response_body: resp,
            signature_hex: sig,
        }],
    );
    assert!(!r.ok);
    assert_eq!(r.reason, "at least 3 registered models required");
}

#[test]
fn consensus_majority_scales_with_registered_models() {
    let mut c = setup3();
    let extra = SigningKey::from_bytes(&[77u8; 32]);
    c.set_model_key(
        "extra/model".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(extra.verifying_key().as_bytes()),
    );
    let mut a = answers3(&c, 1, ["YES", "YES", "NO"]);
    let body = response_with("NO");
    let text = c.signed_text(
        base(),
        1,
        QUESTION.to_string(),
        "extra/model".to_string(),
        body.clone(),
    );
    a.push(ModelAnswer {
        model: "extra/model".to_string(),
        response_body: body,
        signature_hex: hex::encode(extra.sign(text.as_bytes()).to_bytes()),
    });
    let r = c.verify_consensus(base(), 1, QUESTION.to_string(), a);
    assert!(r.ok);
    assert_eq!(r.required, 3);
    assert_eq!(r.answer, "UNKNOWN");
}

#[test]
fn fulfill_on_base_consensus_builds_promise_and_marks_after_callback() {
    let mut c = setup3();
    fulfill_ctx();
    let _p = c.fulfill_on_evm(
        base(),
        5,
        QUESTION.to_string(),
        answers3(&c, 5, ["YES", "NO", "YES"]),
        0,
        U128(1),
        U128(1),
    );
    assert!(!c.is_fulfilled(base(), 5));
    let out = c.on_signed(
        Ok(json!({"big_r":"x"})),
        CHAIN_ID,
        5,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    assert_eq!(out["ok"], true);
    assert!(c.is_fulfilled(base(), 5));
}

#[test]
#[should_panic(expected = "answers must cover every registered model exactly once")]
fn fulfill_on_base_rejects_single_model_answer() {
    let mut c = setup3();
    fulfill_ctx();
    let one = vec![answer_by(&c, 5, 0, 0, "YES")];
    let _ = c.fulfill_on_evm(base(), 5, QUESTION.to_string(), one, 0, U128(1), U128(1));
}

#[test]
#[should_panic(expected = "invalid signature")]
fn fulfill_on_base_rejects_tampered_consensus() {
    let mut c = setup3();
    fulfill_ctx();
    let mut a = answers3(&c, 5, ["NO", "NO", "YES"]);
    a[0].response_body = response_with("YES");
    let _ = c.fulfill_on_evm(base(), 5, QUESTION.to_string(), a, 0, U128(1), U128(1));
}

#[test]
#[should_panic(expected = "only owner")]
fn fulfill_on_base_consensus_rejects_non_owner() {
    let mut c = setup3();
    let a = answers3(&c, 5, ["YES", "YES", "YES"]);
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id("mallory.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1))
        .build());
    let _ = c.fulfill_on_evm(base(), 5, QUESTION.to_string(), a, 0, U128(1), U128(1));
}

#[test]
#[should_panic(expected = "request already fulfilled")]
fn fulfill_on_base_consensus_rejects_duplicate() {
    let mut c = setup3();
    fulfill_ctx();
    c.on_signed(
        Ok(json!({})),
        CHAIN_ID,
        9,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        vec![],
    );
    let a = answers3(&c, 9, ["YES", "YES", "YES"]);
    let _ = c.fulfill_on_evm(base(), 9, QUESTION.to_string(), a, 0, U128(1), U128(1));
}

const PROVIDER: &str = "near-ai";
const SCHEME: &str = "nearai-v1";
const RELAYER: &str = "relayer.testnet";
const ORACLE_ACCOUNT: &str = "oracle.testnet";

fn ctx_as(account: &str, deposit: u128) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(account.parse().unwrap())
        .current_account_id(ORACLE_ACCOUNT.parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .build());
}

fn callback_as_contract() {
    ctx_as(ORACLE_ACCOUNT, 0);
}

fn relayer_id() -> AccountId {
    RELAYER.parse().unwrap()
}

fn setup3_with_relayer() -> AiOracle {
    let mut c = setup3();
    owner_ctx();
    assert!(c.add_relayer(relayer_id()));
    c
}

fn answer_q(
    c: &AiOracle,
    request_id: u64,
    question: &str,
    model_index: usize,
    content: &str,
) -> ModelAnswer {
    let model = MODELS3[model_index];
    let response_body = response_with(content);
    let text = c.signed_text(
        base(),
        request_id,
        question.to_string(),
        model.to_string(),
        response_body.clone(),
    );
    ModelAnswer {
        model: model.to_string(),
        response_body,
        signature_hex: hex::encode(key_n(model_index).sign(text.as_bytes()).to_bytes()),
    }
}

fn votes3(contents: [&str; 3]) -> Vec<Vote> {
    (0..3)
        .map(|i| Vote {
            model: MODELS3[i].to_string(),
            answer: contents[i].to_string(),
        })
        .collect()
}

fn event_logs() -> Vec<Value> {
    near_sdk::test_utils::get_logs()
        .iter()
        .filter_map(|l| {
            l.strip_prefix("EVENT_JSON:")
                .map(|s| serde_json::from_str(s).unwrap())
        })
        .collect()
}

#[test]
fn owner_manages_relayer_set() {
    let mut c = setup3();
    assert!(c.relayers().is_empty());
    assert!(c.add_relayer(relayer_id()));
    assert!(!c.add_relayer(relayer_id()));
    assert_eq!(c.relayers(), vec![relayer_id()]);
    assert!(c.remove_relayer(relayer_id()));
    assert!(!c.remove_relayer(relayer_id()));
    assert!(c.relayers().is_empty());
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_add_relayers() {
    let mut c = setup3_with_relayer();
    ctx_as(RELAYER, 0);
    c.add_relayer("other.testnet".parse().unwrap());
}

#[test]
#[should_panic(expected = "only owner")]
fn stranger_cannot_remove_relayer() {
    let mut c = setup3_with_relayer();
    ctx_as("mallory.testnet", 0);
    c.remove_relayer(relayer_id());
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_change_models() {
    let mut c = setup3_with_relayer();
    ctx_as(RELAYER, 0);
    c.set_model_key(
        "evil/model".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        "00".repeat(32),
    );
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_reset_fulfilled() {
    let mut c = setup3_with_relayer();
    ctx_as(RELAYER, 0);
    c.reset_fulfilled(base(), 1);
}

#[test]
fn relayer_can_fulfill_on_base_with_zero_deposit() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 30, ["YES", "YES", "NO"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 30, QUESTION.to_string(), a, 0, U128(1), U128(1));
    assert!(c.is_pending(base(), 30));
    assert!(!c.is_fulfilled(base(), 30));
}

#[test]
#[should_panic(expected = "only owner or relayer")]
fn stranger_cannot_fulfill_on_base_when_relayers_exist() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 31, ["YES", "YES", "YES"]);
    ctx_as("mallory.testnet", 0);
    let _ = c.fulfill_on_evm(base(), 31, QUESTION.to_string(), a, 0, U128(1), U128(1));
}

#[test]
#[should_panic(expected = "only owner or relayer")]
fn removed_relayer_cannot_fulfill_on_base() {
    let mut c = setup3_with_relayer();
    assert!(c.remove_relayer(relayer_id()));
    let a = answers3(&c, 32, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_evm(base(), 32, QUESTION.to_string(), a, 0, U128(1), U128(1));
}

#[test]
fn fulfill_on_base_pays_one_yocto_from_contract_and_forwards_votes() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 60, ["NO", "NO", "YES"]);
    ctx_as(RELAYER, 0);
    drop(c.fulfill_on_evm(base(), 60, QUESTION.to_string(), a, 3, U128(10), U128(2)));
    let receipts = near_sdk::test_utils::get_created_receipts();
    let sign = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == "v1.signer-prod.testnet")
        .expect("sign receipt");
    let callback = receipts
        .iter()
        .find(|r| r.receiver_id.as_str() == ORACLE_ACCOUNT)
        .expect("callback receipt");
    match &sign.actions[..] {
        [near_sdk::mock::MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        }] => {
            assert_eq!(method_name.as_slice(), b"sign");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            assert_eq!(*prepaid_gas, SIGN_GAS);
            let v: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(v["request"]["path"], "base-1");
            assert_eq!(v["request"]["domain_id"], 0);
        }
        other => panic!("unexpected sign actions {other:?}"),
    }
    match &callback.actions[..] {
        [near_sdk::mock::MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            ..
        }] => {
            assert_eq!(method_name.as_slice(), b"on_signed");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(0));
            let v: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(v["request_id"], 60);
            assert_eq!(v["answer"], "NO");
            assert_eq!(
                v["votes"],
                serde_json::to_value(votes3(["NO", "NO", "YES"])).unwrap()
            );
        }
        other => panic!("unexpected callback actions {other:?}"),
    }
}

#[test]
fn on_signed_success_logs_fulfilled_event_with_votes() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 50, ["YES", "NO", "YES"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 50, QUESTION.to_string(), a, 0, U128(1), U128(1));
    callback_as_contract();
    let out = c.on_signed(
        Ok(json!({"big_r":"x"})),
        CHAIN_ID,
        50,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        votes3(["YES", "NO", "YES"]),
    );
    assert_eq!(out["ok"], true);
    assert_eq!(
        event_logs(),
        vec![json!({
            "standard": "psephex",
            "version": "1.1.0",
            "event": "fulfilled",
            "data": [{
                "chain": BASE,
                "request_id": 50,
                "answer": "YES",
                "votes": [
                    {"model": MODELS3[0], "answer": "YES"},
                    {"model": MODELS3[1], "answer": "NO"},
                    {"model": MODELS3[2], "answer": "YES"}
                ]
            }]
        })]
    );
    assert!(c.is_fulfilled(base(), 50));
    assert!(!c.is_pending(base(), 50));
}

#[test]
#[should_panic(expected = "request signing in progress")]
fn second_fulfill_while_signing_is_rejected() {
    let mut c = setup3_with_relayer();
    let first = answers3(&c, 70, ["YES", "YES", "YES"]);
    let second = answers3(&c, 70, ["NO", "NO", "NO"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 70, QUESTION.to_string(), first, 0, U128(1), U128(1));
    let _q = c.fulfill_on_evm(
        base(),
        70,
        QUESTION.to_string(),
        second,
        1,
        U128(1),
        U128(1),
    );
}

#[test]
fn failed_sign_clears_pending_and_allows_retry() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 71, ["YES", "YES", "NO"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(
        base(),
        71,
        QUESTION.to_string(),
        a.clone(),
        0,
        U128(1),
        U128(1),
    );
    callback_as_contract();
    let out = c.on_signed(
        Err(PromiseError::Failed),
        CHAIN_ID,
        71,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        votes3(["YES", "YES", "NO"]),
    );
    assert_eq!(out["ok"], false);
    assert!(event_logs().iter().all(|e| e["event"] != "fulfilled"));
    assert!(!c.is_pending(base(), 71));
    assert!(!c.is_fulfilled(base(), 71));
    ctx_as(RELAYER, 0);
    let _r = c.fulfill_on_evm(base(), 71, QUESTION.to_string(), a, 1, U128(1), U128(1));
    assert!(c.is_pending(base(), 71));
}

#[test]
fn reset_fulfilled_clears_stuck_pending() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 72, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 72, QUESTION.to_string(), a, 0, U128(1), U128(1));
    assert!(c.is_pending(base(), 72));
    owner_ctx();
    assert!(c.reset_fulfilled(base(), 72));
    assert!(!c.is_pending(base(), 72));
    assert!(!c.reset_fulfilled(base(), 72));
}

#[test]
fn question_at_limit_is_accepted() {
    let c = setup3();
    let q = "q".repeat(MAX_QUESTION_BYTES);
    let a: Vec<ModelAnswer> = (0..3).map(|i| answer_q(&c, 40, &q, i, "YES")).collect();
    let r = c.verify_consensus(base(), 40, q, a);
    assert!(r.ok, "{}", r.reason);
    assert_eq!(r.answer, "YES");
}

#[test]
fn question_over_limit_fails_consensus_view() {
    let c = setup3();
    let r = c.verify_consensus(base(), 41, "q".repeat(MAX_QUESTION_BYTES + 1), vec![]);
    assert!(!r.ok);
    assert_eq!(
        r.reason,
        format!(
            "question too long: {} bytes, max {}",
            MAX_QUESTION_BYTES + 1,
            MAX_QUESTION_BYTES
        )
    );
}

#[test]
fn question_limit_counts_bytes_not_chars() {
    let c = setup3();
    let q = "ї".repeat(MAX_QUESTION_BYTES / 2 + 1);
    assert!(q.chars().count() < MAX_QUESTION_BYTES);
    let r = c.verify_consensus(base(), 42, q, vec![]);
    assert!(!r.ok);
    assert!(r.reason.starts_with("question too long"), "{}", r.reason);
}

#[test]
fn verify_answer_rejects_long_question_without_panic() {
    let c = setup();
    let r = c.verify_answer(
        base(),
        1,
        "q".repeat(MAX_QUESTION_BYTES + 1),
        MODEL.to_string(),
        response_with("YES"),
        "00".repeat(64),
    );
    assert!(!r.ok);
    assert!(r.reason.starts_with("question too long"));
    assert_eq!(r.signed_text, "");
}

#[test]
#[should_panic(expected = "question too long")]
fn build_request_rejects_long_question() {
    let c = setup();
    c.build_request(
        base(),
        1,
        "q".repeat(MAX_QUESTION_BYTES + 1),
        MODEL.to_string(),
    );
}

#[test]
#[should_panic(expected = "question too long")]
fn fulfill_on_base_rejects_long_question() {
    let mut c = setup3_with_relayer();
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_evm(
        base(),
        43,
        "q".repeat(MAX_QUESTION_BYTES + 1),
        vec![],
        0,
        U128(1),
        U128(1),
    );
}

#[test]
fn set_model_key_stores_provider_and_scheme() {
    let mut c = setup();
    let key = hex::encode(key_n(5).verifying_key().as_bytes());
    c.set_model_key(
        "phala/model".to_string(),
        "phala".to_string(),
        SCHEME.to_string(),
        key.clone(),
    );
    let models = c.models();
    let phala = models.iter().find(|m| m.model == "phala/model").unwrap();
    assert_eq!(phala.provider, "phala");
    assert_eq!(phala.scheme, SCHEME);
    assert_eq!(phala.public_key, key);
    let base = models.iter().find(|m| m.model == MODEL).unwrap();
    assert_eq!(base.provider, PROVIDER);
    let v = serde_json::to_value(&models).unwrap();
    let mut keys: Vec<&str> = v[0]
        .as_object()
        .unwrap()
        .keys()
        .map(|k| k.as_str())
        .collect();
    keys.sort();
    assert_eq!(keys, vec!["model", "provider", "public_key", "scheme"]);
}

#[test]
#[should_panic(expected = "unsupported signature scheme: phala-v1")]
fn set_model_key_rejects_unknown_scheme() {
    let mut c = setup();
    c.set_model_key(
        "x".to_string(),
        "phala".to_string(),
        "phala-v1".to_string(),
        "00".repeat(32),
    );
}

#[test]
#[should_panic(expected = "provider must not be empty")]
fn set_model_key_rejects_empty_provider() {
    let mut c = setup();
    c.set_model_key(
        "x".to_string(),
        "  ".to_string(),
        SCHEME.to_string(),
        "00".repeat(32),
    );
}

#[test]
#[should_panic(expected = "public key already registered for model Qwen/Qwen3.8-27B")]
fn set_model_key_rejects_key_reused_by_other_model() {
    let mut c = setup3();
    c.set_model_key(
        "copy/model".to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(key_n(0).verifying_key().as_bytes()),
    );
}

#[test]
fn set_model_key_allows_rotating_same_model() {
    let mut c = setup3();
    c.set_model_key(
        MODELS3[0].to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(key_n(0).verifying_key().as_bytes()),
    );
    let fresh = SigningKey::from_bytes(&[99u8; 32]);
    c.set_model_key(
        MODELS3[0].to_string(),
        PROVIDER.to_string(),
        SCHEME.to_string(),
        hex::encode(fresh.verifying_key().as_bytes()),
    );
    assert_eq!(
        c.models()
            .iter()
            .find(|m| m.model == MODELS3[0])
            .unwrap()
            .public_key,
        hex::encode(fresh.verifying_key().as_bytes())
    );
}

#[test]
fn owner_sets_fee_cap() {
    let mut c = setup3();
    assert_eq!(c.max_fee_per_gas_cap(), FEE_CAP);
    c.set_max_fee_per_gas_cap(U128(5));
    assert_eq!(c.max_fee_per_gas_cap(), U128(5));
}

#[test]
#[should_panic(expected = "only owner")]
fn relayer_cannot_set_fee_cap() {
    let mut c = setup3_with_relayer();
    ctx_as(RELAYER, 0);
    c.set_max_fee_per_gas_cap(U128(u128::MAX));
}

#[test]
#[should_panic(expected = "fee cap must be positive")]
fn fee_cap_rejects_zero() {
    let mut c = setup3();
    c.set_max_fee_per_gas_cap(U128(0));
}

#[test]
fn fulfill_on_base_accepts_fee_at_cap() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 80, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 80, QUESTION.to_string(), a, 0, FEE_CAP, FEE_CAP);
    assert!(c.is_pending(base(), 80));
}

#[test]
#[should_panic(expected = "max_fee_per_gas above cap")]
fn fulfill_on_base_rejects_fee_above_cap() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 81, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_evm(
        base(),
        81,
        QUESTION.to_string(),
        a,
        0,
        U128(FEE_CAP.0 + 1),
        U128(1),
    );
}

#[test]
#[should_panic(expected = "max_priority_fee_per_gas above max_fee_per_gas")]
fn fulfill_on_base_rejects_priority_above_max_fee() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 82, ["YES", "YES", "YES"]);
    ctx_as(RELAYER, 0);
    let _ = c.fulfill_on_evm(base(), 82, QUESTION.to_string(), a, 0, U128(10), U128(11));
}

#[test]
fn failed_sign_logs_sign_failed_event() {
    let mut c = setup3_with_relayer();
    let a = answers3(&c, 83, ["YES", "YES", "NO"]);
    ctx_as(RELAYER, 0);
    let _p = c.fulfill_on_evm(base(), 83, QUESTION.to_string(), a, 0, U128(1), U128(1));
    callback_as_contract();
    c.on_signed(
        Err(PromiseError::Failed),
        CHAIN_ID,
        83,
        "02".to_string(),
        "ab".to_string(),
        "YES".to_string(),
        votes3(["YES", "YES", "NO"]),
    );
    assert_eq!(
        event_logs(),
        vec![
            json!({"standard": "psephex", "version": "1.1.0", "event": "sign_failed", "data": [{"chain": BASE, "request_id": 83}]})
        ]
    );
}

#[test]
fn accepts_a_real_phala_gateway_answer_under_the_dstack_scheme() {
    let fx: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/phala-signature.json")).unwrap();
    let s = |k: &str| fx[k].as_str().unwrap().to_string();
    owner_ctx();
    let mut c = AiOracle::new(
        "owner.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        "base-1".to_string(),
        CHAIN_ID,
        "Base Sepolia".to_string(),
        "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111".to_string(),
        FEE_CAP,
        NEAR_FEE,
    );
    c.set_model_key(
        s("model"),
        "phala".to_string(),
        "dstack-v1".to_string(),
        s("signing_public_key"),
    );
    assert_eq!(
        c.build_request(base(), 1000, s("question"), s("model")),
        s("request_body")
    );
    let (text, result) = c.check_signed_answer(
        BASE,
        1000,
        s("question"),
        &s("model"),
        &s("response_body"),
        &s("signature_hex"),
    );
    assert_eq!(text, s("text"));
    assert_eq!(result, Ok(Ok("YES".to_string())));
    let tampered = s("response_body").replace("\"YES\"", "\"NO\"");
    let (_, rejected) = c.check_signed_answer(
        BASE,
        1000,
        s("question"),
        &s("model"),
        &tampered,
        &s("signature_hex"),
    );
    assert_eq!(rejected, Err("invalid signature".to_string()));
}

#[test]
fn the_two_schemes_are_not_interchangeable() {
    let fx: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/phala-signature.json")).unwrap();
    let s = |k: &str| fx[k].as_str().unwrap().to_string();
    owner_ctx();
    let mut c = AiOracle::new(
        "owner.testnet".parse().unwrap(),
        "v1.signer-prod.testnet".parse().unwrap(),
        "base-1".to_string(),
        CHAIN_ID,
        "Base Sepolia".to_string(),
        "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111".to_string(),
        FEE_CAP,
        NEAR_FEE,
    );
    c.set_model_key(
        s("model"),
        "phala".to_string(),
        SCHEME_NEARAI_V1.to_string(),
        s("signing_public_key"),
    );
    let (text, result) = c.check_signed_answer(
        BASE,
        1000,
        s("question"),
        &s("model"),
        &s("response_body"),
        &s("signature_hex"),
    );
    assert!(text.starts_with("phala/gemma-4-26b-a4b-uncensored:"));
    assert_eq!(result, Err("invalid signature".to_string()));
}

#[test]
fn two_of_three_works_across_both_schemes() {
    let mut c = setup3();
    owner_ctx();
    c.set_model_key(
        MODELS3[2].to_string(),
        "phala".to_string(),
        "dstack-v1".to_string(),
        hex::encode(key_n(2).verifying_key().as_bytes()),
    );
    let mut answers = answers3(&c, 7, ["YES", "YES", "NO"]);
    let dstack_text = c.signed_text(
        base(),
        7,
        QUESTION.to_string(),
        MODELS3[2].to_string(),
        answers[2].response_body.clone(),
    );
    assert!(!dstack_text.contains(MODELS3[2]));
    answers[2].signature_hex = hex::encode(key_n(2).sign(dstack_text.as_bytes()).to_bytes());
    let r = c.verify_consensus(base(), 7, QUESTION.to_string(), answers);
    assert!(r.ok, "{}", r.reason);
    assert_eq!(r.answer, "YES");
}

#[test]
#[should_panic(expected = "unsupported signature scheme: other-v9")]
fn set_model_key_still_rejects_unknown_schemes() {
    let mut c = setup3();
    owner_ctx();
    c.set_model_key(
        "m".to_string(),
        "x".to_string(),
        "other-v9".to_string(),
        "aa".repeat(32),
    );
}

mod near;

#[test]
#[should_panic(expected = "chain has signatures in progress")]
fn set_chain_refuses_while_signing() {
    let mut c = setup();
    c.pending.insert((CHAIN_ID, 3));
    c.set_chain(
        CHAIN_ID,
        "Base Sepolia".to_string(),
        BASE_ORACLE.to_string(),
    );
}
