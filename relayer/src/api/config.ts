import { isIP } from "node:net";
import type { Address } from "viem";
import { address, ConfigError, firstSet, optional, positiveInt, required, serviceUrl, type Env } from "../config.js";
import { evmChainKey, isSourceName, NEAR_TESTNET_CHAIN, SOURCES, type SourceName } from "../sources.js";

interface ApiSourceCommon {
  readonly source: SourceName;
  readonly chain: string;
  readonly name: string;
  readonly dbPath: string;
  readonly explorer: string;
}

export interface ApiEvmSource extends ApiSourceCommon {
  readonly kind: "evm";
  readonly rpcUrl: string;
  readonly publicRpcUrl: string;
  readonly aiOracleAddress: Address;
  readonly chainId: number;
  readonly dispute: Address | null;
}

export interface ApiNearSource extends ApiSourceCommon {
  readonly kind: "near";
  readonly dispute: string | null;
}

export type ApiSource = ApiEvmSource | ApiNearSource;

export interface ApiConfig {
  readonly sources: readonly ApiSource[];
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly corsOrigin: string | null;
  readonly rateLimitPerMinute: number;
  readonly trustProxy: false | string;
  readonly chainCacheMs: number;
  readonly nearRpcUrl: string;
  readonly nearNetwork: "testnet";
  readonly nearAiBaseUrl: string;
  readonly oracleEvmAddress: Address | null;
  readonly nearOracleContract: string;
  readonly nearRelayerAccount: string;
  readonly dailyModelBudget: number;
}

const FORBIDDEN_SECRETS = ["NEAR_RELAYER_KEY", "NEAR_AI_API_KEY", "PHALA_API_KEY"] as const;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const SHELL_SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
const MAX_PORT = 65_535;

/**
 * The API is public and runs next to the relayer. If it inherited the relayer environment, a
 * bug in a public handler could expose the NEAR signing key or the NEAR AI key, so the process
 * refuses to start while either is present.
 */
function assertNoRelayerSecrets(env: Env): void {
  for (const key of FORBIDDEN_SECRETS) {
    if (env[key]?.trim()) throw new ConfigError(`${key} must not be set in the API environment; give the API its own env file`);
  }
}

function nearAccount(env: Env, key: string): string {
  const value = required(env, key);
  if (!NEAR_ACCOUNT.test(value)) throw new ConfigError(`${key} is not a NEAR account id`);
  if (!value.endsWith(".testnet")) throw new ConfigError(`${key} must be a testnet account`);
  return value;
}

/**
 * The public URL is pasted into the shell commands /verify returns, so it is restricted to
 * characters a shell never interprets instead of being escaped.
 */
function publicUrl(env: Env, port: number): string {
  const raw = optional(env, "API_PUBLIC_URL", `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  if (!SHELL_SAFE_URL.test(raw)) throw new ConfigError("API_PUBLIC_URL must be a plain http(s) URL without credentials, query or special characters");
  return raw;
}

function corsOrigin(env: Env): string | null {
  const raw = env.API_CORS_ORIGIN?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("API_CORS_ORIGIN must be an origin such as https://psephex.app");
  }
  if (url.origin !== raw) throw new ConfigError("API_CORS_ORIGIN must be a bare origin such as https://psephex.app");
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !local) throw new ConfigError("API_CORS_ORIGIN must use https");
  return raw;
}

function port(env: Env): number {
  const value = positiveInt(env, "API_PORT", 8790);
  if (value > MAX_PORT) throw new ConfigError(`API_PORT must be at most ${MAX_PORT}`);
  return value;
}

function isPrivateProxy(ip: string): boolean {
  if (isIP(ip) === 4) return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  if (isIP(ip) === 6) return ip === "::1" || /^f[cd][0-9a-f]{2}:/i.test(ip);
  return false;
}

/**
 * Every address listed here may set X-Forwarded-For, and the rate limit keys on that header.
 * A range such as 0.0.0.0/0 would let any client pick its own key, so only single loopback or
 * private proxy addresses are accepted.
 */
function trustProxy(env: Env): false | string {
  const raw = env.API_TRUST_PROXY?.trim();
  if (!raw) return false;
  const ips = raw.split(",").map((ip) => ip.trim());
  if (!ips.every(isPrivateProxy)) throw new ConfigError("API_TRUST_PROXY must list single loopback or private proxy addresses, for example 127.0.0.1");
  return ips.join(",");
}

function explorerUrl(env: Env, key: string, fallback: string): string {
  const value = serviceUrl(env, key, fallback);
  if (!value.startsWith("https://")) throw new ConfigError(`${key} must use https`);
  return value;
}

function optionalAddress(env: Env, key: string): Address | null {
  return env[key]?.trim() ? address(env, key) : null;
}

function sourceList(env: Env): SourceName[] {
  const names = optional(env, "API_SOURCES", "base")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const name of names) if (!isSourceName(name)) throw new ConfigError(`API_SOURCES lists unknown source "${name}"; use base, arbitrum, near`);
  if (names.length === 0) throw new ConfigError("API_SOURCES must list at least one source");
  if (new Set(names).size !== names.length) throw new ConfigError("API_SOURCES lists a source twice");
  return names as SourceName[];
}

/**
 * Base keeps the env names of the live single-source deployment (DB_PATH, BASE_RPC_URL,
 * AIORACLE_ADDRESS); every other source reads the same settings under its own prefix.
 */
function evmSource(env: Env, source: SourceName): ApiEvmSource {
  const prefix = source.toUpperCase();
  const legacy = source === "base";
  const info = SOURCES[source];
  const chainId = positiveInt(env, `${prefix}_CHAIN_ID`, info.defaultChainId ?? 0);
  return {
    source,
    kind: "evm",
    chain: evmChainKey(chainId),
    name: info.name,
    dbPath: required(env, firstSet(env, legacy ? [`${prefix}_DB_PATH`, "DB_PATH"] : [`${prefix}_DB_PATH`])),
    explorer: explorerUrl(env, `${prefix}_EXPLORER_URL`, info.explorer),
    rpcUrl: serviceUrl(env, `${prefix}_RPC_URL`),
    publicRpcUrl: serviceUrl(env, `PUBLIC_${prefix}_RPC_URL`, info.publicRpcUrl ?? ""),
    aiOracleAddress: address(env, firstSet(env, legacy ? [`${prefix}_AIORACLE_ADDRESS`, "AIORACLE_ADDRESS"] : [`${prefix}_AIORACLE_ADDRESS`])),
    chainId,
    dispute: optionalAddress(env, `${prefix}_DISPUTE_ADDRESS`),
  };
}

function nearSource(env: Env): ApiNearSource {
  const info = SOURCES.near;
  return {
    source: "near",
    kind: "near",
    chain: NEAR_TESTNET_CHAIN,
    name: info.name,
    dbPath: required(env, "NEAR_DB_PATH"),
    explorer: explorerUrl(env, "NEAR_EXPLORER_URL", info.explorer),
    dispute: env.NEAR_DISPUTE_CONTRACT?.trim() ? nearAccount(env, "NEAR_DISPUTE_CONTRACT") : null,
  };
}

export function loadApiConfig(env: Env): ApiConfig {
  assertNoRelayerSecrets(env);
  const listenPort = port(env);
  const sources = sourceList(env).map((s) => (SOURCES[s].kind === "near" ? nearSource(env) : evmSource(env, s)));
  if (new Set(sources.map((s) => s.dbPath)).size !== sources.length) throw new ConfigError("each source needs its own database path");
  const anyEvm = sources.some((s) => s.kind === "evm");
  return {
    sources,
    host: optional(env, "API_HOST", "127.0.0.1"),
    port: listenPort,
    publicUrl: publicUrl(env, listenPort),
    corsOrigin: corsOrigin(env),
    rateLimitPerMinute: positiveInt(env, "API_RATE_LIMIT", 120),
    trustProxy: trustProxy(env),
    chainCacheMs: positiveInt(env, "API_CHAIN_CACHE_MS", 15_000),
    nearRpcUrl: serviceUrl(env, "NEAR_RPC_URL"),
    nearNetwork: "testnet",
    nearAiBaseUrl: serviceUrl(env, "NEAR_AI_BASE_URL", "https://cloud-api.near.ai"),
    oracleEvmAddress: anyEvm ? address(env, "ORACLE_EVM_ADDRESS") : null,
    nearOracleContract: nearAccount(env, "NEAR_ORACLE_CONTRACT"),
    nearRelayerAccount: nearAccount(env, "NEAR_RELAYER_ACCOUNT"),
    dailyModelBudget: positiveInt(env, "DAILY_MODEL_BUDGET", 300),
  };
}
