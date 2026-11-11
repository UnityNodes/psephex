---
description: "Ask the Psephex oracle from a NEAR contract with ask and on_answer, with a Rust example."
---

# Ask from a NEAR contract

Any NEAR testnet contract can ask `oracle.psephex.testnet` a yes-or-no question and get the verdict back in a callback. The court is one such client.

## The interface

| Method | Kind | What it does |
|---|---|---|
| `ask_deposit(question)` | view | the exact deposit for this question: the fee plus storage for the answered record |
| `ask(question, callback)` | payable call | records the question and returns its `request_id`; with `callback: true` the oracle calls you back |
| `on_answer(request_id, answer)` | your method | called by the oracle with `YES`, `NO` or `UNKNOWN` |
| `near_request(request_id)` | view | the stored question, its keccak256 hash, the verdict and the votes |
| `near_fee()` | view | the fee part of the deposit (0.01 NEAR on testnet today) |

Rules enforced by `ask`:

- the question is not empty and at most 2000 bytes;
- the deposit is at least `ask_deposit(question)`; anything above it is refunded to the caller in the same call.

## Try it from the CLI

Price a question, then ask it. Replace `you.testnet` with your account:

```bash
near contract call-function as-read-only oracle.psephex.testnet ask_deposit json-args '{"question":"Is 7 a prime number?"}' network-config testnet now
```

```bash
near contract call-function as-transaction oracle.psephex.testnet ask json-args '{"question":"Is 7 a prime number?"}' prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as you.testnet network-config testnet sign-with-keychain send
```

The first call returns about 0.01344 NEAR for this question. The second keeps that and refunds the rest of the 0.1 NEAR. In about 9 seconds the relayer delivers the verdict. Read it with the request id `ask` returned:

```bash
near contract call-function as-read-only oracle.psephex.testnet near_request json-args '{"request_id":1}' network-config testnet now
```

## From your contract

Forward the caller's deposit to `ask` with `callback: true`, and accept `on_answer` only from the oracle:

```rust
use near_sdk::{env, near, require, Gas, Promise};
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
}
```

The oracle calls `on_answer` with 30 Tgas. The verdict is stored on the oracle before the callback, so a failing `on_answer` does not lose it: the oracle logs a `callback` event with `ok: false` and the answer stays readable through `near_request`.

If you attach more than `ask_deposit`, the oracle refunds the difference to your contract, not to the original user. Price the question first, or handle the refund.

## What comes back

`near_request` returns:

| Field | Meaning |
|---|---|
| `chain` | `near:testnet` |
| `request_id`, `asker`, `question` | what was asked and by whom |
| `question_hash` | keccak256 of the question, `0x`-prefixed |
| `paid` | the deposit the oracle kept, in yoctoNEAR |
| `callback` | whether the oracle calls `on_answer` |
| `answer` | `YES`, `NO` or `UNKNOWN`, or `null` before the verdict |
| `votes` | each model's answer |
| `created_ns`, `answered_ns` | block timestamps in nanoseconds |

The oracle also logs NEP-297 events with standard `psephex`, version `1.1.0`: `asked` when the question is recorded, `fulfilled` with the answer and votes, and `callback` with whether `on_answer` succeeded.

## Answers

- `YES` or `NO`: at least two of the three models gave that answer, each signed inside a TEE by a key registered on the oracle.
- `UNKNOWN`: at least two models answered UNKNOWN, or no answer got two votes. A model reply that is not a clear YES, NO or UNKNOWN counts as UNKNOWN. The court pays UNKNOWN to the claimant; your contract decides what UNKNOWN means for it.

Every answer must carry a valid signature from its registered model. If one signature fails, the whole delivery is refused and nothing is stored.

The models only see the question. Put all the evidence in it: they do not browse, open files or know fresh events.
