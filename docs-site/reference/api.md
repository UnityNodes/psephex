---
description: "Endpoints, fields and limits of the read-only Psephex API at psephex.xyz/api."
---

# Read-only API

Base URL: `https://psephex.xyz/api`

The API is a convenience for dashboards and agents. It runs as a separate process with no keys and only serves data the relayer recorded and the chains report. It never decides anything: to check a verdict, take the arguments it hands out and run the check on the NEAR contract, as in [verify a verdict yourself](/trust/verify).

All endpoints are `GET` and return JSON.

## Response shape

A successful response has a `data` field, and some have `meta`:

```json
{ "data": { }, "meta": { } }
```

An error has an `error` object with a machine-readable `code` and a message:

```json
{ "error": { "code": "not_found", "message": "request near/999 not found" } }
```

| HTTP status | `code` | When |
|---|---|---|
| 400 | `bad_request` | a parameter does not match its pattern, or a cursor this API did not issue |
| 404 | `not_found` | unknown route or request |
| 429 | `rate_limited` | over the rate limit |
| 503 | `unavailable` | the chain data behind `/models` could not be read |
| 500 | `internal` | anything else |

## Limits

- 120 requests per minute per client. IPv4 clients are counted per address, IPv6 clients per /64. The `x-ratelimit-limit`, `x-ratelimit-remaining` and `x-ratelimit-reset` headers show where you stand.
- Responses carry `cache-control: no-store`.

## Endpoints

### `GET /health`

The relayer queue by status and, for each source chain, how far the relayer has scanned, the chain head and lag, the oracle address and its balance.

```bash
curl -s https://psephex.xyz/api/health
```

### `GET /chains`

The chains Psephex serves: `base` (Base Sepolia), `arbitrum` (Arbitrum Sepolia) and `near` (NEAR testnet), with their chain id, explorer and contract addresses.

### `GET /requests`

Requests from all chains, newest first.

| Query | Values | Default |
|---|---|---|
| `limit` | 1 to 100 | 20 |
| `cursor` | the `meta.nextCursor` of the previous page | |
| `status` | `seen`, `answering`, `verified`, `near_sent`, `near_signed`, `base_sent`, `confirmed`, `rejected`, `failed` | all |
| `source` | `base`, `arbitrum`, `near` | all |

```bash
curl -s 'https://psephex.xyz/api/requests?limit=5&status=confirmed'
```

Each item has `source`, `chain`, `id`, a shortened `question`, `answer`, `status`, `reason`, `requester`, `createdAt` and `updatedAt`. `meta.nextCursor` is `null` on the last page.

### `GET /requests/{source}/{id}`

One request in full: the question and its hash, the asking transaction, the status, the answer and each model's vote, the NEAR transactions and, for EVM sources, the delivery transaction.

```bash
curl -s https://psephex.xyz/api/requests/near/1
```

### `GET /requests/{source}/{id}/verify`

The exact arguments for `verify_consensus` on `oracle.psephex.testnet`: the chain, the request id, the question and every model's signed response. `data.near` names the contract, method and network; `data.near.args` is the JSON to pass. `data.steps` lists the commands to run.

```bash
curl -s https://psephex.xyz/api/requests/base/11/verify | jq '.data.near.args' > verify-base-11.json
```

### `GET /models`

The registered models with provider, signature scheme, public key and a link to fetch a fresh TEE attestation. `meta.checkedAt` says when the API last read them from the oracle contract.

### `GET /stats`

Totals: requests by status and by source, YES, NO and UNKNOWN counts and shares, and the average time from the relayer seeing a question to its answer on chain.

## Legacy routes

`/requests/{id}` and `/requests/{id}/verify` without a source still work and mean `base`.
