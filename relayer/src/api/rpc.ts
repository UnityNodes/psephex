import { getAddress, type Address } from "viem";
import { withTimeout } from "../near.js";
import type { ModelInfo } from "../types.js";
import type { ChainReader } from "./chain.js";

export interface RpcReaderDeps {
  readonly base: { headBlock(): Promise<bigint>; balance(address: Address): Promise<bigint> };
  readonly near: { models(): Promise<ModelInfo[]> };
  readonly nearRpc: { viewAccount(args: { accountId: string }): Promise<{ amount: bigint }> };
  readonly timeoutMs: number;
}

export function createRpcReader(deps: RpcReaderDeps): ChainReader {
  return {
    baseHead: () => deps.base.headBlock(),
    baseBalance: (address) => deps.base.balance(address),
    nearBalance: async (accountId) => (await withTimeout(deps.nearRpc.viewAccount({ accountId }), deps.timeoutMs, "view account")).amount,
    models: () => deps.near.models(),
  };
}

export interface TargetCheckDeps {
  readonly base: { assertChain(): Promise<void> };
  readonly near: { config(): Promise<{ base_oracle_address: string; base_chain_id: number }> };
  readonly config: { readonly aiOracleAddress: Address; readonly baseChainId: number };
}

/**
 * /verify hands out commands against these addresses. If the API pointed at another AiOracle
 * or chain than the NEAR contract signs for, every command would check the wrong contract.
 */
export async function checkApiTargets({ base, near, config }: TargetCheckDeps): Promise<void> {
  await base.assertChain();
  const target = await near.config();
  const signed = getAddress(`0x${target.base_oracle_address.replace(/^0x/, "")}`);
  if (signed !== getAddress(config.aiOracleAddress)) throw new Error(`NEAR contract signs for AiOracle ${signed}, API is configured for ${config.aiOracleAddress}`);
  if (target.base_chain_id !== config.baseChainId) throw new Error(`NEAR contract targets chain ${target.base_chain_id}, API is configured for ${config.baseChainId}`);
}
