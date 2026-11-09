export interface Config {
  readonly rpcUrl: string;
  readonly court: string;
  readonly oracle: string;
  readonly apiUrl: string;
  readonly accountId: string | null;
  readonly privateKey: string | null;
  readonly maxStakeYocto: bigint;
  readonly budgetYocto: bigint;
  readonly allowedCounterparties: readonly string[] | null;
  readonly trustedTokens: readonly string[];
}

const TESTNET_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

type Env = Readonly<Record<string, string | undefined>>;

const YOCTO = 10n ** 24n;
const DECIMAL = /^(0|[1-9]\d*)(\.\d{1,24})?$/;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function parseNear(text: string): bigint | null {
  const raw = text.trim();
  if (!DECIMAL.test(raw)) return null;
  const [whole = "0", frac = ""] = raw.split(".");
  return BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, "0"));
}

export function formatNear(yocto: bigint): string {
  const whole = yocto / YOCTO;
  const frac = (yocto % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function isAccountId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && ACCOUNT.test(value);
}

function url(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim() || fallback;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") throw new Error(`${key} must use https`);
  return value.replace(/\/$/, "");
}

function accounts(env: Env, key: string): string[] | null {
  const raw = env[key]?.trim();
  if (!raw) return null;
  const list = raw.split(",").map((a) => a.trim()).filter(Boolean);
  for (const a of list) if (!isAccountId(a)) throw new Error(`${key} has an invalid account id: ${a}`);
  return list;
}

/**
 * An agent runs this server with its own NEAR key, and the model driving it can be talked into
 * anything by text it reads. The per-call cap and the per-process budget bound what repeated
 * prompt-injected calls can spend, an optional allowlist pins who the agent may sue, and
 * without a key every write tool refuses instead of failing halfway.
 */
export function loadConfig(env: Env): Config {
  const accountId = env.NEAR_ACCOUNT_ID?.trim() || null;
  const privateKey = env.NEAR_PRIVATE_KEY?.trim() || null;
  if ((accountId === null) !== (privateKey === null)) throw new Error("set both NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY, or neither for read-only use");
  if (accountId !== null && !isAccountId(accountId)) throw new Error("NEAR_ACCOUNT_ID is not a NEAR account id");
  const maxStake = parseNear(env.PSEPHEX_MAX_STAKE_NEAR?.trim() || "0.5");
  if (maxStake === null || maxStake <= 0n) throw new Error("PSEPHEX_MAX_STAKE_NEAR must be a positive NEAR amount");
  const budget = parseNear(env.PSEPHEX_BUDGET_NEAR?.trim() || "1");
  if (budget === null || budget <= 0n) throw new Error("PSEPHEX_BUDGET_NEAR must be a positive NEAR amount");
  return {
    rpcUrl: url(env, "NEAR_RPC_URL", "https://rpc.testnet.fastnear.com"),
    court: env.PSEPHEX_COURT?.trim() || "psephex-court.testnet",
    oracle: env.PSEPHEX_ORACLE?.trim() || "oracle.psephex.testnet",
    apiUrl: url(env, "PSEPHEX_API_URL", "https://psephex.xyz/api"),
    accountId,
    privateKey,
    maxStakeYocto: maxStake,
    budgetYocto: budget,
    allowedCounterparties: accounts(env, "PSEPHEX_ALLOWED_COUNTERPARTIES"),
    trustedTokens: accounts(env, "PSEPHEX_TRUSTED_TOKENS") ?? [TESTNET_USDC, "wrap.testnet"],
  };
}
