import { useReadContract, useReadContracts, useTransactionReceipt } from "wagmi";
import { aiOracleAbi, disputeAbi } from "./abi.js";
import type { EvmChainConfig } from "./evm-chains.js";
import { settlementWinner, type CaseInfo } from "./lib/steps.js";

const CASE_POLL_MS = 4_000;

export function useCase(cfg: EvmChainConfig, id: number, enabled: boolean): { data: CaseInfo | null; isLoading: boolean; refetch: () => unknown } {
  const result = useReadContract({
    address: cfg.dispute,
    abi: disputeAbi,
    functionName: "getCase",
    args: [BigInt(id)],
    chainId: cfg.chain.id,
    query: { enabled, refetchInterval: (q) => (q.state.data?.settled ? false : CASE_POLL_MS) },
  });
  const c = result.data;
  return {
    data: c ? { claimant: c.claimant, counterparty: c.counterparty, amount: c.amount, deadline: BigInt(c.deadline), escalated: c.escalated, settled: c.settled } : null,
    isLoading: result.isLoading,
    refetch: result.refetch,
  };
}

export function useChainQuestionHash(cfg: EvmChainConfig, id: number, enabled: boolean): string | undefined {
  const result = useReadContract({ address: cfg.aiOracle, abi: aiOracleAbi, functionName: "getRequest", args: [BigInt(id)], chainId: cfg.chain.id, query: { enabled } });
  return result.data?.questionHash;
}

export function useSettlementWinner(cfg: EvmChainConfig, txHash: string | undefined, id: number): string | null {
  const receipt = useTransactionReceipt({ hash: txHash as `0x${string}` | undefined, chainId: cfg.chain.id, query: { enabled: txHash !== undefined } });
  return receipt.data ? settlementWinner(receipt.data.logs, id, cfg.dispute) : null;
}

export function useDisputeLimits(cfg: EvmChainConfig) {
  const result = useReadContracts({
    contracts: [
      { address: cfg.aiOracle, abi: aiOracleAbi, functionName: "fee", chainId: cfg.chain.id },
      { address: cfg.aiOracle, abi: aiOracleAbi, functionName: "maxQuestionBytes", chainId: cfg.chain.id },
      { address: cfg.dispute, abi: disputeAbi, functionName: "minStake", chainId: cfg.chain.id },
    ],
    allowFailure: false,
  });
  const [fee, maxQuestionBytes, minStake] = result.data ?? [];
  return {
    limits: fee !== undefined && maxQuestionBytes !== undefined && minStake !== undefined ? { fee, maxQuestionBytes: Number(maxQuestionBytes), minStakeWei: minStake } : null,
    error: result.error,
    refetch: result.refetch,
  };
}
