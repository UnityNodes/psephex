import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect } from "react";
import { createApi, type Api, type RequestDetail, type RequestStatus } from "./api.js";
import { API_URL } from "./deployment.js";
import type { Source } from "./sources.js";

const LIVE_POLL_MS = 3_000;
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

export function useRequestDetail(source: Source, id: number, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["request", source, id], queryFn: () => api.request(source, id), enabled, refetchInterval: (q) => detailPollInterval(q.state.data) });
}

export function useVerifyPlan(source: Source, id: number, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["verify", source, id], queryFn: () => api.verify(source, id), enabled });
}

export function useRequestPages(status: RequestStatus | undefined, source: Source | undefined) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ["requests", status ?? "all", source ?? "all"],
    queryFn: ({ pageParam }) =>
      api.requests({ limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }), ...(status ? { status } : {}), ...(source ? { source } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
}

export function useStats() {
  const api = useApi();
  return useQuery({ queryKey: ["stats"], queryFn: () => api.stats(), refetchInterval: 30_000 });
}

export function useHealth() {
  const api = useApi();
  return useQuery({ queryKey: ["health"], queryFn: () => api.health(), refetchInterval: 20_000 });
}

export function useLatestVerdict() {
  const api = useApi();
  const latest = useQuery({ queryKey: ["latest-confirmed"], queryFn: () => api.requests({ limit: 1, status: "confirmed" }), refetchInterval: 30_000 });
  const first = latest.data?.items[0];
  const detail = useQuery({
    queryKey: ["request", first?.source, first?.id],
    queryFn: () => (first ? api.request(first.source, first.id) : null),
    enabled: first !== undefined,
  });
  return { detail: detail.data ?? null, isError: latest.isError || detail.isError };
}

export function useModels() {
  const api = useApi();
  return useQuery({ queryKey: ["models"], queryFn: () => api.models(), staleTime: 60_000 });
}

const DEFAULT_DESCRIPTION = typeof document === "undefined" ? "" : (document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "");

function descriptionMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (existing) return existing;
  const meta = document.createElement("meta");
  meta.name = "description";
  document.head.append(meta);
  return meta;
}

/**
 * The dashboard overlays render a page inside another page, and React runs the child's effect
 * before the parent's, so the outer page passes null and leaves the title and description to the
 * page it overlays instead of overwriting them.
 */
export function usePageTitle(title: string | null, description?: string): void {
  useEffect(() => {
    if (title === null) return;
    document.title = title;
    descriptionMeta().content = description ?? DEFAULT_DESCRIPTION;
  }, [title, description]);
}
