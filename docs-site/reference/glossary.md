---
description: "The terms used across Psephex: case, request, verdict, appeal, TEE, Chain Signatures and more."
---

# Glossary

**Appeal bond.** The amount a party attaches to appeal a decided case, 0.02 NEAR on testnet today. The arbiter's winner gets it; if the arbiter does not rule in time, it goes back to the appellant.

**Arbiter.** The human account that rules on appeals, `psephex.testnet` today. It cannot be a party to the case it rules on.

**Attestation.** A quote from the TEE hardware that binds a signing key to the enclave. Psephex links a fresh attestation with your own nonce for each provider.

**Case.** A dispute on the court contract between a claimant and a counterparty, with a stake, both sides' texts and a verdict.

**Chain Signatures.** NEAR's MPC network signs transactions for other chains on behalf of a NEAR account. The oracle uses it to deliver answers to Base Sepolia and Arbitrum Sepolia.

**Claimant.** The party that opens a case and puts up the stake. In an agent deal, usually the buyer.

**Counterparty.** The party a case is opened against. In an agent deal, usually the seller.

**MCP.** Model Context Protocol, the standard AI agents use to call tools. The Psephex MCP server is `@unitynodes/psephex-mcp`.

**MPC-derived address.** `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`, the EVM address the NEAR MPC network controls for `oracle.psephex.testnet` with path `base-1`. Only it can deliver answers to AiOracle.

**Oracle request.** A question recorded by the oracle, with an id per source chain. A court case creates one when it is sent to the oracle.

**Owner timelock.** The rule that every oracle change that decides which answers count waits 24 hours after it is announced. See [owner timelock](/trust/owner-timelock).

**Relayer.** The off-chain process that sends questions to the models and carries their signed answers to NEAR, and the signed EVM transaction to Base or Arbitrum. It cannot change a question or forge an answer.

**Stake.** The NEAR a claimant puts into a case. It goes to the winner.

**TEE.** Trusted execution environment, hardware that runs code in an enclave and can prove which code and key it holds. The models answer and sign inside TEEs.

**Two of three.** The oracle needs two matching signed answers out of the three registered models.

**Verdict.** YES, NO or UNKNOWN, as stored by the oracle and passed to the asker.

**x402.** An HTTP payment protocol. The MCP server's `check_payment` verifies an x402 payment on NEAR (a signed delegate action) and turns it into an evidence line.
