import { useState } from "react";
import { Link } from "react-router";
import type { RequestStatus, RequestSummary } from "../api.js";
import { BallotDisc } from "../components/Ballots.js";
import { useRequestPages } from "../hooks.js";
import { displayText } from "../lib/dispute.js";

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

const FILTERS: readonly { value: RequestStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "confirmed", label: "Answered" },
  { value: "failed", label: "Stopped" },
  { value: "rejected", label: "Rejected" },
];

export function RequestRow({ r }: { r: RequestSummary }) {
  return (
    <li>
      <Link to={`/app/r/${r.id}`} className="flex items-start gap-3 border-b border-line py-3 hover:bg-paper/70">
        {r.status === "failed" || r.status === "rejected" ? (
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-no text-xs font-bold text-no">
            ✕
          </span>
        ) : (
          <BallotDisc vote={r.answer} size={24} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm break-words">
            <span className="font-medium">#{r.id}</span> {displayText(r.question)}
          </span>
          <span className="block text-xs text-muted">
            {STATUS_LABEL[r.status]}
            {r.answer ? `, ${r.answer}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function RecentDisputes() {
  const [status, setStatus] = useState<RequestStatus | "">("");
  const pages = useRequestPages(status === "" ? undefined : status);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="recent-heading">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="recent-heading" className="m-0 font-display text-2xl font-semibold">
          Recent disputes
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Show</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")} className="min-h-11 rounded border border-line bg-paper px-2">
            {FILTERS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pages.isError && <p className="text-sm text-no">The Psephex API did not answer. The list will retry on its own.</p>}
      {pages.isSuccess && items.length === 0 && <p className="text-sm text-muted">No disputes here yet. Open the first one.</p>}
      <ul className="m-0 list-none p-0">
        {items.map((r) => (
          <RequestRow key={r.id} r={r} />
        ))}
      </ul>
      {pages.hasNextPage && (
        <button type="button" onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage} className="mt-3 text-sm underline">
          {pages.isFetchingNextPage ? "Loading…" : "Show older disputes"}
        </button>
      )}
    </section>
  );
}
