import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { AgentLink } from "../components/AgentLink.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { STAGE_LABEL, type CourtCaseView } from "../lib/court.js";
import { formatNear } from "../lib/near-dispute.js";
import { displayText } from "../lib/text.js";
import { useRecentCases } from "../near/court-hooks.js";

const VERDICT_TEXT: Readonly<Record<string, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };

/**
 * A link inside a link is invalid HTML and browsers split it, so the row link covers the row
 * through its ::after box and the party links sit above it.
 */
export function CaseRow({ c, selected = false, note, short = true }: { c: CourtCaseView; selected?: boolean; note?: ReactNode; short?: boolean }) {
  return (
    <li className={`relative flex flex-col gap-1.5 border-b border-line px-4 py-4 transition-colors duration-150 hover:bg-raised/70 ${selected ? "bg-raised shadow-[inset_2px_0_0_var(--bronze)]" : ""}`}>
      <Link to={`/app/case/${c.case_id}`} aria-current={selected ? "page" : undefined} className="flex min-w-0 items-baseline gap-2 after:absolute after:inset-0 after:content-['']">
        <span className="font-mono text-xs text-muted">#{c.case_id}</span>
        <span className="line-clamp-2 min-w-0 text-sm text-ink">{displayText(c.claim)}</span>
      </Link>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {note}
        <span className="font-medium text-ink">{STAGE_LABEL[c.stage]}</span>
        {c.verdict && <span className={`font-semibold ${VERDICT_TEXT[c.verdict] ?? ""}`}>{c.verdict}</span>}
        <span className="tabular-nums">{formatNear(BigInt(c.amount))} NEAR</span>
        <span className="relative z-10 min-w-0 [overflow-wrap:anywhere]">
          <AgentLink account={c.claimant} short={short} /> vs <AgentLink account={c.counterparty} short={short} />
        </span>
      </span>
    </li>
  );
}

export function RecentCases() {
  const cases = useRecentCases();
  const path = useLocation().pathname;
  const items = cases.data ?? [];
  return (
    <section aria-labelledby="cases-heading" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="cases-heading" className="m-0 font-display text-xl font-bold">
          Recent court cases
        </h2>
        <span className="text-xs text-muted">Read from the court contract on NEAR, newest first</span>
      </div>
      {cases.isError && <p className="m-0 px-4 py-6 text-sm text-no">Could not read the court contract on NEAR testnet. The list will retry on its own.</p>}
      {cases.isPending && (
        <ul className="m-0 list-none p-0" aria-hidden="true">
          {[0, 1].map((i) => (
            <li key={i} className="border-b border-line px-4 py-4">
              <Skeleton className="h-5 w-full" />
            </li>
          ))}
        </ul>
      )}
      {cases.isSuccess && items.length === 0 && <p className="m-0 px-4 py-6 text-sm text-muted">No court cases yet. Open the first one.</p>}
      <ul aria-label="Court cases" className="m-0 list-none p-0">
        {items.map((c) => (
          <CaseRow key={c.case_id} c={c} selected={path === `/app/case/${c.case_id}`} />
        ))}
      </ul>
    </section>
  );
}
