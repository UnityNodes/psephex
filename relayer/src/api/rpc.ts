import { getAddress, type Address } from "viem";
import { withTimeout, type OracleConfig } from "../near.js";
import type { SourceName } from "../sources.js";
import type { ModelInfo } from "../types.js";
import type { ChainReader } from "./chain.js";
import type { ApiSource } from "./config.js";

export interface EvmReader {
  headBlock(): Promise<bigint>;
  balance(address: Address): Promise<bigint>;
}

export interface RpcReaderDeps {
  readonly evm: Readonly<Partial<Record<SourceName, EvmReader>>>;
  readonly near: { models(): Promise<ModelInfo[]>; nearFee(): Promise<bigint>; lastNearRequestId(): Promise<number> };
  readonly nearRpc: { viewAccount(args: { accountId: string }): Promise<{ amount: bigint }> };
  readonly timeoutMs: number;
}

function evmReader(deps: RpcReaderDeps, source: SourceName): EvmReader {
  const reader = deps.evm[source];
  if (!reader) throw new Error(`no EVM RPC configured for ${source}`);
  return reader;
}

export function createRpcReader(deps: RpcReaderDeps): ChainReader {
  return {
    head: async (source) => (source === "near" ? BigInt(await deps.near.lastNearRequestId()) : evmReader(deps, source).headBlock()),
    evmBalance: (source, address) => evmReader(deps, source).balance(address),
    nearBalance: async (accountId) => (await withTimeout(deps.nearRpc.viewAccount({ accountId }), deps.timeoutMs, "view account")).amount,
    nearFee: () => deps.near.nearFee(),
    models: () => deps.near.models(),
  };
}

export interface TargetCheckDeps {
  readonly evm: Readonly<Partial<Record<SourceName, { assertChain(): Promise<void> }>>>;
  readonly near: { config(): Promise<Pick<OracleConfig, "chains" | "nearChain">> };
  readonly sources: readonly ApiSource[];
}

/**
 * /verify hands out commands against these addresses. If the API pointed at another AiOracle
 * or chain than the NEAR contract signs for, every command would check the wrong contract.
 */
export async function checkApiTargets({ evm, near, sources }: TargetCheckDeps): Promise<void> {
  const target = await near.config();
  for (const s of sources) {
    if (s.kind === "near") {
      if (target.nearChain !== s.chain) throw new Error(`NEAR contract serves ${target.nearChain}, API is configured for ${s.chain}`);
      continue;
    }
    const rpc = evm[s.source];
    if (!rpc) throw new Error(`no EVM RPC configured for ${s.source}`);
    await rpc.assertChain();
    const entry = target.chains.find((c) => c.chain === s.chain);
    if (!entry) throw new Error(`NEAR contract has no chain ${s.chain} for source ${s.source}`);
    const signed = getAddress(`0x${entry.oracleAddress.replace(/^0x/, "")}`);
    if (signed !== getAddress(s.aiOracleAddress)) throw new Error(`NEAR contract signs for AiOracle ${signed} on ${s.chain}, API is configured for ${s.aiOracleAddress}`);
  }
}
