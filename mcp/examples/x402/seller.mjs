import { createServer } from "node:http";
import { deserialize } from "borsh";
import { SCHEMA } from "near-api-js";
import { ASSET, NETWORK, account, b64json, unb64json } from "./common.mjs";

const SELLER = process.env.SELLER ?? "psephex-agent-seller.testnet";
const PRICE = process.env.PRICE ?? "10000000000000000000000";
const PORT = Number(process.env.PORT ?? 4402);
const seller = account(SELLER);
const rows = ["name,country,capacity_mw", ...Array.from({ length: 60 }, (_, i) => `Plant ${i + 1},${["DE", "ES", "FR", "IT"][i % 4]},${50 + i}`)];

const requirements = {
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  payTo: SELLER,
  maxAmountRequired: PRICE,
  resource: `http://127.0.0.1:${PORT}/dataset`,
  description: "100 EU solar plants: name, country, capacity_mw",
  mimeType: "text/csv",
  maxTimeoutSeconds: 120,
};

/**
 * The seller settles the x402 payment itself instead of calling a facilitator: it checks that
 * the buyer's signed NEP-366 delegate is exactly one ft_transfer of the asked token, amount and
 * payee, then relays it on chain and pays the gas. Only a confirmed transfer releases the data.
 */
function checkDelegate(sd) {
  const d = sd.delegateAction;
  if (d.receiverId !== ASSET) return "the payment is not in the asked token";
  if (d.actions.length !== 1 || !d.actions[0].functionCall) return "the payment must be exactly one ft_transfer";
  const fc = d.actions[0].functionCall;
  if (fc.methodName !== "ft_transfer") return "the payment must be ft_transfer";
  const args = JSON.parse(Buffer.from(fc.args).toString("utf8"));
  if (args.receiver_id !== SELLER) return "the payment goes to another account";
  if (BigInt(args.amount) < BigInt(PRICE)) return "the payment is below the price";
  if (BigInt(fc.deposit) !== 1n) return "ft_transfer needs exactly 1 yoctoNEAR";
  return null;
}

createServer(async (req, res) => {
  if (req.url !== "/dataset") return void res.writeHead(404).end();
  const header = req.headers["x-payment"];
  if (!header) {
    res.writeHead(402, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ x402Version: 2, error: "payment required", accepts: [requirements] }));
  }
  try {
    const payment = unb64json(String(header));
    if (payment.network !== NETWORK || payment.scheme !== "exact") throw new Error("unsupported scheme or network");
    const sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(payment.payload.signedDelegateAction, "base64"));
    const problem = checkDelegate(sd);
    if (problem) throw new Error(problem);
    const outcome = await seller.relayMetaTransaction(sd);
    const failed = outcome.status?.Failure !== undefined || (outcome.receipts_outcome ?? []).some((r) => r.outcome?.status?.Failure !== undefined);
    if (failed) throw new Error("the transfer failed on chain");
    const tx = outcome.transaction.hash;
    console.log(`paid by ${sd.delegateAction.senderId}, tx ${tx}`);
    res.writeHead(200, { "content-type": "text/csv", "x-payment-response": b64json({ success: true, transaction: tx, network: NETWORK, payer: sd.delegateAction.senderId }) });
    res.end(rows.join("\n") + "\n");
  } catch (err) {
    res.writeHead(402, { "content-type": "application/json" });
    res.end(JSON.stringify({ x402Version: 2, error: String(err.message ?? err), accepts: [requirements] }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`x402 seller ${SELLER} on http://127.0.0.1:${PORT}/dataset, price ${PRICE} of ${ASSET}`));
