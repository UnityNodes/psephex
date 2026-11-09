import { isIP } from "node:net";
import type { Address } from "viem";
import { address, ConfigError, optional, positiveInt, required, serviceUrl, type Env } from "../config.js";

export interface ApiConfig {
  readonly dbPath: string;
  readonly host: string;
  readonly port: number;
  readonly publicUrl: string;
  readonly corsOrigin: string | null;
  readonly rateLimitPerMinute: number;
  readonly trustProxy: false | string;
  readonly chainCacheMs: number;
  readonly baseRpcUrl: string;
  readonly nearRpcUrl: string;
  readonly publicBaseRpcUrl: string;
  readonly nearNetwork: "testnet";
  readonly nearAiBaseUrl: string;
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly nearOracleContract: string;
  readonly nearRelayerAccount: string;
  readonly baseChainId: number;
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

export function loadApiConfig(env: Env): ApiConfig {
  assertNoRelayerSecrets(env);
  const listenPort = port(env);
  return {
    dbPath: required(env, "DB_PATH"),
    host: optional(env, "API_HOST", "127.0.0.1"),
    port: listenPort,
    publicUrl: publicUrl(env, listenPort),
    corsOrigin: corsOrigin(env),
    rateLimitPerMinute: positiveInt(env, "API_RATE_LIMIT", 120),
    trustProxy: trustProxy(env),
    chainCacheMs: positiveInt(env, "API_CHAIN_CACHE_MS", 15_000),
    baseRpcUrl: serviceUrl(env, "BASE_RPC_URL"),
    nearRpcUrl: serviceUrl(env, "NEAR_RPC_URL"),
    publicBaseRpcUrl: serviceUrl(env, "PUBLIC_BASE_RPC_URL", "https://sepolia.base.org"),
    nearNetwork: "testnet",
    nearAiBaseUrl: serviceUrl(env, "NEAR_AI_BASE_URL", "https://cloud-api.near.ai"),
    aiOracleAddress: address(env, "AIORACLE_ADDRESS"),
    oracleEvmAddress: address(env, "ORACLE_EVM_ADDRESS"),
    nearOracleContract: nearAccount(env, "NEAR_ORACLE_CONTRACT"),
    nearRelayerAccount: nearAccount(env, "NEAR_RELAYER_ACCOUNT"),
    baseChainId: positiveInt(env, "BASE_CHAIN_ID", 84532),
    dailyModelBudget: positiveInt(env, "DAILY_MODEL_BUDGET", 300),
  };
}
