import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { AgentLink } from "../components/AgentLink.js";
import { CopyButton } from "../components/Commands.js";
import { Steps } from "../components/Steps.js";
import { Badge } from "../components/ui/badge.js";
import { explorer, NEAR_COURT_CONTRACT } from "../deployment.js";
import { usePageTitle } from "../hooks.js";
import { arbiterCommand, askingRefundAt, caseTimeline, countdown, STAGE_LABEL, type CourtCase, type CourtConfig, type Winner } from "../lib/court.js";
import { formatNear } from "../lib/near-dispute.js";
import { displayText } from "../lib/text.js";
import { useCourtCase, useCourtConfig, useNowNs, useQuestionFor } from "../near/court-hooks.js";
import { CaseActions } from "./CaseActions.js";

const ID = /^[1-9]\d{0,14}$/;

function Statement({ who, label, text, empty }: { who: string; label: string; text: string | null; empty?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <p className="m-0 text-xs font-medium text-bronze-text">
        {label} <AgentLink account={who} className="text-muted" />
      </p>
      {text !== null ? <p className="m-0 [overflow-wrap:anywhere]">{displayText(text)}</p> : <p className="m-0 text-muted italic">{empty}</p>}
    </div>
  );
}

function responseEmpty(c: CourtCase): string {
  return c.stage === "awaiting_response" ? "No response yet." : "No response.";
}

interface Deadline {
  readonly label: string;
  readonly at: bigint;
}

function deadlines(c: CourtCase, config: CourtConfig | undefined): Deadline[] {
  const list: Deadline[] = [];
  if (c.stage === "awaiting_response") list.push({ label: "Response window", at: BigInt(c.respond_by_ns) });
  if (c.stage === "awaiting_verdict" && c.answer_by_ns) list.push({ label: "Oracle answer due", at: BigInt(c.answer_by_ns) });
  const asking = c.stage === "asking" && config ? askingRefundAt(c, config.answerTimeoutSec) : null;
  if (asking !== null) list.push({ label: "Refund opens", at: asking });
  if (c.stage === "decided" && c.appeal_by_ns) list.push({ label: "Appeal window", at: BigInt(c.appeal_by_ns) });
  if (c.stage === "appealed" && c.arbitrate_by_ns) list.push({ label: "Arbiter must rule", at: BigInt(c.arbitrate_by_ns) });
  return list;
}

function Countdowns({ items, nowNs }: { items: readonly Deadline[]; nowNs: bigint }) {
  if (items.length === 0) return null;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {items.map((d) => (
        <div key={d.label} className="contents">
          <dt className="text-muted">{d.label}</dt>
          <dd className="m-0 font-medium tabular-nums" aria-live="off">
            {countdown(d.at, nowNs)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-sm font-medium">{title}</p>
      <div className="flex min-w-0 items-start gap-2 rounded-lg border border-vault-line bg-vault p-3 text-vault-ink">
        <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">{code}</code>
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function ArbiterPanel({ c, caseId }: { c: CourtCase; caseId: number }) {
  const arbiter = c.arbiter;
  const commands = (["claimant", "counterparty"] as const satisfies readonly Winner[]).map((w) => ({ w, cmd: arbiter ? arbiterCommand(caseId, w, arbiter) : null }));
  return (
    <section aria-labelledby="arbiter-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="arbiter-heading" className="m-0 font-display text-2xl font-semibold">
        The arbiter
      </h2>
      <p className="m-0 text-muted [overflow-wrap:anywhere]">
        {c.appellant && <AgentLink account={c.appellant} className="text-ink" />} appealed. The arbiter of this appeal is <span className="font-mono text-ink">{arbiter ?? "unknown"}</span>, a person who rules from the NEAR CLI. The winner gets the stake and the bond.
      </p>
      {commands.map(({ w, cmd }) => (cmd ? <CodeBlock key={w} title={`Rule for the ${w}`} code={cmd} /> : null))}
      {commands.every((x) => x.cmd === null) && <p className="m-0 text-sm text-no">The arbiter account from NEAR is not a valid account id, so no command is shown.</p>}
    </section>
  );
}

function OracleQuestion({ caseId, c }: { caseId: number; c: CourtCase }) {
  const question = useQuestionFor(caseId, c);
  return (
    <section aria-labelledby="question-heading" className="flex min-w-0 flex-col gap-3">
      <h2 id="question-heading" className="m-0 font-display text-2xl font-semibold">
        The question the models get
      </h2>
      <p className="m-0 text-sm text-muted">The court writes it from both sides' text; read from question_for({caseId}).</p>
      {question.data !== undefined && <pre className="m-0 rounded-lg border border-line bg-stone p-3 font-mono text-xs break-words whitespace-pre-wrap">{question.data}</pre>}
      {question.isError && <p className="m-0 text-sm text-no">Could not read the question from NEAR.</p>}
    </section>
  );
}

function verdictLine(c: CourtCase): ReactNode {
  if (c.stage === "settled" && c.winner) {
    return (
      <>
        <AgentLink account={c.winner} /> got the stake of {formatNear(BigInt(c.amount))} NEAR.
      </>
    );
  }
  if (c.stage === "refunded") {
    return (
      <>
        The stake went back to <AgentLink account={c.claimant} />.
      </>
    );
  }
  if (c.verdict) return `Verdict: ${c.verdict}.`;
  return null;
}

function CaseView({ caseId, c, config, onChanged }: { caseId: number; c: CourtCase; config: CourtConfig | undefined; onChanged: () => void }) {
  const nowNs = useNowNs();
  const steps = caseTimeline(c, nowNs);
  const links: Partial<Record<string, ReactNode>> =
    c.request_id !== null
      ? {
          asked: (
            <Link to={`/app/r/near/${c.request_id}`} className="underline underline-offset-2 hover:text-bronze-text">
              See how the oracle answered request #{c.request_id}
            </Link>
          ),
        }
      : {};
  const summary = verdictLine(c);
  return (
    <article className="flex min-w-0 flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            <Link to="/app" className="underline underline-offset-2 hover:text-bronze-text">
              Cases
            </Link>{" "}
            / #{caseId}
          </span>
          <Badge variant="outline">{STAGE_LABEL[c.stage]}</Badge>
          <span>Stake {formatNear(BigInt(c.amount))} NEAR</span>
        </div>
        <p className="m-0 text-sm text-muted">
          <AgentLink account={c.claimant} className="text-ink" /> vs <AgentLink account={c.counterparty} className="text-ink" />
        </p>
        <h1 className="m-0 max-w-[40ch] font-display text-2xl leading-tight font-bold break-words sm:text-3xl">{displayText(c.claim)}</h1>
        {summary && <p className="m-0 font-medium">{summary}</p>}
        <Countdowns items={deadlines(c, config)} nowNs={nowNs} />
      </header>

      {config && <CaseActions c={c} caseId={caseId} config={config} nowNs={nowNs} onDone={onChanged} />}

      <section aria-labelledby="record-heading" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-paper p-5">
        <h2 id="record-heading" className="m-0 font-display text-2xl font-semibold">
          The record
        </h2>
        <Statement label="Claim by" who={c.claimant} text={c.claim} />
        <Statement label="Evidence from" who={c.claimant} text={c.evidence} />
        <Statement label="Response from" who={c.counterparty} text={c.response} empty={responseEmpty(c)} />
      </section>

      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="m-0 mb-6 font-display text-2xl font-semibold">
          Stages
        </h2>
        <Steps steps={steps} links={links} />
      </section>

      {c.stage === "appealed" && <ArbiterPanel c={c} caseId={caseId} />}
      <OracleQuestion caseId={caseId} c={c} />
      <p className="m-0 text-sm">
        <a href={explorer.nearAccount(NEAR_COURT_CONTRACT)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-bronze-text">
          {NEAR_COURT_CONTRACT} on Nearblocks
        </a>
      </p>
    </article>
  );
}

function CaseLoader({ caseId }: { caseId: number }) {
  const result = useCourtCase(caseId);
  const config = useCourtConfig();
  const client = useQueryClient();
  if (result.isError) return <p className="m-0 text-no">Could not read the court contract on NEAR testnet. This page retries on its own.</p>;
  if (result.isPending) return <p className="m-0 text-muted">Loading the case…</p>;
  if (result.data === null) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-2xl font-bold">No case with this number yet</h1>
        <p className="m-0 text-muted">If you just opened it, wait a few seconds for NEAR to include the transaction.</p>
      </div>
    );
  }
  const refresh = () => {
    void result.refetch();
    void client.invalidateQueries({ queryKey: ["court"] });
  };
  return <CaseView caseId={caseId} c={result.data} config={config.data} onChanged={refresh} />;
}

export function CasePage() {
  const raw = useParams().id ?? "";
  const valid = ID.test(raw);
  const caseId = valid ? Number(raw) : 0;
  usePageTitle(valid ? `Case #${caseId} - Psephex` : "Not found - Psephex");
  if (!valid) {
    return (
      <p>
        There is no case with this number. <Link to="/app">Back to the cases</Link>.
      </p>
    );
  }
  return <CaseLoader key={caseId} caseId={caseId} />;
}
