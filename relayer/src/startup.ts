import { baseDecode } from "near-api-js";
import { getAddress, keccak256, toHex, type Address } from "viem";

export interface StartupNear {
  config(): Promise<{ base_oracle_address: string; base_chain_id: number; signer: string; path: string }>;
  derivedPublicKey(signer: string, path: string, predecessor: string): Promise<string>;
  relayerKeyPermission(): Promise<unknown>;
}

export interface StartupBase {
  assertChain(): Promise<void>;
  fee(): Promise<bigint>;
}

const MIN_ALLOWANCE_YOCTO = 10n ** 22n;
const FULFILL_METHOD = "fulfill_on_base";

export interface StartupSettings {
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly baseChainId: number;
  readonly nearOracleContract: string;
}

export interface StartupDeps {
  readonly near: StartupNear;
  readonly base: StartupBase;
  readonly settings: StartupSettings;
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
 * redeploy or drain the oracle account. Only a function-call key limited to fulfill_on_base
 * on our contract is accepted, and an almost spent allowance is caught before requests stall.
 */
export function checkRelayerPermission(permission: unknown, contractId: string): void {
  if (permission === "FullAccess") throw new Error("relayer key has full access; use a function-call key limited to fulfill_on_base");
  const call = field(permission, "FunctionCall");
  const receiver = field(call, "receiver_id");
  const methods = field(call, "method_names");
  if (receiver !== contractId) throw new Error(`relayer key is limited to ${String(receiver)}, expected ${contractId}`);
  if (!Array.isArray(methods) || methods.length !== 1 || methods[0] !== FULFILL_METHOD) {
    throw new Error(`relayer key methods ${JSON.stringify(methods)}, expected ["${FULFILL_METHOD}"]`);
  }
  const allowance = field(call, "allowance");
  if (typeof allowance === "string" && /^\d+$/.test(allowance) && BigInt(allowance) < MIN_ALLOWANCE_YOCTO) {
    throw new Error(`relayer key allowance ${allowance} yocto is almost spent`);
  }
}

export async function startupChecks({ near, base, settings }: StartupDeps): Promise<void> {
  await base.assertChain();
  const fee = await base.fee();
  if (fee <= 0n) throw new Error("AiOracle fee is 0; every ask would cost the oracle model calls and gas for free");
  checkRelayerPermission(await near.relayerKeyPermission(), settings.nearOracleContract);
  const config = await near.config();
  const target = getAddress(`0x${config.base_oracle_address.replace(/^0x/, "")}`);
  if (target !== getAddress(settings.aiOracleAddress)) {
    throw new Error(`NEAR contract signs for AiOracle ${target}, relayer is configured for ${settings.aiOracleAddress}`);
  }
  if (config.base_chain_id !== settings.baseChainId) {
    throw new Error(`NEAR contract targets chain ${config.base_chain_id}, relayer is configured for ${settings.baseChainId}`);
  }
  const derived = evmAddressFromDerivedKey(await near.derivedPublicKey(config.signer, config.path, settings.nearOracleContract));
  if (derived !== getAddress(settings.oracleEvmAddress)) {
    throw new Error(`MPC derived oracle address ${derived} differs from ORACLE_EVM_ADDRESS ${settings.oracleEvmAddress}`);
  }
}
