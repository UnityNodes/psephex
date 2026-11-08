# AiOracle on Base: ABI facts

All values below were produced by `cast` 1.7.1 / `forge inspect` against the compiled artifacts in `out/` (solc 0.8.28, evm_version cancun, optimizer 200 runs).

## Chain: Base Sepolia

| Fact | Value |
|---|---|
| chainId | 84532 (0x14a34) |
| RPC | https://sepolia.base.org |
| Explorer | https://sepolia.basescan.org |
| Tx type used by the NEAR side | EIP-1559 (type 0x02), same as `rwa-spike` `TransactionBuilder::new::<EVM>()` |
| Native token | ETH (18 decimals) |

`cast chain-id --rpc-url https://sepolia.base.org` returned `84532`.

## fulfill(uint256,uint8,bytes32)

```
cast sig "fulfill(uint256,uint8,bytes32)"
0x3b3b458b
```

ABI layout of the calldata (100 bytes total):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | selector `3b3b458b` |
| 4 | 32 | `id` (uint256, big-endian, left-padded) |
| 36 | 32 | `answer` (uint8 in a 32-byte word, left-padded; valid values 0 UNKNOWN, 1 YES, 2 NO) |
| 68 | 32 | `questionHash` (bytes32, raw) |

### Example: id = 7, answer = 1 (YES), questionHash = keccak256("hello")

```
cast keccak "hello"
0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8

cast calldata "fulfill(uint256,uint8,bytes32)" 7 1 0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8
0x3b3b458b000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000011c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8
```

Split by word:

```
3b3b458b
0000000000000000000000000000000000000000000000000000000000000007
0000000000000000000000000000000000000000000000000000000000000001
1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8
```

Round-trip check:

```
cast calldata-decode "fulfill(uint256,uint8,bytes32)" 0x3b3b458b...deac8
7
1
0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8
```

How the NEAR contract should build it (mirrors `mint_calldata` in `rwa-spike/contract/src/lib.rs`): `[0x3b,0x3b,0x45,0x8b]` ++ `[0u8;24]` ++ `id.to_be_bytes()` (u64) ++ `[0u8;31]` ++ `[answer]` ++ `question_hash` (32 bytes from `env::keccak256_array(question.as_bytes())`). The `to` of the EVM tx is the deployed AiOracle address, `value` is 0, `chain_id` is 84532.

## Other selectors

### AiOracle

| Method | Selector |
|---|---|
| ask(string) | 0x189bf94f |
| fulfill(uint256,uint8,bytes32) | 0x3b3b458b |
| getRequest(uint256) | 0xc58343ef |
| setOracle(address) | 0x7adbf973 |
| setCallbackGasLimit(uint256) | 0x8a54942f |
| transferOwnership(address) | 0xf2fde38b |
| withdraw(address) | 0x51cff8d9 |
| oracle() | 0x7dc0d1d0 |
| owner() | 0x8da5cb5b |
| lastId() | 0xc1292cc3 |
| callbackGasLimit() | 0x24f74697 |
| DEFAULT_CALLBACK_GAS_LIMIT() | 0xda41ed9b |

### Dispute

| Method | Selector |
|---|---|
| openDispute(string,address) | 0x6e2da25a |
| onAnswer(uint256,uint8) | 0xf3daa7e0 |
| getCase(uint256) | 0xa91a1080 |
| oracle() | 0x7dc0d1d0 |
| refund(uint256) | 0x278ecde1 |
| timeout() | 0x70dea79a |

Constructor: `Dispute(address oracle, uint64 timeout)`. `getCase` returns `(claimant, counterparty, amount, deadline, escalated, settled)`. `refund(id)` returns the stake to the claimant if the case is escalated, or after `deadline` if nobody settled it.

Example `ask("hello")` calldata:

```
cast calldata "ask(string)" "hello"
0x189bf94f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000568656c6c6f000000000000000000000000000000000000000000000000000000
```

## Event topics (topic0)

The NEAR-side relayer / off-chain worker should subscribe to `Asked` on the AiOracle address and respond with `fulfill`.

| Event | topic0 |
|---|---|
| Asked(uint256 indexed id, address indexed requester, string question, bytes32 questionHash) | 0x7ef94cb85a9127da7adca3d157c365f707a072a37f1c634a476c521597325ac3 |
| Fulfilled(uint256 indexed id, uint8 answer) | 0xbbd121bb1d7c2e919e1f054479311e2638ce707f353ac8642319b45098c91d8f |
| CallbackFailed(uint256 indexed id) | 0xb2298745cb84651776b988443c22ab136d5d245a655462194e833357e68867f1 |
| OracleUpdated(address indexed, address indexed) | 0x078c3b417dadf69374a59793b829c52001247130433427049317bde56607b1b7 |
| OwnershipTransferred(address indexed, address indexed) | 0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0 |
| Withdrawn(address indexed, uint256) | 0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5 |
| CallbackGasLimitUpdated(uint256,uint256) | 0xa75f3b6c7f4685633f86b8417c3c666119c9d8c345b265b79b67d7b78056968e |
| Dispute.DisputeOpened(uint256 indexed, address indexed, address indexed, uint256, string) | 0x930e78761b7153629243ab522037c4d8b6390b0f30bf9cf23f7d21f17fe708b3 |
| Dispute.Settled(uint256 indexed, address indexed, uint256) | 0x2c35d68fdf40b18e913bb877373b4a4fc67810e2546dc5c9f9208eb8494057cb |
| Dispute.Escalated(uint256 indexed) | 0x0aab8efa085ec970c8d803cf845ef6413da29ec3140ca5c4d6e87be1caca16df |
| Dispute.Refunded(uint256 indexed, address indexed, uint256) | 0x7ca5472b7ea78c2c0141c5a12ee6d170cf4ce8ed06be3d22c8252ddfc7a6a2c4 |

In `Asked`, topic1 = id, topic2 = requester (left-padded), and the data section ABI-encodes `(string question, bytes32 questionHash)`.

## Custom error selectors

| Error | Selector |
|---|---|
| AiOracle.OnlyOwner() | 0x5fc483c5 |
| AiOracle.OnlyOracle() | 0x80fee105 |
| AiOracle.ZeroAddress() | 0xd92e233d |
| AiOracle.UnknownRequest(uint256) | 0x1f79bbe7 |
| AiOracle.AlreadyFulfilled(uint256) | 0xdd6ac7a6 |
| AiOracle.QuestionHashMismatch(bytes32 expected, bytes32 provided) | 0xbc2bcd8d |
| AiOracle.InvalidAnswer(uint8) | 0x8dcf80a9 |
| AiOracle.WithdrawFailed() | 0x750b219c |
| Dispute.OnlyOracle() | 0x80fee105 |
| Dispute.ZeroAddress() | 0xd92e233d |
| Dispute.NoStake() | 0xcacf989a |
| Dispute.UnknownDispute(uint256) | 0x8f09a29b |
| Dispute.AlreadySettled(uint256) | 0x8fec535e |
| Dispute.PayoutFailed(address,uint256) | 0xe3e92735 |
| Dispute.TooEarly(uint256,uint64) | 0x45936d77 |
| Dispute.ZeroTimeout() | 0xb077b20b |

## Answer encoding

| Value | Meaning | Dispute behaviour |
|---|---|---|
| 0 | UNKNOWN | `Escalated(id)` emitted, case marked escalated; anyone may call `refund(id)` at once and the stake returns to the claimant |
| 1 | YES | pays `claimant` |
| 2 | NO | pays `counterparty` |
| 3..255 | invalid | `fulfill` reverts `InvalidAnswer(answer)` |

## Full JSON ABI

`forge inspect AiOracle abi --json` and `forge inspect Dispute abi --json` from the `base/` directory, or read `out/AiOracle.sol/AiOracle.json` / `out/Dispute.sol/Dispute.json` (`.abi` field).

## Deploy (not executed)

```
ORACLE_ADDRESS=0x... OWNER_ADDRESS=0x... forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --account <keystore>
AI_ORACLE_ADDRESS=0x... DISPUTE_TIMEOUT=86400 forge script script/DeployDispute.s.sol:DeployDispute --rpc-url base_sepolia --broadcast --account <keystore>
```

`ORACLE_ADDRESS` must be the EVM address derived from the NEAR contract's MPC key (`node verify.mjs address <near-contract-id>` in `rwa-spike/scripts`), since `fulfill` requires `msg.sender == oracle`.
