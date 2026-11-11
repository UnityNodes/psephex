# Psephex

Psephex is a judge for deals between AI agents, running on NEAR. An agent that ordered work and an agent that delivered it both put their evidence on the record in a NEAR court contract; three AI models answer the court's question inside TEEs and sign their answers; the NEAR oracle contract checks every signature and requires two matching answers; the court pays out by the verdict, and either side can appeal to a human arbiter within a window.

Underneath is a general yes-or-no oracle. Any NEAR contract can call `ask` with a NEAR deposit and get `on_answer` back. EVM chains get the same verdict through NEAR Chain Signatures: the NEAR contract signs the transaction that delivers it to Base Sepolia or Arbitrum Sepolia, with no bridge and no oracle key on a server.

The problem it solves: agents (and the contracts they use) increasingly pay each other for work, and someone has to decide whether the work was done. Today that means trusting one operator's server and one model, and letting whoever writes the question decide the answer. In Psephex both sides write their own evidence, the court contract writes the question, the model answers are attestable, the 2-of-3 rule is enforced on chain, a wrong verdict can be appealed, and every verdict since the current model set (all NEAR requests, Base 11 and later, Arbitrum 1) can be re-checked by anyone with two CLI commands.

Hosted demo: **[psephex.xyz](https://psephex.xyz)** (landing), [psephex.xyz/app](https://psephex.xyz/app) (dashboard), [psephex.xyz/api/health](https://psephex.xyz/api/health) (read-only API), [docs.psephex.xyz](https://docs.psephex.xyz) (documentation). Testnet only. Demo video (2:53): [youtu.be/kYzTd7s_mTk](https://youtu.be/kYzTd7s_mTk).

## At a glance

| | |
|---|---|
| Ask from | NEAR testnet (pay in NEAR), Base Sepolia 84532 and Arbitrum Sepolia 421614 (pay in ETH). Testnet only. |
| Models | DeepSeek V4.1 Flash and Qwen3.6 35B on NEAR AI Cloud, Gemma 4 26B on Phala. Two of three must agree. |
| Answer time | 17.5 to 21.1 s from the relayer seeing a question to the answer on Base (requests 10 to 13); about 9 s for a NEAR question (8.1 to 9.4 s, NEAR requests 1 to 6) |
| Cost per question | NEAR: 0.01 NEAR fee plus 0.003 to 0.023 NEAR storage, by question length. Base: 0.0001 ETH fee, about 16 Tgas on NEAR, 67k to 107k gas on Base with a dispute callback |
| Tests | NEAR oracle 161, NEAR court 47, NEAR dispute 19, Base 79, relayer and API 241, web 152, MCP 20 |

## Deployed contracts

| What | Where |
|---|---|
| NEAR oracle contract | [`oracle.psephex.testnet`](https://testnet.nearblocks.io/address/oracle.psephex.testnet) (v4, wasm sha256 `0f390e19…`, no access keys): `ask`, `fulfill_on_near`, `verify_consensus`, Chain Signatures for EVM, owner changes only through `propose` with a 24-hour delay |
| NEAR court (agent deals, both sides, appeal) | [`psephex-court.testnet`](https://testnet.nearblocks.io/address/psephex-court.testnet): owner and arbiter `psephex.testnet` (key offline) |
| NEAR dispute v1 (one-sided escrow example) | [`dispute.psephex.testnet`](https://testnet.nearblocks.io/address/dispute.psephex.testnet): stake in NEAR, verdict through `on_answer` |
| AiOracle | Base Sepolia [`0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111`](https://sepolia.basescan.org/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111) |
| Dispute (escrow example) | Base Sepolia [`0xCa744C595A6C2EE470257D2B873aEd2b1a78E092`](https://sepolia.basescan.org/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) |
| AiOracle and Dispute on Arbitrum | Arbitrum Sepolia, the same addresses: [`0x792b…6111`](https://sepolia.arbiscan.io/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111), [`0xCa74…E092`](https://sepolia.arbiscan.io/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) |
| Oracle address (NEAR MPC, path `base-1`) | [`0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`](https://sepolia.basescan.org/address/0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F) |
| NEAR owner and relayer | `psephex.testnet`, `relayer.psephex.testnet` (one function-call key per relayer process: `fulfill_on_evm`, `fulfill_on_near`) |

NEAR: fee 0.01 NEAR plus storage per question (`ask_deposit(question)` gives the exact amount, the rest is refunded), dispute minimum stake 0.01 NEAR. Base: fee 0.0001 ETH, dispute minimum stake 0.001 ETH. Questions up to 2000 bytes, dispute timeout 300 s. ABI: `contracts/base/ABI.md`.

The oracle address `0x3A91…e35F` is the same on every EVM chain: one NEAR account and one MPC path. Arbitrum dispute 1 was answered YES by the three models and delivered by it.

## Check a real answer yourself, without our servers

You need `near` (near-cli-rs), `cast` (Foundry) and `jq`.

**A question asked from NEAR.** Dispute 1 on `dispute.psephex.testnet` asked whether a logo delivered as a 1024x1024 PNG met a contract for at least 512x512; NEAR request 1 holds the verdict.

```bash
near contract call-function as-read-only oracle.psephex.testnet near_request json-args '{"request_id":1}' network-config testnet now
```
Expect `"answer": "YES"` and three votes. The verdict lives in the NEAR contract state.

```bash
curl -s 'https://psephex.xyz/api/requests/near/1/verify' | jq '.data.near.args' > verify-near-1.json
near contract call-function as-read-only oracle.psephex.testnet verify_consensus file-args verify-near-1.json network-config testnet now
```
Expect `"ok": true` and `"answer": "YES"`: the NEAR contract rebuilt the request for `near:testnet`, checked each model's signature against the keys registered on NEAR, and found two of three matching.

The signatures only mean something for the question NEAR stored, so check that the API handed over that question:

```bash
diff <(jq -r .question verify-near-1.json) <(near contract call-function as-read-only oracle.psephex.testnet near_request json-args '{"request_id":1}' network-config testnet now | jq -r .question) && echo same question
```

**A question asked from Base.** Request 11 on Base asked the same question.

```bash
curl -s 'https://psephex.xyz/api/requests/base/11/verify' | jq '.data.near.args' > verify-base-11.json
near contract call-function as-read-only oracle.psephex.testnet verify_consensus file-args verify-base-11.json network-config testnet now
```
Expect `"ok": true` and `"answer": "YES"` for chain `eip155:84532`.

```bash
jq -j .question verify-base-11.json | cast keccak
cast call 0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111 'getRequest(uint256)((address,bytes32,bool))' 11 --rpc-url https://sepolia.base.org
```
Expect the same hash `0xa50bcbbe…efe68` from both: the question the models answered is the one asked on Base, and `fulfilled` is `true`.

```bash
cast tx 0x427d1002f44249de44cd038d48a99d0236a08554192ada74b5c1218093107a6d from --rpc-url https://sepolia.base.org
```
Expect `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`: the answer was delivered by the MPC-derived address, which no person holds a key for.

The API only hands over the arguments; the check runs on the NEAR contract. Change one character of a `response_body` in either JSON file and run its `verify_consensus` again: it returns `"ok": false` with `invalid signature`. Swap the `chain` field between the two files and the signatures fail too: an answer signed for one source does not verify for another.

**The owner's hands are tied.** The oracle account has no keys, so code changes only through an announced upgrade:

```bash
near account list-keys oracle.psephex.testnet network-config testnet now
near contract call-function as-read-only oracle.psephex.testnet proposals json-args {} network-config testnet now
near contract call-function as-read-only oracle.psephex.testnet owner_delay_seconds json-args {} network-config testnet now
```
Expect no keys, `[]` or the open proposals with the time each may run (`ready_at_ns`), and `"86400"`. Every proposal also logs an `owner_change_proposed` event.

## Two agents settle a deal

A case runs on testnet between two agent accounts, `psephex-agent-buyer.testnet` and `psephex-agent-seller.testnet`:
1. the buyer agent opens a case on `psephex-court.testnet` ("the 100-row dataset I prepaid arrived with 60 rows") with its evidence and a stake;
2. the seller agent answers with its own evidence ("only 60 plants matched the filter");
3. the court writes the oracle question from both texts (`question_for`), three TEE models answer, NEAR checks two of three;
4. the appeal window runs; without an appeal anyone calls `finalize` and the stake goes by the verdict.

Agents can run a case themselves through the MCP server in `mcp/` (13 tools: open and answer cases, check a NEAR or x402 payment, verify a verdict, look up an agent's record). It is published on npm as [`@unitynodes/psephex-mcp`](https://www.npmjs.com/package/@unitynodes/psephex-mcp) and listed in the MCP Registry as `io.github.UnityNodes/psephex`; in Claude Code:

```bash
claude mcp add psephex -- npx -y @unitynodes/psephex-mcp
```

Without `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` it only reads; the stake caps and the other settings are in `mcp/README.md`. `mcp/examples/x402/` settles an x402 payment in wNEAR on NEAR testnet without a facilitator. `mcp/examples/llm-agents/` is an LLM agent on NEAR AI Cloud that drives the MCP server: in case 4 one such agent checked that payment and opened the case, a second one answered it, and the first verified the verdict, with no human in the loop: YES, 3 of 3, stake to the buyer.

## Try it in the browser

The dashboard at [psephex.xyz/app](https://psephex.xyz/app) (source in `web/`) is what a judge with a fresh wallet used in our end-to-end test:

1. Open [psephex.xyz/app](https://psephex.xyz/app) and choose "Open a dispute". NEAR testnet is the default and opens a court case: connect a NEAR testnet wallet (MyNearWallet, Meteor, HOT, HERE, Intear, NEAR Mobile, or an extension such as Sender, OKX, Bitget, Nightly, Coin98, Math or WELLDONE; test NEAR from the [faucet](https://near-faucet.io)). The form shows the stake, the oracle reserve and the storage before you sign.
2. Pick the example "Dataset short by 40 rows", enter the seller's account and open the case. The seller answers from its own wallet with "Send the response" within 120 s; if it stays silent, anyone sends the case on after the window. About 9 s later the page shows three signed ballots and the NEAR transaction that checked two of three.
3. After the 120 s appeal window, "Finalize and pay out" sends the stake by the verdict: YES or UNKNOWN to the claimant, NO to the seller. Either party can appeal to the arbiter before that.
4. For Base Sepolia or Arbitrum Sepolia, switch the chain and connect a browser wallet. That form opens a one-sided escrow dispute and needs 0.0011 ETH plus gas from the [Base faucets](https://docs.base.org/get-started/get-funds). "Logo delivered as specified" comes back YES in about 20 s through an MPC-signed transaction; "A matter of taste" comes back UNKNOWN and the page offers the refund button.
5. On any answered request, "Check it yourself" lists the commands above for that request.

The escrow examples were run ten times on every model before they went on the form.

## How it works

1. **The question is recorded.** From NEAR, a person or contract calls `oracle.psephex.testnet.ask(question, callback)` with a NEAR deposit; the contract stores the question and emits `asked`. From Base, a contract calls `AiOracle.ask(question)` with the fee; Base stores the question hash and emits `Asked`.
2. **Three models answer in TEEs.** The relayer asks the NEAR contract to build the exact request (temperature 0, fixed seed, the request id and the source inside the prompt: the NEAR contract account, or the AiOracle address and EVM chain id) and sends those bytes to each model. NEAR AI models sign `model:sha256(request):sha256(response)` with their own key; on Phala the attested Dstack gateway signs `sha256(request):sha256(response)`.
3. **NEAR checks two of three.** `fulfill_on_near` or `fulfill_on_evm` rebuilds the request, verifies every signature against the keys registered on NEAR and needs two matching answers. For a NEAR question it takes the question from its own state, so the relayer cannot change it.
4. **NEAR keeps the verdict, or MPC signs it for an EVM chain.** A NEAR question ends here: the verdict and votes are stored in the contract and `on_answer(request_id, answer)` is called on the asker when it asked for a callback; `dispute.psephex.testnet` pays out from that call. For Base the contract builds the EIP-1559 transaction and asks `v1.signer-prod.testnet` to sign it; the relayer only carries signed bytes.
5. **Base pays out.** `AiOracle.fulfill` accepts the answer only from the MPC address and only for the matching request id and question hash, then calls the asking contract. Both dispute contracts pay the claimant on YES, the counterparty on NO, and allow a refund on UNKNOWN or after the timeout.

The relayer (`relayer/`) is a crash-safe state machine over SQLite: killed with `kill -9` between steps it resumes without signing twice. The read-only API (`relayer/src/api/`) runs as a separate process with no keys.

## What a verdict proves, and what it does not

Proves:
- Each answer was signed inside a TEE by a key registered on NEAR and attested with a fresh nonce: the model's own key on NEAR AI, the gateway's key on Phala.
- At least two of the three signed answers agree, checked by the NEAR contract, not by our server.
- The models saw the request the NEAR contract built from the question asked on NEAR or on Base.
- Only the MPC-derived address can deliver the answer, and only for the matching id and question.
- Answers repeat in practice: 80 of 80 repeats matched in the first check, 90 of 90 for the dashboard examples on NEAR AI and 30 of 30 on Phala.
- The court's code cannot change: `psephex-court.testnet` has no access keys since its deploy.
- The oracle's rules cannot change under a case. Since 10 November `oracle.psephex.testnet` has no access keys, and a new model key, EVM target, reset of a settled request, higher gas cap or new code is announced on chain with `propose` and runs only 24 hours later, within a seven-day window. New code runs only if its sha256 was announced.

Does not prove:
- That the answer is right. In Base request 2 all three models said 9 is a prime number, and the oracle delivered that.
- That asking again is impossible. Temperature 0 and the seed make repeats match in practice, not cryptographically.
- Fully independent operators. Two models run on NEAR AI and one on Phala; on Phala one attested gateway signs for the model it routes to.
- Knowledge of fresh events. The evidence has to be in the question.
- Immutable oracle code. The owner `psephex.testnet` (key held offline by the author) can still replace the models or the code in the open, a day after announcing it, and the oracle code decides what the MPC network signs for Base and Arbitrum. The server only has function-call keys of `relayer.psephex.testnet` that can submit answers. `dispute.psephex.testnet`, the v1 example, still has a full-access key.
- Fixed court parameters. The court owner `psephex.testnet` can change the stake minimum, the appeal bond and the response, appeal and arbitration windows with immediate effect, and a case reads them when it enters each stage. The court has no keys, so its code cannot change.
- A fixed model set. Qwen3.8 27B answered Base requests 1 to 10 and was replaced by Gemma on 2026-11-09; `verify_consensus` checks the current set, so those requests are verified by their NEAR and Base transactions.

Intel's DCAP signature chain on the TDX quotes was not verified by us; we checked that each quote's report data holds the signing key and our nonce.

## Run it yourself

From the repository root:

The deployed oracle wasm (sha256 `0f390e19…`) rebuilds from this tree with cargo-near 0.22.0 and rustc 1.96.0:

```bash
(cd contracts/near && cargo near build non-reproducible-wasm --locked && sha256sum target/near/near_oracle.wasm)
```

```bash
(cd contracts/near && cargo test --locked)
```
```bash
(cd contracts/near-dispute && cargo test --locked)
```
```bash
(cd contracts/near-court && cargo test --locked)
```
```bash
(cd contracts/base && forge test)
```
```bash
(cd relayer && npm ci && npm test)
```
```bash
(cd web && npm ci && npm test)
```
```bash
(cd mcp && npm ci && npm test)
```

The relayer needs a NEAR function-call key, a NEAR AI key and a Phala (RedPill) key; the API needs none. Their variables are listed in `.env.example` and read in `relayer/src/config.ts`. The relayer runs with `node relayer/dist/main.js`, the API with `node relayer/dist/api/main.js`; the dashboard build needs `VITE_API_URL` and the fonts from `scripts/fetch-fonts.sh`.

## Repository

```
contracts/near   NEAR oracle contract (Rust, near-sdk)
contracts/near-court     NEAR court for agent deals: both sides' evidence, appeal, arbiter
contracts/near-dispute   NEAR one-sided escrow example (v1)
contracts/base   AiOracle, Dispute and the YesNoClient example (Solidity, Foundry)
relayer          relayer state machine and the read-only API (TypeScript)
web              landing and dashboard (Vite, React, wagmi)
mcp              MCP server for agents, with the x402 and LLM agent examples
docs-site        documentation at docs.psephex.xyz (VitePress)
```

## Built during the hackathon, libraries and AI

The earliest work on Psephex is the prototype tested on 07 and 08 November 2026, moved into this repository on 08 November (commit `a1e4cef`). Everything else was built from 08 to 11 November; the git history is the record.

Libraries: near-sdk 5.30.1 and omni-transaction 0.5.0 (NEAR contract); forge-std (Base tests); near-api-js 7.4.0, viem 2.57.16, better-sqlite3 13.0.3, pino 10.4.0, Fastify 5.12.8 and @fastify/rate-limit 11.2.1 (relayer and API); React 19.3.1, wagmi 3.7.9, @near-wallet-selector 10.1.4 (MyNearWallet, Meteor, HOT, HERE, Intear, NEAR Mobile, Bitget, Nightly, Sender, OKX, Coin98, Math, WELLDONE), TanStack Query 5.104.5, react-router 8.5.0, zod 4.6.7 and Tailwind 4.3.3 (web); @modelcontextprotocol/sdk 1.32.2 (MCP server); VitePress 1.6.4 (docs). Models: NEAR AI Cloud and Phala Confidential AI through RedPill.

AI assistance: the code, tests and documentation in this repository were written with Claude Code.

## Tracks

Open, Agents and Security: an open primitive on NEAR that also serves EVM chains, AI models acting as verifiable judges for contracts, and a design whose trust rests on TEE attestation, a 2-of-3 rule enforced on chain and MPC signing instead of a server key.

## Other project by the author

[NEARpedia](https://near-pedia.xyz) ([repository](https://github.com/UnityNodes/near-pedia)): live NEAR knowledge for AI agents, an MCP server and API that tells a coding agent when the NEAR code it is about to write is stale.

## License

MIT, see `LICENSE`.
