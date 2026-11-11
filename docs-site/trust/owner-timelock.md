# Owner timelock

Since 10 November 2026 the oracle account `oracle.psephex.testnet` has no access keys. The owner, `psephex.testnet`, cannot sign as the oracle or deploy code to it directly. Every change that decides which answers count is announced on chain first and applies only after a delay, so a party with a case in flight sees it coming and can leave before it applies.

## The rules

- **Delay:** 24 hours (`owner_delay_seconds` returns `"86400"`). The delay itself can only be changed through the same process, and must stay between 60 seconds and 30 days.
- **Execution window:** a proposal can run for seven days after its delay passes. After that it expires and has to be announced again, so an old announcement cannot be pulled out later.
- **At most 16 open proposals** at a time.
- **Only the owner** can propose, cancel or execute.

## What waits for the delay

| Action (`kind`) | What it changes |
|---|---|
| `set_model_key` | adds or replaces a model and its signing key |
| `remove_model_key` | removes a model |
| `set_chain` | adds or changes an EVM chain and its AiOracle address |
| `remove_chain` | removes an EVM chain |
| `reset_fulfilled` | lets an already settled EVM request be delivered again |
| `set_owner_delay` | changes the delay |
| `set_max_fee_per_gas_cap` | raises the gas price cap for EVM deliveries |
| `upgrade` | deploys new contract code with a given sha256 |

## What stays immediate

Changing the relayer list, changing the NEAR fee and lowering the gas cap. None of these can change a verdict.

## How an upgrade runs

1. The owner calls `propose` with `{"kind":"upgrade","code_sha256":"…","migrate_args":"{…}"}`. Only one open upgrade per code hash is allowed.
2. After 24 hours, the owner calls `execute_upgrade` with the raw wasm as the call input. The contract hashes it and runs only if the sha256 matches an announced, unexpired upgrade.
3. The deploy and the `migrate` call with the announced arguments run as one batch on the oracle account. If `migrate` fails, the deploy rolls back and the old code keeps answering.
4. Both `execute_upgrade` and `migrate` refuse while an MPC signature for an EVM delivery is in flight.

The other actions run with `execute(proposal_id)` after the delay. `cancel(proposal_id)` withdraws a proposal at any time.

## Watch for announced changes

List open proposals, with when each may run and when it expires:

```bash
near contract call-function as-read-only oracle.psephex.testnet proposals json-args {} network-config testnet now
```

Each entry has `id`, `action`, `proposed_at_ns`, `ready_at_ns`, `expires_at_ns`, `ready` and `expired`. Timestamps are nanoseconds since the Unix epoch.

Read the delay:

```bash
near contract call-function as-read-only oracle.psephex.testnet owner_delay_seconds json-args {} network-config testnet now
```

Confirm the oracle account has no keys:

```bash
near account list-keys oracle.psephex.testnet network-config testnet now
```

Every proposal also logs an NEP-297 event with standard `psephex`: `owner_change_proposed` with the id, the action and `ready_at_ns`; `owner_change_executed` when it runs; and `owner_change_cancelled` when it is withdrawn. An indexer or an agent can watch the oracle account for these events.

`config` on the oracle also reports `owner_delay_seconds` and `open_proposals`.

## Rehearsed on staging

The upgrade path was rehearsed on a staging copy before the live migration: an `execute` before the delay was refused, a stranger's `propose` was refused, an upgrade with a failing `migrate` rolled back atomically, and an upgrade on an account with no keys succeeded. The live oracle moved to this code with transaction `GrxDuewmr8b61NRMLkLT1JuMkbXzLcCDbq7K7hufUReY`, and its last key was deleted in `Gwrma3brLAAQx8kVKhferMdh5gQt14yAnTU6iZL6jHLb`.
