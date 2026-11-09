import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { isNearAccount, NEAR_COURT_CONTRACT } from "../deployment.js";
import { courtConfigFrom, FINAL_STAGES, WORST_CASE_QUESTION, type CourtCase, type CourtCaseView, type CourtConfig, type RawCourtConfig } from "../lib/court.js";
import { checkNearPrices } from "./hooks.js";
import { NearRpcError, useNearRpc, type NearRpc } from "./rpc.js";

const CASE_POLL_MS = 4_000;
const LIST_POLL_MS = 15_000;
const PRICE_DEBOUNCE_MS = 350;
const CLOCK_MS = 1_000;
export const RECENT_CASES = 10;
export const CASES_PAGE = 50;
export const MAX_CASE_PAGES = 40;

export interface CasePrices {
  readonly oracleReserve: bigint;
  readonly storageDeposit: bigint;
}

export async function readCourtConfig(rpc: NearRpc): Promise<CourtConfig> {
  return courtConfigFrom(await rpc.view<RawCourtConfig>(NEAR_COURT_CONTRACT, "config", {}));
}

/**
 * The court reserves the oracle's price for the longest possible question, because the response
 * that sets the final length is not written yet. The price is read from the oracle the court is
 * configured with; a config naming something other than a NEAR account is refused.
 */
export async function readCasePrices(rpc: NearRpc, oracle: string, claim: string, evidence: string): Promise<CasePrices> {
  if (!isNearAccount(oracle)) throw new NearRpcError("the court config names an invalid oracle account");
  const [ask, storage] = await Promise.all([
    rpc.view<string>(oracle, "ask_deposit", { question: WORST_CASE_QUESTION }),
    rpc.view<string>(NEAR_COURT_CONTRACT, "storage_deposit", { claim, evidence }),
  ]);
  const checked = checkNearPrices({ askDeposit: BigInt(ask), storageDeposit: BigInt(storage) });
  return { oracleReserve: checked.askDeposit, storageDeposit: checked.storageDeposit };
}

function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}

export function useCourtConfig() {
  const rpc = useNearRpc();
  return useQuery({ queryKey: ["court", "config"], queryFn: () => readCourtConfig(rpc), staleTime: 30_000 });
}

export function useCasePrices(oracle: string | undefined, claim: string, evidence: string) {
  const rpc = useNearRpc();
  const debouncedClaim = useDebounced(claim, PRICE_DEBOUNCE_MS);
  const debouncedEvidence = useDebounced(evidence, PRICE_DEBOUNCE_MS);
  return useQuery({
    queryKey: ["court", "prices", oracle ?? "", debouncedClaim, debouncedEvidence],
    queryFn: () => readCasePrices(rpc, oracle ?? "", debouncedClaim, debouncedEvidence),
    enabled: oracle !== undefined && debouncedClaim.length > 0 && debouncedEvidence.length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useCourtCase(id: number) {
  const rpc = useNearRpc();
  return useQuery({
    queryKey: ["court", "case", id],
    queryFn: () => rpc.view<CourtCase | null>(NEAR_COURT_CONTRACT, "get_case", { case_id: id }),
    refetchInterval: (q) => (q.state.data && FINAL_STAGES.has(q.state.data.stage) ? false : CASE_POLL_MS),
  });
}

export function useQuestionFor(id: number, c: CourtCase | null | undefined) {
  const rpc = useNearRpc();
  return useQuery({
    queryKey: ["court", "question", id, c?.response ?? null],
    queryFn: () => rpc.view<string>(NEAR_COURT_CONTRACT, "question_for", { case_id: id }),
    enabled: Boolean(c),
  });
}

export function useRecentCases() {
  const rpc = useNearRpc();
  return useQuery({
    queryKey: ["court", "recent"],
    queryFn: async (): Promise<CourtCaseView[]> => {
      const { lastCaseId } = await readCourtConfig(rpc);
      if (lastCaseId < 1) return [];
      const from = Math.max(1, lastCaseId - RECENT_CASES + 1);
      const page = await rpc.view<CourtCaseView[]>(NEAR_COURT_CONTRACT, "cases", { from_id: from, limit: RECENT_CASES });
      return [...page].sort((a, b) => b.case_id - a.case_id);
    },
    refetchInterval: LIST_POLL_MS,
  });
}

/**
 * Pages exactly like the MCP server's `allCases`: the court returns at most 50 cases a call, a
 * shorter page is the last one, and 40 pages bound the walk so a huge court cannot hang the page.
 */
export async function readAllCases(rpc: NearRpc): Promise<CourtCaseView[]> {
  const out: CourtCaseView[] = [];
  for (let page = 0; page < MAX_CASE_PAGES; page++) {
    const batch = await rpc.view<CourtCaseView[]>(NEAR_COURT_CONTRACT, "cases", { from_id: page * CASES_PAGE + 1, limit: CASES_PAGE });
    out.push(...batch);
    if (batch.length < CASES_PAGE) break;
  }
  return out;
}

export function useAllCases() {
  const rpc = useNearRpc();
  return useQuery({ queryKey: ["court", "all"], queryFn: () => readAllCases(rpc), refetchInterval: LIST_POLL_MS });
}

export function useCaseByRequest(requestId: number, enabled: boolean) {
  const rpc = useNearRpc();
  return useQuery({ queryKey: ["court", "by-request", requestId], queryFn: () => rpc.view<number | null>(NEAR_COURT_CONTRACT, "case_by_request", { request_id: requestId }), enabled });
}

export function useNowNs(): bigint {
  const [now, setNow] = useState(() => BigInt(Date.now()) * 1_000_000n);
  useEffect(() => {
    const timer = setInterval(() => setNow(BigInt(Date.now()) * 1_000_000n), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
