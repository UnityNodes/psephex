import type { Address } from "viem";
import type { ModelInfo } from "../types.js";

export type Sample<T> =
  | { readonly ok: true; readonly value: T; readonly at: number; readonly stale: boolean }
  | { readonly ok: false; readonly error: string };

export interface ChainReader {
  baseHead(): Promise<bigint>;
  baseBalance(address: Address): Promise<bigint>;
  nearBalance(accountId: string): Promise<bigint>;
  models(): Promise<ModelInfo[]>;
}

export interface ChainSnapshot {
  readonly base: Sample<{ readonly head: bigint; readonly oracleBalanceWei: bigint }>;
  readonly near: Sample<{ readonly relayerBalanceYocto: bigint }>;
}

export interface ChainStatus {
  snapshot(): Promise<ChainSnapshot>;
  models(): Promise<Sample<readonly ModelInfo[]>>;
}

export interface ChainStatusSettings {
  readonly oracleEvmAddress: Address;
  readonly nearRelayerAccount: string;
}

export interface CachedSourceOptions<T> {
  readonly load: () => Promise<T>;
  readonly ttlMs: number;
  readonly now: () => number;
  readonly label: string;
  readonly onError?: (err: unknown) => void;
  readonly retryAfterMs?: number;
}

const FAILURE_RETRY_MS = 3_000;

/**
 * Public endpoints would otherwise forward every hit to the RPC providers and burn their quota.
 * A success is cached for ttlMs and concurrent readers share one call. A failure is reported as
 * an error, never stored as data: the last good value is served marked stale, and the RPC is not
 * asked again for retryAfterMs so a fast-failing provider is not hammered by every request.
 */
export function cachedSource<T>(opts: CachedSourceOptions<T>): () => Promise<Sample<T>> {
  const { load, ttlMs, now, label, onError, retryAfterMs = 0 } = opts;
  let last: { value: T; at: number } | null = null;
  let failedAt: number | null = null;
  let inflight: Promise<Sample<T>> | null = null;
  const fallback = (): Sample<T> => (last ? { ok: true, value: last.value, at: last.at, stale: true } : { ok: false, error: `${label} unavailable` });
  const refresh = async (): Promise<Sample<T>> => {
    try {
      const value = await load();
      last = { value, at: now() };
      failedAt = null;
      return { ok: true, value, at: last.at, stale: false };
    } catch (err) {
      onError?.(err);
      failedAt = now();
      return fallback();
    } finally {
      inflight = null;
    }
  };
  return () => {
    if (last && now() - last.at < ttlMs) return Promise.resolve({ ok: true, value: last.value, at: last.at, stale: false });
    if (failedAt !== null && now() - failedAt < retryAfterMs) return Promise.resolve(fallback());
    inflight ??= refresh();
    return inflight;
  };
}

export function createChainStatus(reader: ChainReader, settings: ChainStatusSettings, ttlMs: number, now: () => number, onError?: (source: string, err: unknown) => void): ChainStatus {
  const report = (source: string) => (err: unknown) => onError?.(source, err);
  const common = { ttlMs, now, retryAfterMs: FAILURE_RETRY_MS };
  const base = cachedSource({
    ...common,
    label: "Base RPC",
    onError: report("base"),
    load: async () => {
      const [head, oracleBalanceWei] = await Promise.all([reader.baseHead(), reader.baseBalance(settings.oracleEvmAddress)]);
      return { head, oracleBalanceWei };
    },
  });
  const near = cachedSource({ ...common, label: "NEAR RPC", onError: report("near"), load: async () => ({ relayerBalanceYocto: await reader.nearBalance(settings.nearRelayerAccount) }) });
  const models = cachedSource({ ...common, label: "NEAR RPC", onError: report("models"), load: async (): Promise<readonly ModelInfo[]> => reader.models() });
  return {
    async snapshot() {
      const [b, n] = await Promise.all([base(), near()]);
      return { base: b, near: n };
    },
    models,
  };
}
