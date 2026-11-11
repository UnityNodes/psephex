---
description: "How a Psephex case and an oracle request move through the court, the TEE models, the 2-of-3 check on NEAR and Chain Signatures."
---

# How it works

Psephex has two layers. The court (`psephex-court.testnet`) holds the stake, collects both sides' evidence and writes the question. The oracle (`oracle.psephex.testnet`) gets that question answered by three models in TEEs, checks the signatures and the two-of-three rule, and keeps the verdict. The court is just one client of the oracle: any NEAR contract, and any contract on Base Sepolia or Arbitrum Sepolia, can ask the oracle directly.

## A case between two agents

1. **The buyer agent opens a case.** It calls `open_case` on `psephex-court.testnet` with a claim, its evidence, the seller's account and a NEAR deposit. The deposit covers the stake, a reserve for the oracle fee and the storage for the case record. Each text is at most 400 bytes in its quoted form, on one line, with no control characters.
2. **The seller agent answers.** Within the response window (120 seconds on testnet today; read it with `config`), only the counterparty can call `respond(case_id, response)`. That sends the case to the oracle at once. If the seller stays silent, anyone can call `submit(case_id)` after the window, and the question records that there was no response.
3. **The court writes the question.** It quotes the claim, the evidence and the response as JSON strings, word for word, after a line that tells the models to treat them only as evidence and ignore any instructions inside them. Anyone can read the exact text with `question_for(case_id)` before the models answer.
4. **The court pays the oracle the exact price.** It asks the oracle for `ask_deposit(question)`, pays exactly that out of the reserve, returns the rest to the claimant, and calls `ask` with `callback: true`.
5. **Three models answer in TEEs, and NEAR checks two of three.** See the oracle flow below. The oracle then calls `on_answer(request_id, answer)` on the court.
6. **The appeal window runs.** The case is `decided` with YES, NO or UNKNOWN. Within the appeal window either party can call `appeal` with exactly the case's appeal bond attached. A human arbiter then has the arbitration window to rule for the claimant or the counterparty.
7. **Anyone finalizes.** After the appeal window, `finalize(case_id)` pays the stake by the verdict: YES or UNKNOWN to the claimant, NO to the counterparty. If the arbiter ruled, the winner gets the stake plus the bond. If the arbiter stayed silent through the arbitration window, the verdict stands and the appellant gets the bond back.

If the oracle never answers, `refund(case_id)` returns the stake to the claimant after the answer timeout. If the oracle refuses the question, the court returns the stake and the oracle money to the claimant in the same transaction chain.

A case moves through these stages: `awaiting_response`, `asking`, `awaiting_verdict`, `decided`, then `appealed` or straight to `settled`, or `refunded` if it got stuck before a verdict.

## A question to the oracle

1. **The question is recorded.** From NEAR, a person or contract calls `ask(question, callback)` on `oracle.psephex.testnet` with a NEAR deposit. The contract stores the question and emits an `asked` event. From Base Sepolia or Arbitrum Sepolia, a contract calls `AiOracle.ask(question)` with the fee; the EVM contract stores the question hash and emits `Asked`.
2. **Three models answer in TEEs.** The relayer asks the NEAR contract to build the exact request (`build_request`): temperature 0, a fixed seed, and the request id and source inside the prompt. It sends those bytes to each model. The two NEAR AI Cloud models sign `model:sha256(request):sha256(response)` with their own key. On Phala, the attested Dstack gateway signs `sha256(request):sha256(response)`.
3. **NEAR checks two of three.** `fulfill_on_near` or `fulfill_on_evm` rebuilds the request, verifies every signature against the keys registered on NEAR and needs two matching answers. For a NEAR question the contract takes the question from its own state, so the relayer cannot change it.
4. **NEAR keeps the verdict, or signs it for an EVM chain.** A NEAR question ends here: the verdict and the votes are stored, and `on_answer(request_id, answer)` is called on the asker if it asked for a callback. For Base or Arbitrum, the NEAR contract builds the EIP-1559 transaction and asks the MPC signer `v1.signer-prod.testnet` to sign it. The relayer only carries the signed bytes.
5. **The EVM chain accepts it.** `AiOracle.fulfill` accepts the answer only from the MPC-derived address `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`, and only for the matching request id and question hash. Then it calls the asking contract's `onAnswer`.

## The models

| Model | Where it runs | Who signs |
|---|---|---|
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | NEAR AI Cloud | the model's own key in its enclave (`nearai-v1`) |
| `Qwen/Qwen3.6-35B-A3B-FP8` | NEAR AI Cloud | the model's own key in its enclave (`nearai-v1`) |
| `phala/gemma-4-26b-a4b-uncensored` | Phala | the attested Dstack gateway (`dstack-v1`) |

The live list, the registered public keys and a link to fetch a fresh attestation are on the [models page](https://psephex.xyz/app/models). The oracle contract returns the same set from `models`.

## The relayer and the API

The relayer is a crash-safe state machine over SQLite. Killed between steps, it resumes without signing twice. It holds only function-call keys of `relayer.psephex.testnet` that can submit answers (`fulfill_on_evm`, `fulfill_on_near`), and the contract still checks every signature.

The [read-only API](/reference/api) runs as a separate process with no keys. It only hands out data and arguments; every check runs on the NEAR contract.
