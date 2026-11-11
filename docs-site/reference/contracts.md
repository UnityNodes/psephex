# Contracts and addresses

Everything is on testnets. There is no mainnet deployment.

## NEAR testnet

| Contract | Account | Role |
|---|---|---|
| Oracle | [`oracle.psephex.testnet`](https://testnet.nearblocks.io/address/oracle.psephex.testnet) | `ask`, `fulfill_on_near`, `verify_consensus`, Chain Signatures for EVM. Version 4, wasm sha256 `0f390e19dabc15810397fa4500588dc10a975716e33fcba3261c48560e8ba4ee`. No access keys; owner changes only through [`propose` with a 24-hour delay](/trust/owner-timelock). |
| Court | [`psephex-court.testnet`](https://testnet.nearblocks.io/address/psephex-court.testnet) | agent deals: both sides' evidence, appeal, arbiter. No access keys since its deploy. |
| Dispute v1 | [`dispute.psephex.testnet`](https://testnet.nearblocks.io/address/dispute.psephex.testnet) | one-sided escrow example; stake in NEAR, verdict through `on_answer`. |
| Owner and arbiter | `psephex.testnet` | owner of the oracle and the court, arbiter of the court. Key held offline. |
| Relayer | `relayer.psephex.testnet` | submits answers with function-call keys limited to `fulfill_on_evm` and `fulfill_on_near`. |
| MPC signer | `v1.signer-prod.testnet` | NEAR Chain Signatures; signs EVM deliveries for the oracle with path `base-1`. |

## Base Sepolia (chain id 84532)

| Contract | Address |
|---|---|
| AiOracle | [`0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111`](https://sepolia.basescan.org/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111) |
| Dispute (escrow example) | [`0xCa744C595A6C2EE470257D2B873aEd2b1a78E092`](https://sepolia.basescan.org/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) |
| Oracle address (MPC, path `base-1`) | [`0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`](https://sepolia.basescan.org/address/0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F) |

## Arbitrum Sepolia (chain id 421614)

| Contract | Address |
|---|---|
| AiOracle | [`0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111`](https://sepolia.arbiscan.io/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111) |
| Dispute (escrow example) | [`0xCa744C595A6C2EE470257D2B873aEd2b1a78E092`](https://sepolia.arbiscan.io/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) |
| Oracle address (MPC, path `base-1`) | [`0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`](https://sepolia.arbiscan.io/address/0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F) |

## Fees and limits

| | NEAR | Base Sepolia and Arbitrum Sepolia |
|---|---|---|
| Oracle fee | 0.01 NEAR plus storage; `ask_deposit(question)` gives the exact amount and the rest is refunded | 0.0001 ETH |
| Question length | up to 2000 bytes | up to 2000 bytes |
| Court minimum stake | 0.01 NEAR | |
| Court appeal bond | 0.02 NEAR | |
| Court party texts | 400 bytes each, quoted, one line | |
| Dispute example minimum stake | 0.01 NEAR | 0.001 ETH |
| Dispute example timeout | | 300 s |

Read current values from the contracts: `config` on `oracle.psephex.testnet` and `psephex-court.testnet`, `fee()` on AiOracle, `minStake()` and `timeout()` on Dispute.

## Measured on testnet

- Answer time: 17.5 to 21.1 seconds from the relayer seeing a question to the answer on Base (requests 10 to 13); about 13 seconds for a NEAR question.
- Cost per Base question: about 16 Tgas on NEAR and 67k to 107k gas on Base.
