import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { useReadContract, useReadContracts, useTransactionReceipt } from "wagmi";
import { aiOracleAbi, disputeAbi } from "./abi.js";
import { createApi, type Api, type RequestDetail, type RequestStatus } from "./api.js";
import { AIORACLE_ADDRESS, API_URL, CHAIN, DISPUTE_ADDRESS } from "./deployment.js";
import { settlementWinner, type CaseInfo } from "./lib/steps.js";

const LIVE_POLL_MS = 3_000;
const CASE_POLL_MS = 4_000;
const PAGE_SIZE = 20;

const ApiContext = createContext<Api>(createApi(API_URL));
export const ApiProvider = ApiContext.Provider;

export function useApi(): Api {
  return useContext(ApiContext);
}

const FINAL_STATUSES: ReadonlySet<string> = new Set(["confirmed", "failed", "rejected"]);

/**
 * Base settles the case as soon as the answer transaction is mined, while the relayer records the
 * receipt a few seconds later. Polling therefore follows the request status in the API, not the
 * on-chain case, or the page would freeze one step short of the end.
 */
export function detailPollInterval(detail: RequestDetail | null | undefined): number | false {
  return detail && FINAL_STATUSES.has(detail.status) ? false : LIVE_POLL_MS;
}

export function useRequestDetail(id: number, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["request", id], queryFn: () => api.request(id), enabled, refetchInterval: (q) => detailPollInterval(q.state.data) });
}

export function useVerifyPlan(id: number, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["verify", id], queryFn: () => api.verify(id), enabled });
}

export function useRequestPages(status: RequestStatus | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ["requests", status ?? "all"],
    queryFn: ({ pageParam }) => api.requests({ limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }), ...(status ? { status } : {}) }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
}

export function useModels() {
  const api = useApi();
  return useQuery({ queryKey: ["models"], queryFn: () => api.models(), staleTime: 60_000 });
}

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
