import type { Source } from "./sources.js";

export { AIORACLE_ADDRESS, DISPUTE_ADDRESS, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS } from "./contracts.js";
export const FAUCET_URL = "https://docs.base.org/get-started/get-funds";
export const ARBITRUM_FAUCET_URL = "https://docs.arbitrum.io/chain-info";
export const NEAR_FAUCET_URL = "https://near-faucet.io";
export const NEAR_DISPUTE_CONTRACT = "dispute.psephex.testnet";

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NEAR_TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const ATTESTATION_HOSTS: readonly string[] = ["cloud-api.near.ai", "api.redpill.ai"];

export function httpUrl(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() || fallback;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`expected an http(s) URL, got ${value}`);
  return value.replace(/\/+$/, "");
}

/**
 * The attestation link comes from the API. Only https links to known TEE providers are rendered,
 * so a compromised API cannot plant a javascript: or data: URL behind the attestation button.
 */
export function attestationUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ATTESTATION_HOSTS.includes(url.hostname) ? raw : null;
  } catch {
    return null;
  }
}

export function optionalHttpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export const REPO_URL = optionalHttpsUrl(import.meta.env.VITE_REPO_URL);
export const VIDEO_URL = optionalHttpsUrl(import.meta.env.VITE_VIDEO_URL);

export const API_URL = httpUrl(import.meta.env.VITE_API_URL, "http://127.0.0.1:8790");
export const BASE_RPC_URL = httpUrl(import.meta.env.VITE_BASE_RPC_URL, "https://sepolia.base.org");
export const ARBITRUM_RPC_URL = httpUrl(import.meta.env.VITE_ARBITRUM_RPC_URL, "https://sepolia-rollup.arbitrum.io/rpc");
export const NEAR_RPC_URL = httpUrl(import.meta.env.VITE_NEAR_RPC_URL, "https://rpc.testnet.near.org");

export function isNearAccount(value: string): boolean {
  return NEAR_ACCOUNT.test(value);
}

/**
 * Every new NEAR case sends its stake to the court account, so an override that is not a plain
 * NEAR account id stops the page instead of quietly falling back to the default court.
 */
export function nearAccountOr(raw: string | undefined, fallback: string): string {
  const value = raw?.trim() ?? "";
  if (value === "") return fallback;
  if (!NEAR_ACCOUNT.test(value)) throw new Error(`expected a NEAR account id, got ${value}`);
  return value;
}

export const NEAR_COURT_CONTRACT = nearAccountOr(import.meta.env.VITE_NEAR_COURT_CONTRACT, "psephex-court.testnet");

/**
 * The Arbitrum contracts are deployed separately from this build, so their addresses arrive through
 * the environment. A malformed value would send stakes to the wrong place, so anything that is not
 * a plain 0x address switches the Arbitrum option off instead.
 */
export function evmAddressOrNull(raw: string | undefined): `0x${string}` | null {
  const value = raw?.trim() ?? "";
  return EVM_ADDRESS.test(value) ? (value as `0x${string}`) : null;
}

export const ARBITRUM_AI_ORACLE = evmAddressOrNull(import.meta.env.VITE_ARBITRUM_AI_ORACLE);
export const ARBITRUM_DISPUTE = evmAddressOrNull(import.meta.env.VITE_ARBITRUM_DISPUTE);

/**
 * Hashes and addresses come from the API. Explorer links are only built from values of the
 * exact expected shape, so a malformed value cannot steer a link somewhere else.
 */
const EVM_EXPLORER: Readonly<Record<Exclude<Source, "near">, string>> = { base: "https://sepolia.basescan.org", arbitrum: "https://sepolia.arbiscan.io" };

export const explorer = {
  baseTx: (hash: string): string | null => (EVM_TX.test(hash) ? `https://sepolia.basescan.org/tx/${hash}` : null),
  baseAddress: (address: string): string | null => (EVM_ADDRESS.test(address) ? `https://sepolia.basescan.org/address/${address}` : null),
  nearTx: (hash: string): string | null => (NEAR_TX.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null),
  nearAccount: (account: string): string => `https://testnet.nearblocks.io/address/${encodeURIComponent(account)}`,
  tx: (source: Source, hash: string): string | null => {
    if (source === "near") return NEAR_TX.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null;
    return EVM_TX.test(hash) ? `${EVM_EXPLORER[source]}/tx/${hash}` : null;
  },
  address: (source: Source, address: string): string | null => {
    if (source === "near") return NEAR_ACCOUNT.test(address) ? `https://testnet.nearblocks.io/address/${address}` : null;
    return EVM_ADDRESS.test(address) ? `${EVM_EXPLORER[source]}/address/${address}` : null;
  },
};
