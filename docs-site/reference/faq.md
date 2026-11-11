---
description: "Short answers about Psephex: timing, cost, models, appeals, trust and what runs on testnet."
---

# FAQ

## Is this on mainnet?

No. Psephex runs on NEAR testnet, Base Sepolia and Arbitrum Sepolia only. Use test tokens.

## How long does a verdict take?

About 9 seconds for a question asked on NEAR, and 17.5 to 21.1 seconds for one asked on Base, measured from the relayer seeing the question to the answer on chain. A court case also waits for the response window before the question is asked, and for the appeal window before the payout.

## What does it cost?

On NEAR, 0.01 NEAR plus storage per question; `ask_deposit(question)` gives the exact amount. A court case adds the stake (at least 0.01 NEAR) and storage for the case record. On Base Sepolia and Arbitrum Sepolia, 0.0001 ETH per question plus gas.

## Who writes the question in a court case?

The court contract. It quotes the claim, the evidence and the response word for word and adds fixed wording around them. Read it with `question_for(case_id)` before the models do.

## What if the models are wrong?

Either party can appeal within the appeal window by attaching the case's appeal bond. A human arbiter then rules. See [what a verdict proves](/trust/security-model) for the limits of the models.

## What if the other side never answers?

After the response window anyone can call `submit`. The question then states that there was no response, and the models decide on the claimant's evidence alone.

## What if the oracle never answers?

After the answer timeout, anyone can call `refund` on the court and the stake goes back to the claimant.

## What does UNKNOWN mean?

At least two models answered UNKNOWN, or no answer got two votes. The court pays UNKNOWN to the claimant. The EVM escrow example lets anyone refund the claimant at once.

## Can the operator change the rules in the middle of my case?

Not without warning. The oracle account has no keys, and every change to the models, the EVM targets, settled requests, the gas cap or the code waits 24 hours after it is announced on chain. See [owner timelock](/trust/owner-timelock). The court's code cannot change at all; its owner can change the windows, stake, bond and arbiter, and a live appeal keeps the arbiter it was filed under.

## Do I need your API?

No. Everything the API serves can be read from the contracts and the chains. The API is there to make dashboards and the verification commands easier.

## Can my agent use it without writing code?

Yes. Add the [MCP server](/guide/agents) to Claude Code, Claude Desktop or any MCP client: `npx -y @unitynodes/psephex-mcp`.

## Where is the source?

[github.com/UnityNodes/psephex](https://github.com/UnityNodes/psephex), MIT license. Contracts, relayer, API, dashboard and the MCP server are all there with their tests.
