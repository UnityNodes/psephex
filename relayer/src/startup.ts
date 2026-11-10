import { baseDecode } from "near-api-js";
import { getAddress, keccak256, toHex, type Address } from "viem";
import { FULFILL_EVM_METHOD, FULFILL_NEAR_METHOD, type OracleConfig } from "./near.js";

export interface StartupNear {
  config(): Promise<OracleConfig>;
  derivedPublicKey(signer: string, path: string, predecessor: string): Promise<string>;
  relayerKeyPermission(): Promise<unknown>;
}

export interface StartupBase {
  assertChain(): Promise<void>;
  fee(): Promise<bigint>;
}

const MIN_ALLOWANCE_YOCTO = 10n ** 22n;
const RELAYER_METHODS: readonly string[] = [FULFILL_EVM_METHOD, FULFILL_NEAR_METHOD];

export interface StartupSettings {
  readonly chain: string;
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly nearOracleContract: string;
}

export interface StartupDeps {
  readonly near: StartupNear;
  readonly base: StartupBase;
  readonly settings: StartupSettings;
}

export interface NearStartupDeps {
  readonly near: Pick<StartupNear, "config" | "relayerKeyPermission">;
  readonly settings: { readonly chain: string; readonly nearOracleContract: string };
}

export function evmAddressFromDerivedKey(derived: string): Address {
  const [scheme, encoded] = derived.split(":");
  if (scheme !== "secp256k1" || !encoded) throw new Error(`derived key is not secp256k1: ${derived}`);
  const xy = baseDecode(encoded);
  if (xy.length !== 64) throw new Error(`derived key must be 64 bytes, got ${xy.length}`);
  return getAddress(`0x${keccak256(toHex(xy)).slice(-40)}`);
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * The relayer runs on a server; a full-access NEAR key there would let a server compromise
 * redeploy or drain the oracle account. Only a function-call key on our contract limited to the
 * relayer methods (fulfill_on_evm, fulfill_on_near) and holding the one this process sends is
 * accepted, and an almost spent allowance is caught before requests stall.
 */
export function checkRelayerPermission(permission: unknown, contractId: string, method: string): void {
  if (permission === "FullAccess") throw new Error(`relayer key has full access; use a function-call key limited to ${method}`);
  const call = field(permission, "FunctionCall");
  const receiver = field(call, "receiver_id");
  const methods = field(call, "method_names");
  if (receiver !== contractId) throw new Error(`relayer key is limited to ${String(receiver)}, expected ${contractId}`);
  const allowed = Array.isArray(methods) && methods.includes(method) && methods.every((m) => RELAYER_METHODS.includes(String(m)));
  if (!allowed) throw new Error(`relayer key methods ${JSON.stringify(methods)}, expected "${method}" and nothing beyond ${JSON.stringify(RELAYER_METHODS)}`);
  const allowance = field(call, "allowance");
  if (typeof allowance === "string" && /^\d+$/.test(allowance) && BigInt(allowance) < MIN_ALLOWANCE_YOCTO) {
    throw new Error(`relayer key allowance ${allowance} yocto is almost spent`);
  }
}

export async function startupChecks({ near, base, settings }: StartupDeps): Promise<void> {
  await base.assertChain();
  const fee = await base.fee();
  if (fee <= 0n) throw new Error("AiOracle fee is 0; every ask would cost the oracle model calls and gas for free");
  checkRelayerPermission(await near.relayerKeyPermission(), settings.nearOracleContract, FULFILL_EVM_METHOD);
  const config = await near.config();
  const entry = config.chains.find((c) => c.chain === settings.chain);
  if (!entry) throw new Error(`NEAR contract has no chain ${settings.chain}; the owner announces it with propose and runs it after the delay`);
  const target = getAddress(`0x${entry.oracleAddress.replace(/^0x/, "")}`);
  if (target !== getAddress(settings.aiOracleAddress)) {
    throw new Error(`NEAR contract signs for AiOracle ${target} on ${settings.chain}, relayer is configured for ${settings.aiOracleAddress}`);
  }
  const derived = evmAddressFromDerivedKey(await near.derivedPublicKey(config.signer, config.path, settings.nearOracleContract));
  if (derived !== getAddress(settings.oracleEvmAddress)) {
    throw new Error(`MPC derived oracle address ${derived} differs from ORACLE_EVM_ADDRESS ${settings.oracleEvmAddress}`);
  }
}

export async function nearStartupChecks({ near, settings }: NearStartupDeps): Promise<void> {
  checkRelayerPermission(await near.relayerKeyPermission(), settings.nearOracleContract, FULFILL_NEAR_METHOD);
  const config = await near.config();
  if (config.nearChain !== settings.chain) throw new Error(`NEAR contract serves ${config.nearChain}, relayer is configured for ${settings.chain}`);
  if (config.nearFee <= 0n) throw new Error("NEAR ask fee is 0; every ask would cost the oracle model calls for free");
}
