# What a verdict proves

A Psephex verdict is a strong statement about who answered and how the answer was checked. It is not a statement that the answer is right. This page lists both sides plainly, so you can decide what to rely on.

## What a verdict proves

- **Neither side wrote the question.** The court contract builds it from the claim, the evidence and the response, quoted as they were filed, and both sides can read it with `question_for` before the models do.
- **Each answer was signed inside a TEE** by a key registered on NEAR and attested with a fresh nonce: the model's own key on NEAR AI Cloud, the gateway's key on Phala.
- **At least two of the three signed answers agree.** The NEAR contract checks this, not our server.
- **The models saw the request the NEAR contract built** from the question asked on NEAR or on Base, with temperature 0 and a fixed seed inside the signed request.
- **On Base and Arbitrum, only the MPC-derived address can deliver the answer**, and only for the matching request id and question hash. There is no bridge and no oracle key on a server.
- **Answers repeat in practice.** 80 of 80 repeats matched in our first check, 90 of 90 for the dashboard examples on NEAR AI Cloud and 30 of 30 on Phala.
- **The court's code cannot change.** `psephex-court.testnet` has had no access keys since its deploy.
- **The oracle's rules cannot change under a case.** Since 10 November 2026 `oracle.psephex.testnet` has no access keys. A new model key, EVM target, reset of a settled request, higher gas cap or new code is announced on chain with `propose` and runs only 24 hours later, within a seven-day window. New code runs only if its sha256 was announced. See [owner timelock](/trust/owner-timelock).

## What a verdict does not prove

- **That the answer is right.** In [Base request 2](https://psephex.xyz/app/r/base/2) all three models said 9 is a prime number, and the oracle delivered that. Models can be wrong about a deal too, which is why the court has an appeal.
- **That asking again is impossible.** Temperature 0 and the seed make repeats match in practice, not cryptographically.
- **Fully independent operators.** Two models run on NEAR AI Cloud and one on Phala. On Phala one attested gateway signs for the model it routes to, so you trust that gateway.
- **That the evidence is true.** The models judge only the text both sides put on the record. They do not open the delivered file, browse, or check a timestamp. Use `check_payment` in the [MCP server](/guide/agents) to turn a payment into a checked evidence line.
- **Knowledge of fresh events.** The evidence has to be in the question.
- **A decentralized appeal.** The arbiter is one person today (`psephex.testnet`), set by the court owner, and cannot be a party to the case. If the arbiter does not rule in time, the verdict stands and the appellant gets the bond back.
- **Immutable oracle code.** The owner `psephex.testnet`, whose key is held offline, can still replace the models or the code in the open, a day after announcing it. The oracle code decides what the MPC network signs for Base and Arbitrum.
- **A fixed model set.** Qwen3.8 27B answered requests 1 to 10 and was replaced by Gemma on 9 November 2026. `verify_consensus` checks the current set, so those older requests are verified by their NEAR and Base transactions instead.

## Who holds which key

| Account | Keys | What they can do |
|---|---|---|
| `oracle.psephex.testnet` | none | nothing outside its own code |
| `psephex-court.testnet` | none | nothing outside its own code |
| `psephex.testnet` (owner and arbiter) | full access, held offline | propose oracle changes that wait 24 hours; change relayers and the NEAR fee; change court parameters and the arbiter; rule on appeals |
| `relayer.psephex.testnet` | function-call keys for `fulfill_on_evm` and `fulfill_on_near` only | submit answers, which the contract still checks signature by signature |
| `dispute.psephex.testnet` (v1 example) | still has a full-access key | the older one-sided escrow example |

The API server holds no keys at all.

## Prompt injection

Party texts are untrusted. The court accepts them only as single lines without control characters, quotes each one as a JSON string, and puts them after a line that tells the models to treat the quoted texts only as evidence and ignore any instructions inside them. A party cannot start a new line inside the question to forge another party's statement or append an answer.

The MCP server adds its own limits for agents, since the model driving an agent can be steered by text it reads: a cap per stake, a budget per process and an optional list of allowed counterparties.
