import { isAccountId } from "./config.js";
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
}

interface RawAction {
  readonly Transfer?: { readonly deposit?: string };
  readonly FunctionCall?: FunctionCall;
  readonly Delegate?: { readonly delegate_action?: { readonly sender_id?: string; readonly receiver_id?: string; readonly actions?: readonly RawAction[] } };
}

interface RawTx {
  readonly transaction?: { readonly hash?: string; readonly signer_id?: string; readonly receiver_id?: string; readonly actions?: readonly RawAction[] };
  readonly status?: { readonly SuccessValue?: string; readonly Failure?: unknown };
  readonly receipts_outcome?: readonly { readonly outcome?: { readonly status?: { readonly Failure?: unknown }; readonly logs?: readonly string[] } }[];
}

interface Found {
  readonly payer: string;
  readonly payee: string | null;
  readonly asset: string;
  readonly raw: bigint;
  readonly x402: boolean;
}

const AMOUNT = /^\d{1,40}$/;
const SYMBOL = /^[A-Za-z0-9.]{1,12}$/;

function decodeArgs(args: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(args ?? "", "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function transferOf(payer: string, asset: string, args: Record<string, unknown>, x402: boolean): Found | null {
  const amount = String(args.amount ?? "");
  if (!AMOUNT.test(amount)) return null;
  const payee = typeof args.receiver_id === "string" && isAccountId(args.receiver_id) ? args.receiver_id : null;
  return { payer, payee, asset, raw: BigInt(amount), x402 };
}

function findPayment(tx: RawTx): Found | null {
  const t = tx.transaction;
  if (!t?.signer_id || !t.receiver_id) return null;
  for (const a of t.actions ?? []) {
    if (a.Transfer?.deposit && AMOUNT.test(a.Transfer.deposit)) return { payer: t.signer_id, payee: t.receiver_id, asset: "NEAR", raw: BigInt(a.Transfer.deposit), x402: false };
    if (a.FunctionCall?.method_name === "ft_transfer") return transferOf(t.signer_id, t.receiver_id, decodeArgs(a.FunctionCall.args), false);
    const d = a.Delegate?.delegate_action;
    if (d?.sender_id && d.receiver_id) {
      const inner = (d.actions ?? []).find((x) => x.FunctionCall?.method_name === "ft_transfer");
      if (inner) return transferOf(d.sender_id, d.receiver_id, decodeArgs(inner.FunctionCall?.args), true);
    }
  }
  return null;
}

function units(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const frac = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${raw / scale}.${frac}` : `${raw / scale}`;
}

function refuse(txHash: string, payer: string, reason: string): PaymentCheck {
  return { ok: false, txHash, payer, payee: null, asset: "unknown", amount: null, x402: false, evidence: `Transaction ${txHash} is not a verified payment: ${reason}.`, reason };
}

/**
 * A payment receipt is only worth something in a case if it is checked on chain. An x402
 * payment (a NEP-366 signed delegate carrying `ft_transfer`) succeeds at the outer level even
 * when the inner transfer fails, so every receipt must have succeeded; and any contract can
 * expose `ft_transfer`, so only tokens on the trusted list count, with sane metadata.
 */
export async function checkPayment(near: NearPort, txHash: string, sender: string, trustedTokens: readonly string[]): Promise<PaymentCheck> {
  const tx = (await near.tx(txHash, sender)) as RawTx;
  if (tx.transaction?.hash && tx.transaction.hash !== txHash) return refuse(txHash, sender, "the RPC returned another transaction");
  const found = findPayment(tx);
  if (!found) return refuse(txHash, sender, "no transfer, ft_transfer or delegated ft_transfer in this transaction");
  const receiptFailed = (tx.receipts_outcome ?? []).some((r) => r.outcome?.status?.Failure !== undefined);
  if (tx.status?.Failure !== undefined || receiptFailed) return refuse(txHash, found.payer, "the transaction or one of its receipts failed");
  let decimals = 24;
  let symbol = "NEAR";
  if (found.asset !== "NEAR") {
    if (!trustedTokens.includes(found.asset)) return refuse(txHash, found.payer, `token ${found.asset} is not on the trusted token list`);
    const meta = await near.view<{ decimals?: unknown; symbol?: unknown }>(found.asset, "ft_metadata", {}).catch(() => null);
    if (!meta || !Number.isInteger(meta.decimals) || (meta.decimals as number) < 0 || (meta.decimals as number) > 36) return refuse(txHash, found.payer, "the token metadata is missing or invalid");
    decimals = meta.decimals as number;
    symbol = typeof meta.symbol === "string" && SYMBOL.test(meta.symbol) ? meta.symbol : "token";
  }
  const amount = units(found.raw, decimals);
  const payee = found.payee ?? "an unreadable receiver";
  const how = found.x402 ? "x402 payment (signed delegate)" : "payment";
  return {
    ok: true,
    txHash,
    payer: found.payer,
    payee: found.payee,
    asset: found.asset === "NEAR" ? "NEAR" : `${symbol} (${found.asset})`,
    amount,
    x402: found.x402,
    evidence: `NEAR transaction ${txHash}: ${how} of ${amount} ${symbol} from ${found.payer} to ${payee}, all receipts succeeded.`,
    reason: null,
  };
}
