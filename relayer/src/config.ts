import { getAddress, isAddress, parseGwei, type Address } from "viem";
import { evmChainKey, isSourceName, NEAR_TESTNET_CHAIN, SOURCES, type SourceName } from "./sources.js";

export interface CommonRelayerConfig {
  readonly source: SourceName;
  readonly chain: string;
  readonly nearRpcUrl: string;
  readonly nearAiBaseUrl: string;
  readonly nearAiApiKey: string;
  readonly phalaBaseUrl: string;
  readonly phalaApiKey: string | null;
  readonly nearRelayerAccount: string;
  readonly nearRelayerKey: string;
  readonly nearOracleContract: string;
  readonly pollMs: number;
  readonly fulfillGasTera: number;
  readonly dailyModelBudget: number;
  readonly perAddressHourlyLimit: number;
  readonly modelRetries: number;
  readonly mpcRetries: number;
  readonly stuckMs: number;
  readonly maxQueue: number;
  readonly dbPath: string;
}

export interface EvmRelayerConfig extends CommonRelayerConfig {
  readonly kind: "evm";
  readonly evmRpcUrl: string;
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly evmChainId: number;
  readonly startBlock: bigint;
  readonly confirmations: number;
  readonly logBlockRange: bigint;
  readonly maxFeePerGas: bigint;
  readonly receiptAlertMs: number;
  readonly feeBaseMultiplier: number;
}

export interface NearRelayerConfig extends CommonRelayerConfig {
  readonly kind: "near";
  readonly startId: number;
  readonly pageSize: number;
}

export type RelayerConfig = EvmRelayerConfig | NearRelayerConfig;

const NEAR_MAX_PAGE = 100;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export type Env = Readonly<Record<string, string | undefined>>;

export function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is required`);
  return value;
}

export function optional(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

export function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = optional(env, key, String(fallback));
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be a positive integer, got "${raw}"`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigError(`${key} must be a positive integer, got "${raw}"`);
  return value;
}

function nonNegativeBigInt(env: Env, key: string, fallback: string): bigint {
  const raw = optional(env, key, fallback);
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${key} must be a non-negative integer, got "${raw}"`);
  return BigInt(raw);
}

export function address(env: Env, key: string): Address {
  const raw = required(env, key);
  if (!isAddress(raw, { strict: false })) throw new ConfigError(`${key} is not an EVM address`);
  return getAddress(raw);
}

export function serviceUrl(env: Env, key: string, fallback?: string): string {
  const raw = fallback === undefined ? required(env, key) : optional(env, key, fallback);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${key} is not a valid URL`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !local) throw new ConfigError(`${key} must use https`);
  return raw.replace(/\/+$/, "");
}

function nearSecretKey(env: Env, key: string): string {
  const raw = required(env, key);
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(raw)) throw new ConfigError(`${key} must be an ed25519:<base58> secret key`);
  return raw;
}

function maxFeeGwei(env: Env): bigint {
  const raw = optional(env, "MAX_FEE_GWEI", "2");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new ConfigError(`MAX_FEE_GWEI must be a decimal number, got "${raw}"`);
  const value = parseGwei(raw);
  if (value <= 0n) throw new ConfigError("MAX_FEE_GWEI must be positive");
  return value;
}

/**
 * Base runs on the env names of the live deployment; other EVM sources use the EVM_* names.
 * The first name that is set wins, so an Arbitrum env file never has to call its RPC "BASE".
 */
export function firstSet(env: Env, keys: readonly string[]): string {
  const key = keys.find((k) => env[k]?.trim());
  if (!key) throw new ConfigError(`${keys.join(" or ")} is required`);
  return key;
}

export function sourceName(env: Env, key: string, fallback: SourceName): SourceName {
  const raw = optional(env, key, fallback);
  if (!isSourceName(raw)) throw new ConfigError(`${key} must be one of base, arbitrum, near, got "${raw}"`);
  return raw;
}

function testnetAccount(env: Env, key: string): string {
  const value = required(env, key);
  if (!value.endsWith(".testnet")) throw new ConfigError(`${key} must be a testnet account`);
  return value;
}

function common(env: Env, source: SourceName, chain: string): CommonRelayerConfig {
  return {
    source,
    chain,
    nearRpcUrl: serviceUrl(env, "NEAR_RPC_URL"),
    nearAiBaseUrl: serviceUrl(env, "NEAR_AI_BASE_URL", "https://cloud-api.near.ai"),
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    phalaBaseUrl: serviceUrl(env, "PHALA_BASE_URL", "https://api.redpill.ai"),
    phalaApiKey: env.PHALA_API_KEY?.trim() || null,
    nearRelayerAccount: required(env, "NEAR_RELAYER_ACCOUNT"),
    nearRelayerKey: nearSecretKey(env, "NEAR_RELAYER_KEY"),
    nearOracleContract: source === "near" ? testnetAccount(env, "NEAR_ORACLE_CONTRACT") : required(env, "NEAR_ORACLE_CONTRACT"),
    pollMs: positiveInt(env, "POLL_MS", 5000),
    fulfillGasTera: positiveInt(env, "FULFILL_GAS_TGAS", 200),
    dailyModelBudget: positiveInt(env, "DAILY_MODEL_BUDGET", 300),
    perAddressHourlyLimit: positiveInt(env, "PER_ADDRESS_HOURLY_LIMIT", 5),
    modelRetries: positiveInt(env, "MODEL_RETRIES", 3),
    mpcRetries: positiveInt(env, "MPC_RETRIES", 3),
    stuckMs: positiveInt(env, "STUCK_MS", 1_800_000),
    maxQueue: positiveInt(env, "MAX_QUEUE", 50),
    dbPath: optional(env, "DB_PATH", source === "base" ? "data/relayer.sqlite" : `data/relayer-${source}.sqlite`),
  };
}

/**
 * A non-Base EVM process often shares the env file of the live Base relayer. Reading `BASE_*`
 * there would quietly run it on Base's chain and RPC with an `arbitrum` cursor, so the Base
 * names are honoured only for `SOURCE=base`, a non-Base chain id must match its source, and a fresh
 * non-Base database must say where to start scanning instead of walking from genesis.
 */
function loadEvmConfig(env: Env, source: SourceName): EvmRelayerConfig {
  const isBase = source === "base";
  const chainKeys = isBase ? ["EVM_CHAIN_ID", "BASE_CHAIN_ID"] : ["EVM_CHAIN_ID"];
  const chainKey = chainKeys.find((k) => env[k]?.trim());
  const expectedChainId = SOURCES[source].defaultChainId;
  if (!chainKey && expectedChainId === undefined) throw new ConfigError(`EVM_CHAIN_ID is required for SOURCE=${source}`);
  const evmChainId = chainKey ? positiveInt(env, chainKey, 1) : (expectedChainId as number);
  if (!isBase && expectedChainId !== undefined && evmChainId !== expectedChainId) {
    throw new ConfigError(`SOURCE=${source} runs on chain ${expectedChainId}, got ${evmChainId}`);
  }
  if (!isBase && !env.START_BLOCK?.trim()) throw new ConfigError(`START_BLOCK is required for SOURCE=${source}`);
  return {
    ...common(env, source, evmChainKey(evmChainId)),
    kind: "evm",
    evmRpcUrl: serviceUrl(env, isBase ? firstSet(env, ["EVM_RPC_URL", "BASE_RPC_URL"]) : "EVM_RPC_URL"),
    aiOracleAddress: address(env, "AIORACLE_ADDRESS"),
    oracleEvmAddress: address(env, "ORACLE_EVM_ADDRESS"),
    evmChainId,
    startBlock: nonNegativeBigInt(env, "START_BLOCK", "0"),
    confirmations: positiveInt(env, "CONFIRMATIONS", 10),
    logBlockRange: BigInt(positiveInt(env, "LOG_BLOCK_RANGE", 200)),
    maxFeePerGas: maxFeeGwei(env),
    receiptAlertMs: positiveInt(env, "RECEIPT_ALERT_MS", 120000),
    feeBaseMultiplier: positiveInt(env, "FEE_BASE_MULTIPLIER", 4),
  };
}

function loadNearConfig(env: Env): NearRelayerConfig {
  const pageSize = positiveInt(env, "NEAR_PAGE_SIZE", NEAR_MAX_PAGE);
  if (pageSize > NEAR_MAX_PAGE) throw new ConfigError(`NEAR_PAGE_SIZE must be at most ${NEAR_MAX_PAGE}, the contract page limit`);
  return { ...common(env, "near", NEAR_TESTNET_CHAIN), kind: "near", startId: positiveInt(env, "NEAR_START_ID", 1), pageSize };
}

export function loadConfig(env: Env): RelayerConfig {
  const source = sourceName(env, "SOURCE", "base");
  return SOURCES[source].kind === "near" ? loadNearConfig(env) : loadEvmConfig(env, source);
}
