import { CircleX } from "lucide-react";
import { m } from "motion/react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Answer, RequestStatus, RequestSummary } from "../api.js";
import { BallotDisc } from "../components/Ballots.js";
import { ChainBadge } from "../components/ChainBadge.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { useRequestPages } from "../hooks.js";
import { claimFromCourtQuestion, isCourtRequest, requestHeadline, type CourtCaseView } from "../lib/court.js";
import { timeAgo, tookSeconds } from "../lib/format.js";
import { useEnter } from "../lib/motion.js";
import { statusLabel } from "../lib/status.js";
import { useAllCases } from "../near/court-hooks.js";
import { SOURCE_SHORT, type Source } from "../sources.js";

const FILTERS: readonly { value: RequestStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Answered" },
  { value: "failed", label: "Stopped" },
  { value: "rejected", label: "Rejected" },
];

const CHAIN_FILTERS: readonly (Source | "all")[] = ["all", "near", "base", "arbitrum"];

const VERDICT_TEXT: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };
const COLUMNS = "xl:grid xl:grid-cols-[3.5rem_5.5rem_minmax(0,1fr)_8rem_10rem_4rem_6.5rem] xl:items-center xl:gap-4";

function Verdict({ r }: { r: RequestSummary }) {
  if (r.status === "failed" || r.status === "rejected") {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-muted">
        <CircleX className="size-5" aria-hidden="true" />
        No verdict
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${r.answer ? VERDICT_TEXT[r.answer] : "text-muted"}`}>
      <BallotDisc vote={r.answer} size={22} />
      {r.answer ?? "Pending"}
    </span>
  );
}

const ROW_STAGGER = 0.03;
const MAX_STAGGERED_ROWS = 12;

export function requestPath(r: Pick<RequestSummary, "source" | "id">): string {
  return `/app/r/${r.source}/${r.id}`;
}

export function RequestRow({ r, selected = false, index = 0, cases = [] }: { r: RequestSummary; selected?: boolean; index?: number; cases?: readonly CourtCaseView[] }) {
  const took = tookSeconds(r);
  const enter = useEnter({ opacity: 0, y: 8 }, Math.min(index, MAX_STAGGERED_ROWS) * ROW_STAGGER);
  return (
    <m.li {...enter}>
      <Link
        to={requestPath(r)}
        aria-current={selected ? "page" : undefined}
        className={`flex flex-col gap-2 border-b border-line px-4 py-4 transition-colors duration-150 hover:bg-raised/70 xl:py-3 ${COLUMNS} ${selected ? "bg-raised shadow-[inset_2px_0_0_var(--bronze)]" : ""}`}
      >
        <span className="text-sm text-ink xl:contents">
          <span className="font-mono text-xs text-muted xl:text-sm">#{r.id}</span>{" "}
          <span className="hidden xl:inline-flex">
            <ChainBadge source={r.source} />
          </span>{" "}
          <span className="line-clamp-2 xl:line-clamp-1">{requestHeadline(r, cases)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 xl:contents">
          <span className="xl:hidden">
            <ChainBadge source={r.source} />
          </span>
          <Verdict r={r} />
          <span className="text-xs text-muted xl:text-sm">{statusLabel(r.status, r.source)}</span>
          <span className="text-xs text-muted tabular-nums xl:text-sm">{took !== null ? `${took} s` : "…"}</span>
          <span className="text-xs text-muted xl:text-sm">{timeAgo(r.createdAt)}</span>
        </span>
      </Link>
    </m.li>
  );
}

function LoadingRows() {
  return (
    <ul className="m-0 list-none p-0" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="border-b border-line px-4 py-4">
          <Skeleton className="h-5 w-full" />
        </li>
      ))}
    </ul>
  );
}

export function RecentRequests() {
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const [source, setSource] = useState<Source | "all">("all");
  const pages = useRequestPages(status === "all" ? undefined : status, source === "all" ? undefined : source);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const needsCases = items.some((r) => isCourtRequest(r) && claimFromCourtQuestion(r.question) === null);
  const cases = useAllCases(needsCases).data ?? [];
  const params = useParams();
  const selected = `${params.source ?? ""}-${params.id ?? ""}`;

  return (
    <section aria-labelledby="recent-heading" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id="recent-heading" className="m-0 font-display text-xl font-bold">
          Recent requests
        </h2>
        <Tabs value={status} onValueChange={(v) => setStatus(v as RequestStatus | "all")} className="w-full sm:w-auto">
          <TabsList aria-label="Show" className="grid h-auto w-full grid-cols-4 bg-stone sm:inline-flex sm:w-auto">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="min-h-9 px-1.5 text-xs data-[state=active]:bg-raised data-[state=active]:text-ink sm:px-3 sm:text-sm">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div role="group" aria-label="Chain" className="flex flex-wrap gap-2 border-b border-line px-4 py-2.5">
        {CHAIN_FILTERS.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={source === c}
            onClick={() => setSource(c)}
            className="min-h-9 rounded-full border border-line px-3 text-xs font-medium text-muted transition-colors duration-150 hover:border-bronze hover:text-ink aria-pressed:border-bronze aria-pressed:bg-raised aria-pressed:text-ink"
          >
            {c === "all" ? "All chains" : SOURCE_SHORT[c]}
          </button>
        ))}
      </div>
      <div aria-hidden="true" className={`hidden border-b border-line px-4 py-2 text-xs font-medium text-muted ${COLUMNS}`}>
        <span>#</span>
        <span>Chain</span>
        <span>Question</span>
        <span>Verdict</span>
        <span>Status</span>
        <span>Took</span>
        <span>Opened</span>
      </div>
      {pages.isError && <p className="m-0 px-4 py-6 text-sm text-no">The Psephex API did not answer. The list will retry on its own.</p>}
      {pages.isPending && <LoadingRows />}
      {pages.isSuccess && items.length === 0 && <p className="m-0 px-4 py-6 text-sm text-muted">No requests here yet.</p>}
      <ul className="m-0 list-none p-0">
        {items.map((r, i) => (
          <RequestRow key={`${status}-${source}-${r.source}-${r.id}`} r={r} selected={`${r.source}-${r.id}` === selected} index={i} cases={cases} />
        ))}
      </ul>
      {pages.hasNextPage && (
        <div className="p-3">
          <Button type="button" variant="ghost" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
            {pages.isFetchingNextPage ? "Loading…" : "Show older requests"}
          </Button>
        </div>
      )}
    </section>
  );
}
