import { actions, encodeSignedDelegate } from "near-api-js";
import { account, b64json, unb64json } from "./common.mjs";

const BUYER = process.env.BUYER ?? "psephex-agent-buyer.testnet";
const URL_ = process.env.URL ?? "http://127.0.0.1:4402/dataset";
const buyer = account(BUYER);

const first = await fetch(URL_);
if (first.status !== 402) throw new Error(`expected 402, got ${first.status}`);
const offer = (await first.json()).accepts[0];
console.log(`402 Payment Required: ${offer.maxAmountRequired} of ${offer.asset} to ${offer.payTo} on ${offer.network}`);

const transfer = actions.functionCall("ft_transfer", { receiver_id: offer.payTo, amount: offer.maxAmountRequired }, 30_000_000_000_000n, 1n);
const { signedDelegate: signed } = await buyer.createSignedMetaTransaction({ receiverId: offer.asset, actions: [transfer], blockHeightTtl: 120 });
const payment = { x402Version: 2, scheme: "exact", network: offer.network, payload: { signedDelegateAction: Buffer.from(encodeSignedDelegate(signed)).toString("base64") } };

const paid = await fetch(URL_, { headers: { "x-payment": b64json(payment) } });
const receipt = paid.headers.get("x-payment-response");
const body = await paid.text();
if (paid.status !== 200 || !receipt) throw new Error(`payment refused: ${paid.status} ${body}`);
const settled = unb64json(receipt);
console.log(`paid: tx ${settled.transaction}, payer ${settled.payer}`);
console.log(`received ${body.trim().split("\n").length - 1} data rows`);
