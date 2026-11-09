import { CircleX } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { Answer, RequestStatus, RequestSummary } from "../api.js";
import { BallotDisc } from "../components/Ballots.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { useRequestPages } from "../hooks.js";
import { displayText } from "../lib/dispute.js";
import { timeAgo, tookSeconds } from "../lib/format.js";

export const STATUS_LABEL: Readonly<Record<RequestStatus, string>> = {
  seen: "Seen by the relayer",
  answering: "Models answering",
  verified: "Checked on NEAR",
  near_sent: "Signing on NEAR",
  near_signed: "Signed by MPC",
  base_sent: "Sending to Base",
  confirmed: "Answered on Base",
  rejected: "Rejected",
  failed: "Stopped",
};

const FILTERS: readonly { value: RequestStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Answered" },
  { value: "failed", label: "Stopped" },
  { value: "rejected", label: "Rejected" },
];

const VERDICT_TEXT: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };
const COLUMNS = "md:grid md:grid-cols-[3.5rem_minmax(0,1fr)_8rem_10rem_4rem_6.5rem] md:items-center md:gap-4";

function Verdict({ r }: { r: RequestSummary }) {
  if (r.status === "failed" || r.status === "rejected") {
    return (
      <span className="inline-flex items-center gap-2 text-sm font-medium text-no">
        <CircleX className="size-5" aria-hidden="true" />
        None
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

export function RequestRow({ r, selected = false }: { r: RequestSummary; selected?: boolean }) {
  const took = tookSeconds(r);
  return (
    <li>
      <Link
        to={`/app/r/${r.id}`}
        aria-current={selected ? "page" : undefined}
        className={`flex flex-col gap-2 border-b border-line px-4 py-4 transition-colors duration-150 hover:bg-raised/70 md:py-3 ${COLUMNS} ${selected ? "bg-raised shadow-[inset_2px_0_0_var(--bronze)]" : ""}`}
      >
        <span className="text-sm text-ink md:contents">
          <span className="font-mono text-xs text-muted md:text-sm">#{r.id}</span> <span className="line-clamp-2 md:line-clamp-1">{displayText(r.question)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
          <Verdict r={r} />
          <span className="text-xs text-muted md:text-sm">{STATUS_LABEL[r.status]}</span>
          <span className="text-xs text-muted tabular-nums md:text-sm">{took !== null ? `${took} s` : "…"}</span>
          <span className="text-xs text-muted md:text-sm">{timeAgo(r.createdAt)}</span>
        </span>
      </Link>
    </li>
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

export function RecentDisputes() {
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const pages = useRequestPages(status === "all" ? undefined : status);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const selected = Number(useParams().id ?? 0);

  return (
    <section aria-labelledby="recent-heading" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id="recent-heading" className="m-0 font-display text-xl font-bold">
          Recent disputes
        </h2>
        <Tabs value={status} onValueChange={(v) => setStatus(v as RequestStatus | "all")}>
          <TabsList aria-label="Show" className="h-auto bg-stone">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="min-h-9 px-3 data-[state=active]:bg-raised data-[state=active]:text-ink">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div aria-hidden="true" className={`hidden border-b border-line px-4 py-2 text-xs font-medium text-muted ${COLUMNS}`}>
        <span>#</span>
        <span>Question</span>
        <span>Verdict</span>
        <span>Status</span>
        <span>Took</span>
        <span>Opened</span>
      </div>
      {pages.isError && <p className="m-0 px-4 py-6 text-sm text-no">The Psephex API did not answer. The list will retry on its own.</p>}
      {pages.isPending && <LoadingRows />}
      {pages.isSuccess && items.length === 0 && <p className="m-0 px-4 py-6 text-sm text-muted">No disputes here yet. Open the first one.</p>}
      <ul className="m-0 list-none p-0">
        {items.map((r) => (
          <RequestRow key={r.id} r={r} selected={r.id === selected} />
        ))}
      </ul>
      {pages.hasNextPage && (
        <div className="p-3">
          <Button type="button" variant="ghost" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
            {pages.isFetchingNextPage ? "Loading…" : "Show older disputes"}
          </Button>
        </div>
      )}
    </section>
  );
}
