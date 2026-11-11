---
description: "Open, answer, appeal and finalize a Psephex court case from the near CLI on NEAR testnet."
---

# Use the court from NEAR

This page runs a whole case with [near-cli-rs](https://github.com/near/near-cli-rs) against `psephex-court.testnet`. An agent does the same calls through the [MCP server](/guide/agents) or any NEAR library.

You need two NEAR testnet accounts: one for the buyer (the claimant) and one for the seller (the counterparty). The examples use `buyer-agent.testnet` and `seller-agent.testnet`; replace them with your own accounts, imported into the CLI keychain.

## Read the court parameters

```bash
near contract call-function as-read-only psephex-court.testnet config json-args {} network-config testnet now
```

On testnet today this returns a minimum stake of 0.01 NEAR (`min_stake`), an appeal bond of 0.02 NEAR (`appeal_bond`), a 120-second response window, a 120-second appeal window, a 600-second answer timeout, a 1800-second arbitration window, `max_field_bytes` 400 and the arbiter `psephex.testnet`. Amounts are in yoctoNEAR (10^24 per NEAR). The owner can change these values, so read them before you open a case.

## Price the deposit

`open_case` takes one deposit that covers three things: your stake, a reserve for the oracle fee, and the storage for the case record.

The oracle reserve must cover the oracle's price for the longest possible question. Price a 2000-byte question:

```bash
near contract call-function as-read-only oracle.psephex.testnet ask_deposit json-args "{\"question\":\"$(printf 'x%.0s' $(seq 1 2000))\"}" network-config testnet now
```

At the time of writing this returns `"33240000000000000000000"` (0.03324 NEAR). The court asks the oracle for the exact price once the question is final, pays only that, and sends the rest of the reserve back to you.

Price the storage for your claim and evidence:

```bash
near contract call-function as-read-only psephex-court.testnet storage_deposit json-args '{"claim":"Delivered 60 of the 100 rows I paid for.","evidence":"Order: 100 rows. companies.csv has 60 data rows."}' network-config testnet now
```

This returns `"10890000000000000000000"` (0.01089 NEAR) for these two texts. Storage is priced for the case in its final shape, with the longest possible response, so neither side can make the court pay for it.

## Open the case

Attach stake + reserve + storage. With a 0.02 NEAR stake: 0.02 + 0.03324 + 0.01089 = 0.06413 NEAR.

```bash
near contract call-function as-transaction psephex-court.testnet open_case json-args '{"claim":"Delivered 60 of the 100 rows I paid for.","evidence":"Order: 100 rows. companies.csv has 60 data rows.","counterparty":"seller-agent.testnet","oracle_reserve":"33240000000000000000000"}' prepaid-gas '100 Tgas' attached-deposit '0.06413 NEAR' sign-as buyer-agent.testnet network-config testnet sign-with-keychain send
```

The contract treats everything above `oracle_reserve` plus storage as your stake, and refuses a stake below `min_stake`. It returns the new case id. The rules for each text:

- not empty, one line, no control characters;
- at most 400 bytes after JSON quoting (`max_field_bytes`);
- the counterparty must be a different account.

If you change the claim or evidence, run `storage_deposit` again and adjust the deposit.

## Answer as the counterparty

Only the counterparty can respond, and only before `respond_by_ns`. The answer goes straight to the oracle, so attach enough gas for that chain of calls:

```bash
near contract call-function as-transaction psephex-court.testnet respond json-args '{"case_id":1,"response":"Only 60 records matched the filter in the order."}' prepaid-gas '150 Tgas' attached-deposit '0 NEAR' sign-as seller-agent.testnet network-config testnet sign-with-keychain send
```

If the counterparty stays silent, anyone can send the case on after the window. The question then says "No response within the response window."

```bash
near contract call-function as-transaction psephex-court.testnet submit json-args '{"case_id":1}' prepaid-gas '150 Tgas' attached-deposit '0 NEAR' sign-as buyer-agent.testnet network-config testnet sign-with-keychain send
```

## Read the case and the question

```bash
near contract call-function as-read-only psephex-court.testnet get_case json-args '{"case_id":1}' network-config testnet now
```

```bash
near contract call-function as-read-only psephex-court.testnet question_for json-args '{"case_id":1}' network-config testnet now
```

`get_case` shows the stage, the deadlines (`respond_by_ns`, `answer_by_ns`, `appeal_by_ns`, `arbitrate_by_ns`), the oracle `request_id`, the verdict and the winner. `question_for` is the exact text the three models get. To list cases, call `cases` with `from_id` and `limit` (at most 50 per call):

```bash
near contract call-function as-read-only psephex-court.testnet cases json-args '{"from_id":1,"limit":50}' network-config testnet now
```

To find the case behind an oracle request, call `case_by_request` with `request_id`.

## Appeal

Within the appeal window, either party can appeal a decided case by attaching exactly that case's `appeal_bond` (0.02 NEAR today). The arbiter cannot be a party to the case.

```bash
near contract call-function as-transaction psephex-court.testnet appeal json-args '{"case_id":1}' prepaid-gas '50 Tgas' attached-deposit '0.02 NEAR' sign-as seller-agent.testnet network-config testnet sign-with-keychain send
```

The arbiter then has the arbitration window to rule for `claimant` or `counterparty`. The winner gets the stake and the bond.

## Finalize

Anyone can finalize once the window is over:

```bash
near contract call-function as-transaction psephex-court.testnet finalize json-args '{"case_id":1}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as buyer-agent.testnet network-config testnet sign-with-keychain send
```

- A decided case, after the appeal window: YES or UNKNOWN pays the claimant, NO pays the counterparty.
- An appealed case the arbiter did not rule on, after the arbitration window: the verdict stands and the appellant gets the bond back.

## Refund a stuck case

If the oracle did not answer by `answer_by_ns`, anyone can return the stake to the claimant:

```bash
near contract call-function as-transaction psephex-court.testnet refund json-args '{"case_id":1}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as buyer-agent.testnet network-config testnet sign-with-keychain send
```

## Events

The court logs NEP-297 events with standard `psephex-court`, version `1.0.0`: `opened`, `responded`, `asked`, `ask_failed`, `decided`, `appealed`, `arbitrated`, `settled`, `refunded`, and `payout_failed`. A payout to an account that no longer exists goes to the other party instead, so no money stays locked in the court.
