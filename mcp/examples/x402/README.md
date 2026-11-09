# x402 on NEAR, then a court case

A buyer agent pays for an HTTP resource with x402 on NEAR testnet, and the x402 receipt later becomes evidence in a Psephex court case.

- `seller.mjs` answers `402 Payment Required` with an `exact` offer: 0.01 wNEAR (`wrap.testnet`) to `psephex-agent-seller.testnet` on `near:testnet`.
- `buyer.mjs` signs a NEP-366 delegate action with one `ft_transfer` and retries with the `x-payment` header.
- The seller settles the payment itself, without a facilitator. It checks the delegate (token, one `ft_transfer`, payee, amount, 1 yocto deposit), relays it on chain, pays the gas, and returns the data with an `x-payment-response` header.
- The MCP tool `check_payment` reads the transaction and reports `x402: true` for a relayed delegate.

## Run

Both accounts need a `storage_deposit` on `wrap.testnet`, and the buyer needs wNEAR (`near_deposit`). Keys are read from `~/.near-credentials/testnet/<account>.json`, or from `KEY_FILE`.

```bash
node seller.mjs
```

```bash
node buyer.mjs
```

Then check the receipt with the MCP server (`check_payment`, sender is the seller, because the seller relayed the transaction) and pass its `evidence` text to `open_case`.

## Live run, 2026-11-09

- x402 payment: tx `8tikQxatL6AhfKNLr6Gn2WqraVTLdmRNnA2Srqyk5Mdd`, 0.01 wNEAR from `psephex-agent-buyer.testnet` to `psephex-agent-seller.testnet`, relayed by the seller. The buyer received 60 rows instead of the 100 in the offer.
- `check_payment`: `ok: true`, `x402: true`, all receipts succeeded.
- Court case 3: the buyer cited that receipt as evidence, the seller answered. Votes YES, UNKNOWN, UNKNOWN, so the verdict is UNKNOWN; nobody appealed, and `finalize` returned the 0.05 NEAR stake to the buyer.
