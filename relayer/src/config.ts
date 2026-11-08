import { getAddress, isAddress, parseGwei, type Address } from "viem";

export interface RelayerConfig {
  readonly baseRpcUrl: string;
  readonly nearRpcUrl: string;
  readonly nearAiBaseUrl: string;
  readonly nearAiApiKey: string;
  readonly nearRelayerAccount: string;
  readonly nearRelayerKey: string;
  readonly nearOracleContract: string;
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly baseChainId: number;
  readonly startBlock: bigint;
  readonly confirmations: number;
  readonly pollMs: number;
  readonly logBlockRange: bigint;
  readonly maxFeePerGas: bigint;
  readonly fulfillGasTera: number;
  readonly dailyModelBudget: number;
  readonly perAddressHourlyLimit: number;
  readonly modelRetries: number;
  readonly mpcRetries: number;
  readonly receiptAlertMs: number;
  readonly stuckMs: number;
  readonly maxQueue: number;
  readonly feeBaseMultiplier: number;
  readonly dbPath: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is required`);
  return value;
}

function optional(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

function positiveInt(env: Env, key: string, fallback: number): number {
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

function address(env: Env, key: string): Address {
  const raw = required(env, key);
  if (!isAddress(raw, { strict: false })) throw new ConfigError(`${key} is not an EVM address`);
  return getAddress(raw);
}

function serviceUrl(env: Env, key: string, fallback?: string): string {
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

export function loadConfig(env: Env): RelayerConfig {
  return {
    baseRpcUrl: serviceUrl(env, "BASE_RPC_URL"),
    nearRpcUrl: serviceUrl(env, "NEAR_RPC_URL"),
    nearAiBaseUrl: serviceUrl(env, "NEAR_AI_BASE_URL", "https://cloud-api.near.ai"),
    nearAiApiKey: required(env, "NEAR_AI_API_KEY"),
    nearRelayerAccount: required(env, "NEAR_RELAYER_ACCOUNT"),
    nearRelayerKey: nearSecretKey(env, "NEAR_RELAYER_KEY"),
    nearOracleContract: required(env, "NEAR_ORACLE_CONTRACT"),
    aiOracleAddress: address(env, "AIORACLE_ADDRESS"),
    oracleEvmAddress: address(env, "ORACLE_EVM_ADDRESS"),
    baseChainId: positiveInt(env, "BASE_CHAIN_ID", 84532),
    startBlock: nonNegativeBigInt(env, "START_BLOCK", "0"),
    confirmations: positiveInt(env, "CONFIRMATIONS", 3),
    pollMs: positiveInt(env, "POLL_MS", 5000),
    logBlockRange: BigInt(positiveInt(env, "LOG_BLOCK_RANGE", 200)),
    maxFeePerGas: maxFeeGwei(env),
    fulfillGasTera: positiveInt(env, "FULFILL_GAS_TGAS", 200),
    dailyModelBudget: positiveInt(env, "DAILY_MODEL_BUDGET", 300),
    perAddressHourlyLimit: positiveInt(env, "PER_ADDRESS_HOURLY_LIMIT", 5),
    modelRetries: positiveInt(env, "MODEL_RETRIES", 3),
    mpcRetries: positiveInt(env, "MPC_RETRIES", 3),
    receiptAlertMs: positiveInt(env, "RECEIPT_ALERT_MS", 120000),
    stuckMs: positiveInt(env, "STUCK_MS", 1_800_000),
    maxQueue: positiveInt(env, "MAX_QUEUE", 50),
    feeBaseMultiplier: positiveInt(env, "FEE_BASE_MULTIPLIER", 4),
    dbPath: optional(env, "DB_PATH", "data/relayer.sqlite"),
  };
}
