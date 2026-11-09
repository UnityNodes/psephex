import { m } from "motion/react";
import { Activity, Clock, Gauge, Scale } from "lucide-react";
import type { ReactNode } from "react";
import type { Answer, Stats } from "../api.js";
import { NumberTicker } from "../components/ui/number-ticker.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useHealth, useStats } from "../hooks.js";
import { baseLagText, relayerState, StatusDot } from "./NetworkStatus.js";

const SEGMENT: Readonly<Record<Answer, string>> = { YES: "bg-yes", NO: "bg-no", UNKNOWN: "bg-unknown" };
const LABEL: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };
const ORDER: readonly Answer[] = ["YES", "NO", "UNKNOWN"];

function Cell({ icon, label, children, note, lead = false }: { icon: ReactNode; label: string; children: ReactNode; note?: ReactNode; lead?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 bg-paper p-5 ${lead ? "gap-4 sm:p-6 md:col-span-3 xl:col-span-1 xl:row-span-3" : ""}`}>
      <p className="m-0 flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        {label}
      </p>
      <div className={`font-display leading-none font-bold text-ink ${lead ? "flex-1" : "text-2xl"}`}>{children}</div>
      {note && <p className="m-0 text-xs text-muted">{note}</p>}
    </div>
  );
}

function VerdictBar({ stats }: { stats: Stats }) {
  const answered = ORDER.reduce((sum, a) => sum + stats.answers[a], 0);
  return (
    <div className="flex h-full flex-col justify-between gap-5">
      <p className="m-0 grid grid-cols-3 gap-4 xl:pt-4">
        {ORDER.map((a) => (
          <span key={a} className="flex flex-col gap-1">
            <span className={`text-5xl leading-none font-extrabold sm:text-6xl xl:text-8xl ${LABEL[a]}`}>
              <NumberTicker value={stats.answers[a]} />
            </span>
            <span className={`font-sans text-xs font-semibold ${LABEL[a]}`}>{a}</span>
          </span>
        ))}
      </p>
      <m.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-3 origin-left gap-0.5 overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={`${stats.answers.YES} YES, ${stats.answers.NO} NO and ${stats.answers.UNKNOWN} UNKNOWN`}
      >
        {answered > 0 && ORDER.map((a) => <span key={a} className={SEGMENT[a]} style={{ width: `${(stats.answers[a] / answered) * 100}%` }} />)}
      </m.div>
      <p className="m-0 font-sans text-xs font-normal text-muted">
        {answered} answered on Base. A verdict needs two of the three signed answers to match.
      </p>
    </div>
  );
}

export function MetricsStrip() {
  const stats = useStats();
  const health = useHealth();
  const state = relayerState(health.data, health.isError);
  const s = stats.data;
  const stopped = s ? (s.byStatus.failed ?? 0) + (s.byStatus.rejected ?? 0) : 0;
  return (
    <section aria-label="Live numbers" className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Cell icon={<Gauge className="size-3.5" aria-hidden="true" />} label="Verdicts on Base" lead>
        {s ? <VerdictBar stats={s} /> : <Skeleton className="h-24 w-full" />}
      </Cell>
      <Cell icon={<Scale className="size-3.5" aria-hidden="true" />} label="Disputes" note={s ? `${s.byStatus.confirmed ?? 0} answered on Base, ${stopped} stopped` : undefined}>
        {s ? <NumberTicker value={s.total} /> : <Skeleton className="h-8 w-16" />}
      </Cell>
      <Cell icon={<Clock className="size-3.5" aria-hidden="true" />} label="Time to answer" note="Average, from the relayer seeing a question to its answer on Base">
        {s?.avgSecondsSeenToConfirmed != null ? (
          <>
            <NumberTicker value={s.avgSecondsSeenToConfirmed} /> s
          </>
        ) : s ? (
          "None yet"
        ) : (
          <Skeleton className="h-8 w-20" />
        )}
      </Cell>
      <Cell
        icon={<Activity className="size-3.5" aria-hidden="true" />}
        label="Relayer"
        note={health.data ? `${baseLagText(health.data.base.lagBlocks)}, ${health.data.budget.modelCalls} of ${health.data.budget.dailyLimit} model calls today` : undefined}
      >
        <span className="flex items-center gap-3">
          <StatusDot tone={state.tone} />
          {state.label}
        </span>
      </Cell>
      {stats.isError && <p className="m-0 bg-paper p-5 text-sm text-no md:col-span-3 xl:col-span-2">The Psephex API did not answer. The numbers will retry on their own.</p>}
    </section>
  );
}
