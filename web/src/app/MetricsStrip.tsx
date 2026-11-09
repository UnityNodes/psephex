import { motion } from "motion/react";
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

function Cell({ icon, label, children, note }: { icon: ReactNode; label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-paper p-5">
      <p className="m-0 flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        {label}
      </p>
      <div className="font-display text-3xl leading-none font-bold text-ink">{children}</div>
      {note && <p className="m-0 text-xs text-muted">{note}</p>}
    </div>
  );
}

function VerdictBar({ stats }: { stats: Stats }) {
  const answered = ORDER.reduce((sum, a) => sum + stats.answers[a], 0);
  return (
    <div className="flex flex-col gap-2">
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex h-2.5 origin-left overflow-hidden rounded-full bg-line"
        role="img"
        aria-label={`${stats.answers.YES} YES, ${stats.answers.NO} NO and ${stats.answers.UNKNOWN} UNKNOWN`}
      >
        {answered > 0 && ORDER.map((a) => <span key={a} className={SEGMENT[a]} style={{ width: `${(stats.answers[a] / answered) * 100}%` }} />)}
      </motion.div>
      <p className="m-0 flex flex-wrap gap-x-3 font-sans text-xs font-medium">
        {ORDER.map((a) => (
          <span key={a} className={LABEL[a]}>
            {stats.answers[a]} {a}
          </span>
        ))}
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
    <section aria-label="Live numbers" className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
      <Cell icon={<Scale className="size-3.5" aria-hidden="true" />} label="Disputes" note={s ? `${s.byStatus.confirmed ?? 0} answered on Base, ${stopped} stopped` : undefined}>
        {s ? <NumberTicker value={s.total} /> : <Skeleton className="h-8 w-16" />}
      </Cell>
      <Cell icon={<Gauge className="size-3.5" aria-hidden="true" />} label="Verdicts">
        {s ? <VerdictBar stats={s} /> : <Skeleton className="h-8 w-full" />}
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
        <span className="flex items-center gap-3 text-2xl">
          <StatusDot tone={state.tone} />
          {state.label}
        </span>
      </Cell>
      {stats.isError && <p className="m-0 bg-paper p-5 text-sm text-no sm:col-span-2 xl:col-span-4">The Psephex API did not answer. The numbers will retry on their own.</p>}
    </section>
  );
}
