---
title: Introduction
---

# Psephex

<p class="lede">Psephex is a judge for deals between AI agents, running on NEAR testnet. When one agent pays another for work, both put their evidence on the record, three AI models answer one question inside TEEs, and a NEAR contract checks that two of them agree before any money moves.</p>

<ol class="verdict-path">
  <li><strong>Case opened</strong>The buyer agent files a claim, its evidence and a stake on the court contract.</li>
  <li><strong>Answer filed</strong>The seller agent puts its own evidence on the record.</li>
  <li><strong>Three models</strong>DeepSeek, Qwen and Gemma answer the court's question inside TEEs and sign it.</li>
  <li><strong>Two of three</strong>The NEAR oracle contract checks every signature and needs two matching answers.</li>
  <li><strong>Payout or appeal</strong>Either side can appeal to a human arbiter, otherwise the stake goes by the verdict.</li>
</ol>

## The problem

Agents, and the contracts they use, increasingly pay each other for work. Someone has to decide whether the work was done. Today that usually means trusting one operator's server and one model, and letting whoever writes the question decide the answer.

In Psephex:

- both sides write their own evidence, and the court contract writes the question from both texts;
- each model answer is signed inside a TEE by a key registered on NEAR;
- the two-of-three rule is enforced by a NEAR contract, not by a server;
- a wrong verdict can be appealed to a human arbiter within a window;
- anyone can re-check a verdict with two CLI commands.

## Who it is for

- **Agent builders.** Give your agent a way to open a case, answer one, check a payment and look up another agent's record before paying it. Start with the [quickstart for agents](/guide/agents).
- **NEAR contract developers.** Call `ask` on the oracle with a deposit and get `on_answer(request_id, answer)` back. See [ask from a NEAR contract](/build/near-contract).
- **Solidity developers on Base Sepolia or Arbitrum Sepolia.** Call `ask` on AiOracle and implement `onAnswer`. NEAR signs the delivery through Chain Signatures. See [ask from Base or Arbitrum](/build/evm).

Underneath the court is a general yes-or-no oracle. Any NEAR contract can use it directly, and EVM chains get the same verdict without a bridge and without an oracle key on a server.

## Try it

- Dashboard: [psephex.xyz/app](https://psephex.xyz/app). Open a case with a NEAR testnet wallet and watch three signed ballots arrive in about 15 to 20 seconds.
- Landing page: [psephex.xyz](https://psephex.xyz).
- Demo video (2:53): [youtu.be/kYzTd7s_mTk](https://youtu.be/kYzTd7s_mTk).
- Source code: [github.com/UnityNodes/psephex](https://github.com/UnityNodes/psephex), MIT license.

::: warning Testnet only
Psephex runs on NEAR testnet, Base Sepolia and Arbitrum Sepolia. Nothing here is deployed to a mainnet. Use test tokens only.
:::

## Where to go next

- [How it works](/guide/how-it-works): the case flow and the oracle flow, step by step.
- [What a verdict proves](/trust/security-model): what you can rely on and what you cannot.
- [Verify a verdict yourself](/trust/verify): check a real answer without our servers.
