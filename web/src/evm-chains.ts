import type { Address } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { AIORACLE_ADDRESS, ARBITRUM_AI_ORACLE, ARBITRUM_DISPUTE, ARBITRUM_FAUCET_URL, ARBITRUM_RPC_URL, BASE_RPC_URL, DISPUTE_ADDRESS, FAUCET_URL } from "./deployment.js";
import type { EvmSource } from "./sources.js";

export type EvmChain = typeof baseSepolia | typeof arbitrumSepolia;

export interface EvmChainConfig {
  readonly source: EvmSource;
  readonly chain: EvmChain;
  readonly aiOracle: Address;
  readonly dispute: Address;
  readonly rpcUrl: string;
  readonly faucetUrl: string;
}

export const BASE: EvmChainConfig = { source: "base", chain: baseSepolia, aiOracle: AIORACLE_ADDRESS, dispute: DISPUTE_ADDRESS, rpcUrl: BASE_RPC_URL, faucetUrl: FAUCET_URL };

export const ARBITRUM: EvmChainConfig | null =
  ARBITRUM_AI_ORACLE && ARBITRUM_DISPUTE
    ? { source: "arbitrum", chain: arbitrumSepolia, aiOracle: ARBITRUM_AI_ORACLE, dispute: ARBITRUM_DISPUTE, rpcUrl: ARBITRUM_RPC_URL, faucetUrl: ARBITRUM_FAUCET_URL }
    : null;

export function evmChain(source: EvmSource): EvmChainConfig | null {
  return source === "base" ? BASE : ARBITRUM;
}
