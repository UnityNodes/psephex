import type { Address } from "viem";
import type { SourceName } from "../sources.js";
import type { ModelInfo } from "../types.js";
import type { ApiSource } from "./config.js";

export type Sample<T> =
  | { readonly ok: true; readonly value: T; readonly at: number; readonly stale: boolean }
  | { readonly ok: false; readonly error: string };

export interface ChainReader {
  head(source: SourceName): Promise<bigint>;
  evmBalance(source: SourceName, address: Address): Promise<bigint>;
  nearBalance(accountId: string): Promise<bigint>;
  nearFee(): Promise<bigint>;
  models(): Promise<ModelInfo[]>;
}

export interface SourceHead {
  readonly head: bigint;
  readonly oracleBalanceWei: bigint | null;
}

export interface ChainSnapshot {
  readonly sources: Readonly<Partial<Record<SourceName, Sample<SourceHead>>>>;
  readonly near: Sample<{ readonly relayerBalanceYocto: bigint }>;
}

export interface ChainStatus {
  snapshot(): Promise<ChainSnapshot>;
  models(): Promise<Sample<readonly ModelInfo[]>>;
  nearFee(): Promise<Sample<bigint>>;
}

export interface ChainStatusSettings {
  readonly sources: readonly Pick<ApiSource, "source" | "kind" | "name">[];
  readonly oracleEvmAddress: Address | null;
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
  const oracle = settings.oracleEvmAddress;
  const heads = settings.sources.map((s) => {
    const load = async (): Promise<SourceHead> => {
      const balance = s.kind === "evm" && oracle !== null ? reader.evmBalance(s.source, oracle) : Promise.resolve(null);
      const [head, oracleBalanceWei] = await Promise.all([reader.head(s.source), balance]);
      return { head, oracleBalanceWei };
    };
    return [s.source, cachedSource({ ...common, label: `${s.name} RPC`, onError: report(s.source), load })] as const;
  });
  const near = cachedSource({ ...common, label: "NEAR RPC", onError: report("near-account"), load: async () => ({ relayerBalanceYocto: await reader.nearBalance(settings.nearRelayerAccount) }) });
  const models = cachedSource({ ...common, label: "NEAR RPC", onError: report("models"), load: async (): Promise<readonly ModelInfo[]> => reader.models() });
  const nearFee = cachedSource({ ...common, label: "NEAR RPC", onError: report("near-fee"), load: () => reader.nearFee() });
  return {
    async snapshot() {
      const [entries, n] = await Promise.all([Promise.all(heads.map(async ([source, get]) => [source, await get()] as const)), near()]);
      return { sources: Object.fromEntries(entries), near: n };
    },
    models,
    nearFee,
  };
}
