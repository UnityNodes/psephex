import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT } from "../deployment.js";
import type { NearDisputeConfig } from "../lib/near-dispute.js";
import type { CaseInfo } from "../lib/steps.js";
import { useNearRpc, type NearRpc } from "./rpc.js";

const CASE_POLL_MS = 4_000;
const PRICE_DEBOUNCE_MS = 350;
const NS_PER_SECOND = 1_000_000_000n;

interface RawConfig {
  readonly oracle: string;
  readonly timeout_sec: number;
  readonly min_stake: string;
}

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
}

export function caseInfoFrom(c: NearCase): CaseInfo {
  return { claimant: c.claimant, counterparty: c.counterparty, amount: BigInt(c.amount), deadline: BigInt(c.deadline_ns) / NS_PER_SECOND, escalated: c.escalated, settled: c.settled };
}

export async function readNearPrices(rpc: NearRpc, question: string): Promise<{ askDeposit: bigint; storageDeposit: bigint }> {
  const [ask, storage] = await Promise.all([
    rpc.view<string>(NEAR_ORACLE_CONTRACT, "ask_deposit", { question }),
    rpc.view<string>(NEAR_DISPUTE_CONTRACT, "storage_deposit", { question }),
  ]);
  return { askDeposit: BigInt(ask), storageDeposit: BigInt(storage) };
}

function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}

export function useNearDisputeConfig() {
  const rpc = useNearRpc();
  return useQuery({
    queryKey: ["near", "dispute-config"],
    queryFn: async (): Promise<NearDisputeConfig> => {
      const c = await rpc.view<RawConfig>(NEAR_DISPUTE_CONTRACT, "config", {});
      return { minStake: BigInt(c.min_stake), timeoutSec: c.timeout_sec };
    },
    staleTime: 60_000,
  });
}

export function useNearPrices(question: string) {
  const rpc = useNearRpc();
  const debounced = useDebounced(question, PRICE_DEBOUNCE_MS);
  return useQuery({ queryKey: ["near", "prices", debounced], queryFn: () => readNearPrices(rpc, debounced), enabled: debounced.length > 0, placeholderData: (prev) => prev });
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

export function useNearQuestionHash(id: number, enabled: boolean): string | undefined {
  const rpc = useNearRpc();
  const result = useQuery({ queryKey: ["near", "request", id], queryFn: () => rpc.view<RawNearRequest | null>(NEAR_ORACLE_CONTRACT, "near_request", { request_id: id }), enabled });
  return result.data?.question_hash;
}
