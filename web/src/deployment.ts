import { baseSepolia } from "viem/chains";

export const CHAIN = baseSepolia;
export { AIORACLE_ADDRESS, DISPUTE_ADDRESS, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS } from "./contracts.js";
export const FAUCET_URL = "https://docs.base.org/get-started/get-funds";

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NEAR_TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
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

/**
 * Hashes and addresses come from the API. Explorer links are only built from values of the
 * exact expected shape, so a malformed value cannot steer a link somewhere else.
 */
export const explorer = {
  baseTx: (hash: string): string | null => (EVM_TX.test(hash) ? `https://sepolia.basescan.org/tx/${hash}` : null),
  baseAddress: (address: string): string | null => (EVM_ADDRESS.test(address) ? `https://sepolia.basescan.org/address/${address}` : null),
  nearTx: (hash: string): string | null => (NEAR_TX.test(hash) ? `https://testnet.nearblocks.io/txns/${hash}` : null),
  nearAccount: (account: string): string => `https://testnet.nearblocks.io/address/${encodeURIComponent(account)}`,
};
