import { createContext, useContext } from "react";
import { NEAR_RPC_URL } from "../deployment.js";

export type NearTxResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

export interface NearRpc {
  view<T>(contract: string, method: string, args: Readonly<Record<string, unknown>>): Promise<T>;
  txResult(hash: string, sender: string): Promise<NearTxResult>;
}

export class NearRpcError extends Error {}

const TX_ATTEMPTS = 6;

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
}

interface RpcReply {
  readonly result?: { readonly result?: number[]; readonly error?: string; readonly status?: unknown };
  readonly error?: { readonly name?: string; readonly cause?: { readonly name?: string }; readonly data?: unknown; readonly message?: string };
}

function failureText(failure: unknown): string {
  const text = JSON.stringify(failure);
  const panic = /"ExecutionError":"([^"]+)"/.exec(text);
  return panic?.[1] ?? text;
}

/**
 * The wallet only returns a transaction hash, while the dispute id is the return value of the last
 * receipt in the chain. Asking the RPC for the final status is the only way to learn which request
 * id the oracle assigned, or that it refused the question and the deposit went back.
 */
export function parseTxStatus(status: unknown): NearTxResult {
  if (status && typeof status === "object" && "SuccessValue" in status) {
    const raw = (status as { SuccessValue: string }).SuccessValue;
    if (raw === "") return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(fromBase64(raw)) as unknown };
    } catch {
      return { ok: false, error: "the transaction returned a value that is not JSON" };
    }
  }
  if (status && typeof status === "object" && "Failure" in status) return { ok: false, error: failureText((status as { Failure: unknown }).Failure) };
  return { ok: false, error: "the transaction has not finished yet" };
}

export function createNearRpc(url: string, fetchImpl: typeof fetch = fetch): NearRpc {
  async function call(method: string, params: unknown): Promise<RpcReply> {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "psephex", method, params }) });
    if (!res.ok) throw new NearRpcError(`NEAR RPC answered ${res.status}`);
    return (await res.json()) as RpcReply;
  }

  return {
    async view<T>(contract: string, method: string, args: Readonly<Record<string, unknown>>): Promise<T> {
      const reply = await call("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: toBase64(JSON.stringify(args)) });
      if (reply.error) throw new NearRpcError(typeof reply.error.data === "string" ? reply.error.data : (reply.error.message ?? "NEAR RPC error"));
      if (reply.result?.error) throw new NearRpcError(reply.result.error);
      const bytes = reply.result?.result;
      if (!bytes) throw new NearRpcError(`no result from ${contract}.${method}`);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes))) as T;
    },
    async txResult(hash: string, sender: string): Promise<NearTxResult> {
      for (let attempt = 1; ; attempt++) {
        const reply = await call("tx", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
        if (reply.result?.status) return parseTxStatus(reply.result.status);
        const name = reply.error?.cause?.name ?? reply.error?.name ?? "";
        const retry = /TIMEOUT|UNKNOWN_TRANSACTION/i.test(name);
        if (!retry || attempt >= TX_ATTEMPTS) return { ok: false, error: reply.error?.message ?? "NEAR RPC did not return the transaction" };
      }
    },
  };
}

const NearRpcContext = createContext<NearRpc>(createNearRpc(NEAR_RPC_URL));
export const NearRpcProvider = NearRpcContext.Provider;

export function useNearRpc(): NearRpc {
  return useContext(NearRpcContext);
}
