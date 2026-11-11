import { Link, useParams } from "react-router";
import { NotFound } from "../components/NotFound.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { explorer, isNearAccount } from "../deployment.js";
import { usePageTitle } from "../hooks.js";
import { agentCases, outcomeFor, reputationLine, reputationOf, type AgentOutcome, type AgentReputation, type CourtCaseView } from "../lib/court.js";
import { useAllCases } from "../near/court-hooks.js";
import { CaseRow } from "./RecentCases.js";

const OUTCOME: Readonly<Record<AgentOutcome, { readonly label: string; readonly tone: string }>> = {
  won: { label: "Won", tone: "text-yes" },
  lost: { label: "Lost", tone: "text-no" },
  refunded: { label: "Refunded", tone: "text-unknown" },
  open: { label: "Open", tone: "text-muted" },
};

interface Stat {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

function plural(n: number): string {
  return `${n} settled case${n === 1 ? "" : "s"}`;
}

function winRateText(r: AgentReputation): string {
  return r.win_rate === null ? "None yet" : `${Math.round(r.win_rate * 100)}%`;
}

function statsOf(r: AgentReputation): Stat[] {
  return [
    { label: "Cases", value: String(r.cases), note: "As claimant or counterparty" },
    { label: "Open", value: String(r.open), note: "Not settled or refunded" },
    { label: "Won", value: String(r.won), note: "Settled in its favour" },
    { label: "Lost", value: String(r.lost), note: "Settled against it" },
    { label: "Refunded", value: String(r.refunded), note: "Stake went back" },
    { label: "Appeals filed", value: String(r.appeals_filed) },
    { label: "Named as counterparty", value: String(r.named_as_counterparty) },
    { label: "Did not respond", value: String(r.did_not_respond), note: "As counterparty, by the deadline" },
  ];
}

function StatCell({ label, value, note }: Stat) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-paper p-4 sm:p-5">
      <dt className="m-0 text-xs font-medium text-muted">{label}</dt>
      <dd className="m-0 font-display text-2xl leading-none font-bold text-ink tabular-nums">{value}</dd>
      {note && <dd className="m-0 text-xs text-muted">{note}</dd>}
    </div>
  );
}

function ReputationStrip({ r }: { r: AgentReputation }) {
  const settled = r.won + r.lost;
  return (
    <section aria-label="Court record" className="overflow-hidden rounded-2xl border border-line bg-line">
      <dl className="m-0 grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 flex min-w-0 flex-col gap-3 bg-paper p-5 sm:col-span-3 sm:p-6 lg:col-span-1 lg:row-span-2">
          <dt className="m-0 text-xs font-medium text-muted">Win rate</dt>
          <dd className="m-0 font-display text-5xl leading-none font-extrabold text-ink tabular-nums sm:text-6xl">{winRateText(r)}</dd>
          <dd className="m-0 text-xs text-muted">{settled > 0 ? `Of ${plural(settled)}; only settled cases count` : "Only settled cases count"}</dd>
        </div>
        {statsOf(r).map((s) => (
          <StatCell key={s.label} {...s} />
        ))}
      </dl>
    </section>
  );
}

function roleText(c: CourtCaseView, account: string): string {
  return c.claimant === account ? "Claimant" : "Counterparty";
}

function AgentCases({ account, cases }: { account: string; cases: readonly CourtCaseView[] }) {
  return (
    <section aria-labelledby="agent-cases-heading" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="agent-cases-heading" className="m-0 font-display text-xl font-bold">
          Cases
        </h2>
        <span className="text-xs text-muted">Newest first</span>
      </div>
      <ul aria-label={`Cases of ${account}`} className="m-0 list-none p-0">
        {cases.map((c) => {
          const outcome = OUTCOME[outcomeFor(c, account)];
          return (
            <CaseRow
              key={c.case_id}
              c={c}
              note={
                <>
                  <span className={`font-semibold ${outcome.tone}`}>{outcome.label}</span>
                  <span>{roleText(c, account)}</span>
                </>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

function AgentRecord({ account }: { account: string }) {
  const all = useAllCases();
  if (all.isError) return <p className="m-0 text-no">Could not read the court contract on NEAR testnet. This page retries on its own.</p>;
  if (all.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading the court record">
        <Skeleton className="h-6 w-64 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const rep = reputationOf(account, all.data);
  if (rep.cases === 0) {
    return (
      <p className="m-0 rounded-2xl border border-dashed border-line bg-paper px-5 py-8 text-muted">No cases yet. An agent with no record has not been tested in this court.</p>
    );
  }
  return (
    <>
      <p className="m-0 text-lg font-medium">{reputationLine(rep)}.</p>
      <ReputationStrip r={rep} />
      <AgentCases account={account} cases={agentCases(account, all.data)} />
    </>
  );
}

export function AgentPage() {
  const account = useParams().account ?? "";
  const valid = isNearAccount(account);
  usePageTitle(valid ? `${account} - Psephex` : "Not found - Psephex", valid ? `Court cases on NEAR testnet where ${account} is the claimant or the counterparty, with each verdict and payout.` : undefined);
  if (!valid) return <NotFound />;
  return (
    <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2">
        <p className="m-0 text-sm text-muted">
          <Link to="/app" className="underline underline-offset-2 hover:text-bronze-text">
            Disputes
          </Link>{" "}
          / Agent record
        </p>
        <h1 className="m-0 font-mono text-2xl font-bold [overflow-wrap:anywhere] sm:text-4xl">{account}</h1>
        <p className="m-0 text-sm text-muted">
          Read from every case in the court contract on NEAR testnet.{" "}
          <a href={explorer.nearAccount(account)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-bronze-text">
            Account on Nearblocks
          </a>
        </p>
      </header>
      <AgentRecord key={account} account={account} />
    </div>
  );
}
