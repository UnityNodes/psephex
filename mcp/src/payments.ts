import type { NearPort } from "./near.js";

export interface PaymentCheck {
  readonly ok: boolean;
  readonly txHash: string;
  readonly payer: string;
  readonly payee: string | null;
  readonly asset: string;
  readonly amount: string | null;
  readonly x402: boolean;
  readonly evidence: string;
  readonly reason: string | null;
}

interface FunctionCall {
  readonly method_name?: string;
  readonly args?: string;
  readonly deposit?: string;
}

interface RawAction {
  readonly Transfer?: { readonly deposit?: string };
  readonly FunctionCall?: FunctionCall;
  readonly Delegate?: { readonly delegate_action?: { readonly sender_id?: string; readonly receiver_id?: string; readonly actions?: readonly RawAction[] } };
}

interface RawTx {
  readonly transaction?: { readonly hash?: string; readonly signer_id?: string; readonly receiver_id?: string; readonly actions?: readonly RawAction[] };
  readonly status?: { readonly SuccessValue?: string; readonly Failure?: unknown };
}

interface Found {
  readonly payer: string;
  readonly payee: string | null;
  readonly asset: string;
  readonly raw: bigint;
  readonly x402: boolean;
}

function decodeArgs(args: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(args ?? "", "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function findPayment(tx: RawTx): Found | null {
  const t = tx.transaction;
  if (!t?.signer_id || !t.receiver_id) return null;
  for (const a of t.actions ?? []) {
    if (a.Transfer?.deposit) return { payer: t.signer_id, payee: t.receiver_id, asset: "NEAR", raw: BigInt(a.Transfer.deposit), x402: false };
    if (a.FunctionCall?.method_name === "ft_transfer") {
      const args = decodeArgs(a.FunctionCall.args);
      return { payer: t.signer_id, payee: typeof args.receiver_id === "string" ? args.receiver_id : null, asset: t.receiver_id, raw: BigInt(String(args.amount ?? "0")), x402: false };
    }
    const d = a.Delegate?.delegate_action;
    if (d?.sender_id && d.receiver_id) {
      for (const inner of d.actions ?? []) {
        if (inner.FunctionCall?.method_name !== "ft_transfer") continue;
        const args = decodeArgs(inner.FunctionCall.args);
        return { payer: d.sender_id, payee: typeof args.receiver_id === "string" ? args.receiver_id : null, asset: d.receiver_id, raw: BigInt(String(args.amount ?? "0")), x402: true };
      }
    }
  }
  return null;
}

function units(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${raw / scale}.${frac}` : `${raw / scale}`;
}

/**
 * A payment receipt is only worth something in a case if it is checked on chain. The summary
 * comes from the final transaction, a NEAR transfer, an `ft_transfer`, or an x402 payment
 * (a NEP-366 signed delegate carrying `ft_transfer`, submitted by a facilitator relayer).
 */
export async function checkPayment(near: NearPort, txHash: string, sender: string): Promise<PaymentCheck> {
  const tx = (await near.tx(txHash, sender)) as RawTx;
  const failed = tx.status?.Failure !== undefined;
  const found = findPayment(tx);
  if (!found) {
    return { ok: false, txHash, payer: sender, payee: null, asset: "unknown", amount: null, x402: false, evidence: `Transaction ${txHash} holds no payment.`, reason: "no transfer, ft_transfer or delegated ft_transfer in this transaction" };
  }
  let decimals = 24;
  let symbol = "NEAR";
  if (found.asset !== "NEAR") {
    const meta = await near.view<{ decimals?: number; symbol?: string }>(found.asset, "ft_metadata", {}).catch(() => ({}) as { decimals?: number; symbol?: string });
    decimals = meta.decimals ?? 0;
    symbol = meta.symbol ?? found.asset;
  }
  const amount = units(found.raw, decimals);
  const how = found.x402 ? "x402 payment (signed delegate)" : "payment";
  const evidence = failed
    ? `NEAR transaction ${txHash} tried a ${how} of ${amount} ${symbol} from ${found.payer} to ${found.payee ?? "?"} and failed.`
    : `NEAR transaction ${txHash}: ${how} of ${amount} ${symbol} from ${found.payer} to ${found.payee ?? "?"}, final.`;
  return { ok: !failed, txHash, payer: found.payer, payee: found.payee, asset: found.asset === "NEAR" ? "NEAR" : `${symbol} (${found.asset})`, amount, x402: found.x402, evidence, reason: failed ? "the transaction failed" : null };
}
