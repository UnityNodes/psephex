import { useQuery } from "@tanstack/react-query";
import { NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT } from "../deployment.js";
import type { CaseInfo } from "../lib/steps.js";
import { NearRpcError, useNearRpc } from "./rpc.js";

const CASE_POLL_MS = 4_000;
const NS_PER_SECOND = 1_000_000_000n;

export interface NearCase {
  readonly claimant: string;
  readonly counterparty: string;
  readonly amount: string;
  readonly oracle_deposit: string;
  readonly deadline_ns: string;
  readonly question: string;
  readonly escalated: boolean;
  readonly settled: boolean;
  readonly winner: string | null;
}

interface RawNearRequest {
  readonly question_hash: string;
  readonly asker?: string;
}

export function caseInfoFrom(c: NearCase): CaseInfo {
  return { claimant: c.claimant, counterparty: c.counterparty, amount: BigInt(c.amount), deadline: BigInt(c.deadline_ns) / NS_PER_SECOND, escalated: c.escalated, settled: c.settled };
}

const YOCTO_PER_NEAR = 10n ** 24n;
const MAX_ORACLE_FEE = YOCTO_PER_NEAR;
const MAX_STORAGE_PART = YOCTO_PER_NEAR / 20n;

/**
 * The deposit the wallet signs for comes from the NEAR RPC, so a wrong or hostile RPC could ask
 * for any amount. The oracle contract caps its fee at 1 NEAR and a 2000-byte question needs well
 * under 0.05 NEAR of storage in either contract, so anything above those bounds is refused here.
 */
export function checkNearPrices(prices: { askDeposit: bigint; storageDeposit: bigint }): { askDeposit: bigint; storageDeposit: bigint } {
  if (prices.askDeposit <= 0n || prices.askDeposit > MAX_ORACLE_FEE + MAX_STORAGE_PART) throw new NearRpcError("NEAR RPC returned an oracle deposit outside the contract limits");
  if (prices.storageDeposit < 0n || prices.storageDeposit > MAX_STORAGE_PART) throw new NearRpcError("NEAR RPC returned a storage deposit outside the contract limits");
  return prices;
}

export function useNearCase(id: number, enabled: boolean) {
  const rpc = useNearRpc();
  const result = useQuery({
    queryKey: ["near", "case", id],
    queryFn: () => rpc.view<NearCase | null>(NEAR_DISPUTE_CONTRACT, "get_case", { request_id: id }),
    enabled,
    refetchInterval: (q) => (q.state.data?.settled ? false : CASE_POLL_MS),
  });
  const raw = result.data ?? null;
  return { data: raw ? caseInfoFrom(raw) : null, winner: raw?.winner ?? null, isLoading: result.isLoading, refetch: result.refetch };
}

function useNearRequest(id: number, enabled: boolean) {
  const rpc = useNearRpc();
  return useQuery({ queryKey: ["near", "request", id], queryFn: () => rpc.view<RawNearRequest | null>(NEAR_ORACLE_CONTRACT, "near_request", { request_id: id }), enabled });
}

export function useNearQuestionHash(id: number, enabled: boolean): string | undefined {
  return useNearRequest(id, enabled).data?.question_hash;
}

export function useNearAsker(id: number, enabled: boolean): string | undefined {
  return useNearRequest(id, enabled).data?.asker;
}
