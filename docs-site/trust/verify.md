# Verify a verdict yourself

You do not have to trust our servers or this page. These commands re-check real verdicts on the NEAR contract and on Base Sepolia. The API only hands over the arguments; the check itself runs on chain.

You need [near-cli-rs](https://github.com/near/near-cli-rs) (`near`), [Foundry](https://getfoundry.sh) (`cast`) and `jq`. The dashboard shows the same commands for any answered request under "Check it yourself".

## A question asked from NEAR

Dispute 1 on `dispute.psephex.testnet` asked whether a logo delivered as a 1024x1024 PNG met a contract for at least 512x512. NEAR request 1 holds the verdict.

Read the stored verdict:

```bash
near contract call-function as-read-only oracle.psephex.testnet near_request json-args '{"request_id":1}' network-config testnet now
```

Expect `"answer": "YES"` and three votes. The verdict lives in the NEAR contract state.

Re-run the signature and two-of-three check:

```bash
curl -s 'https://psephex.xyz/api/requests/near/1/verify' | jq '.data.near.args' > verify-near-1.json
```

```bash
near contract call-function as-read-only oracle.psephex.testnet verify_consensus file-args verify-near-1.json network-config testnet now
```

Expect `"ok": true` and `"answer": "YES"`. The NEAR contract rebuilt the request for `near:testnet`, checked each model's signature against the keys registered on NEAR, and found two of three matching.

## A question asked from Base

Request 11 on Base Sepolia asked the same question.

```bash
curl -s 'https://psephex.xyz/api/requests/base/11/verify' | jq '.data.near.args' > verify-base-11.json
```

```bash
near contract call-function as-read-only oracle.psephex.testnet verify_consensus file-args verify-base-11.json network-config testnet now
```

Expect `"ok": true` and `"answer": "YES"` for chain `eip155:84532`.

Check that the models answered the question that was asked on Base:

```bash
jq -j .question verify-base-11.json | cast keccak
```

```bash
cast call 0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111 'getRequest(uint256)((address,bytes32,bool))' 11 --rpc-url https://sepolia.base.org
```

Expect the same hash `0xa50bcbbe…efe68` from both, and `fulfilled` is `true`.

Check who delivered the answer:

```bash
cast tx 0x427d1002f44249de44cd038d48a99d0236a08554192ada74b5c1218093107a6d from --rpc-url https://sepolia.base.org
```

Expect `0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F`: the address derived from the NEAR MPC key, which no person holds a key for.

## Break it on purpose

- Change one character of a `response_body` in either JSON file and run its `verify_consensus` again. It returns `"ok": false` with `invalid signature`.
- Swap the `chain` field between the two files. The signatures fail too: an answer signed for one source does not verify for another.

## Check the rules cannot change under you

The oracle account has no keys, so its code and rules change only through an announced proposal:

```bash
near account list-keys oracle.psephex.testnet network-config testnet now
```

```bash
near contract call-function as-read-only oracle.psephex.testnet proposals json-args {} network-config testnet now
```

```bash
near contract call-function as-read-only oracle.psephex.testnet owner_delay_seconds json-args {} network-config testnet now
```

Expect no keys, the open proposals with the time each may run (`ready_at_ns`), and `"86400"`. See [owner timelock](/trust/owner-timelock) for what this covers.

## Fetch a fresh TEE attestation

The [models page](https://psephex.xyz/app/models) links each provider's attestation endpoint with a fresh random nonce. The quote's report data holds the signing key and your nonce, so the key that signed the answers is the one inside the enclave.

::: info What we did not verify
We did not verify Intel's DCAP signature chain on the TDX quotes. We checked that each quote's report data holds the signing key and our nonce.
:::
