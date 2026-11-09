import { useReadContract, useReadContracts, useTransactionReceipt } from "wagmi";
import { aiOracleAbi, disputeAbi } from "./abi.js";
import { CHAIN } from "./chain.js";
import { AIORACLE_ADDRESS, DISPUTE_ADDRESS } from "./deployment.js";
import { settlementWinner, type CaseInfo } from "./lib/steps.js";

const CASE_POLL_MS = 4_000;

export function useCase(id: number, enabled: boolean): { data: CaseInfo | null; isLoading: boolean; refetch: () => unknown } {
  const result = useReadContract({
    address: DISPUTE_ADDRESS,
    abi: disputeAbi,
    functionName: "getCase",
    args: [BigInt(id)],
    chainId: CHAIN.id,
    query: { enabled, refetchInterval: (q) => (q.state.data?.settled ? false : CASE_POLL_MS) },
  });
  const c = result.data;
  return {
    data: c ? { claimant: c.claimant, counterparty: c.counterparty, amount: c.amount, deadline: BigInt(c.deadline), escalated: c.escalated, settled: c.settled } : null,
    isLoading: result.isLoading,
    refetch: result.refetch,
  };
}

export function useChainQuestionHash(id: number, enabled: boolean): string | undefined {
  const result = useReadContract({ address: AIORACLE_ADDRESS, abi: aiOracleAbi, functionName: "getRequest", args: [BigInt(id)], chainId: CHAIN.id, query: { enabled } });
  return result.data?.questionHash;
}

export function useSettlementWinner(baseTxHash: string | undefined, id: number): string | null {
  const receipt = useTransactionReceipt({ hash: baseTxHash as `0x${string}` | undefined, chainId: CHAIN.id, query: { enabled: baseTxHash !== undefined } });
  return receipt.data ? settlementWinner(receipt.data.logs, id) : null;
}

export function useDisputeLimits() {
  const result = useReadContracts({
    contracts: [
      { address: AIORACLE_ADDRESS, abi: aiOracleAbi, functionName: "fee", chainId: CHAIN.id },
      { address: AIORACLE_ADDRESS, abi: aiOracleAbi, functionName: "maxQuestionBytes", chainId: CHAIN.id },
      { address: DISPUTE_ADDRESS, abi: disputeAbi, functionName: "minStake", chainId: CHAIN.id },
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
