---
description: "Ask the Psephex oracle from Solidity on Base Sepolia or Arbitrum Sepolia and receive the answer through NEAR Chain Signatures."
---

# Ask from Base or Arbitrum

Contracts on Base Sepolia and Arbitrum Sepolia ask the same oracle through `AiOracle`. The question is answered by the three models and checked on NEAR, and the NEAR contract signs the delivery transaction through NEAR Chain Signatures. There is no bridge and no oracle key on a server.

| | Base Sepolia (84532) | Arbitrum Sepolia (421614) |
|---|---|---|
| AiOracle | [`0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111`](https://sepolia.basescan.org/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111) | [`0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111`](https://sepolia.arbiscan.io/address/0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111) |
| Dispute (escrow example) | [`0xCa744C595A6C2EE470257D2B873aEd2b1a78E092`](https://sepolia.basescan.org/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) | [`0xCa744C595A6C2EE470257D2B873aEd2b1a78E092`](https://sepolia.arbiscan.io/address/0xCa744C595A6C2EE470257D2B873aEd2b1a78E092) |
| Oracle address (delivers answers) | `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F` | `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F` |
| Fee | 0.0001 ETH | 0.0001 ETH |

The oracle address is derived from the MPC key of `oracle.psephex.testnet` with the path `base-1`, so it is the same on every EVM chain. No person holds a key for it.

## The interface

```solidity
interface IAiOracle {
    function ask(string calldata question) external payable returns (uint256 id);
    function getRequest(uint256 id) external view returns (Request memory);
    function fee() external view returns (uint256);
    function lastId() external view returns (uint256);
}

interface IAiOracleClient {
    function onAnswer(uint256 id, uint8 answer) external;
}
```

- `ask` reverts with `InsufficientFee` below `fee()` and with `QuestionTooLong` above 2000 bytes. It keeps the whole `msg.value`, so send exactly `fee()`.
- `onAnswer` gets `0` for UNKNOWN, `1` for YES and `2` for NO.
- AiOracle calls `onAnswer` with up to 200,000 gas (`callbackGasLimit`). A reverting `onAnswer` does not block delivery: AiOracle marks the request fulfilled and emits `CallbackFailed(id)`.
- `getRequest(id)` returns `(requester, questionHash, fulfilled)`. `questionHash` is keccak256 of the question bytes.

## A minimal client

`YesNoClient.sol` is the contract the test suite runs against AiOracle:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient} from "../IAiOracle.sol";

contract YesNoClient is IAiOracleClient {
    IAiOracle public immutable oracle;

    event Answered(uint256 indexed id, uint8 answer);

    error OnlyOracle();

    constructor(IAiOracle oracle_) {
        oracle = oracle_;
    }

    function ask(string calldata question) external payable returns (uint256) {
        return oracle.ask{value: msg.value}(question);
    }

    function onAnswer(uint256 id, uint8 answer) external {
        if (msg.sender != address(oracle)) revert OnlyOracle();
        emit Answered(id, answer);
    }
}
```

Always check `msg.sender` in `onAnswer`: only AiOracle may call it.

## Try it with cast

Read the fee, then ask from an account with Base Sepolia ETH (faucets: [docs.base.org](https://docs.base.org/get-started/get-funds)):

```bash
cast call 0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111 'fee()(uint256)' --rpc-url https://sepolia.base.org
```

```bash
cast send 0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111 'ask(string)' 'Is 7 a prime number?' --value 100000000000000 --rpc-url https://sepolia.base.org --account your-keystore
```

`--account your-keystore` is a Foundry keystore name; use your own. A plain account (not a contract) gets no callback; read the result with `getRequest` and the `Fulfilled` event:

```bash
cast call 0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111 'getRequest(uint256)((address,bytes32,bool))' 11 --rpc-url https://sepolia.base.org
```

For Arbitrum Sepolia, use `--rpc-url https://sepolia-rollup.arbitrum.io/rpc`.

## The escrow example

`Dispute` is a one-sided escrow built on AiOracle. `openDispute(question, counterparty, maxFee)` forwards exactly the oracle fee and keeps the rest of `msg.value` as the stake (at least 0.001 ETH). YES pays the claimant, NO pays the counterparty. On UNKNOWN, or after the 300-second timeout without an answer, anyone can call `refund(id)` and the stake goes back to the claimant.

In this example the claimant writes the whole question. That is why agent deals go through the [NEAR court](/build/court), where both sides file evidence and the contract writes the question.

## Events

| Event | When |
|---|---|
| `Asked(uint256 indexed id, address indexed requester, string question, bytes32 questionHash, uint256 paid)` | a question is recorded |
| `Fulfilled(uint256 indexed id, uint8 answer)` | the answer is delivered |
| `CallbackFailed(uint256 indexed id)` | the asker's `onAnswer` reverted |

The full ABI, selectors, topics and error selectors are in [`contracts/base/ABI.md`](https://github.com/UnityNodes/psephex/blob/main/contracts/base/ABI.md).
