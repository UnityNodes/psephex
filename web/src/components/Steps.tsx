import { Check, X } from "lucide-react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { useEnter } from "../lib/motion.js";
import type { Step, StepState } from "../lib/steps.js";

const MARK: Readonly<Record<StepState, { symbol: ReactNode; label: string; className: string }>> = {
  done: { symbol: <Check className="size-4" strokeWidth={2.5} />, label: "done", className: "bg-yes text-paper border-yes" },
  active: { symbol: <span className="size-2 rounded-full bg-bronze" />, label: "in progress", className: "bg-paper text-ink border-bronze animate-pulse motion-reduce:animate-none" },
  waiting: { symbol: null, label: "not started", className: "bg-transparent text-muted border-line" },
  failed: { symbol: <X className="size-4" strokeWidth={2.5} />, label: "stopped", className: "bg-no text-paper border-no" },
};

function Mark({ index, className, children }: { index: number; className: string; children: ReactNode }) {
  const enter = useEnter({ opacity: 0, scale: 0.6 }, 0.1 + index * 0.09, 0.28);
  return (
    <m.span {...enter} aria-hidden="true" className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${className}`}>
      {children}
    </m.span>
  );
}

function Connector({ index }: { index: number }) {
  const enter = useEnter({ scaleY: 0 }, 0.15 + index * 0.09, 0.35);
  return <m.span {...enter} aria-hidden="true" className="absolute top-8 left-[15px] h-[calc(100%-2rem)] w-0.5 origin-top bg-line" />;
}

export function Steps({ steps, links }: { steps: readonly Step[]; links?: Partial<Record<Step["key"], ReactNode>> }) {
  return (
    <ol className="m-0 list-none p-0">
      {steps.map((s, i) => {
        const mark = MARK[s.state];
        return (
          <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 && <Connector index={i} />}
            <Mark index={i} className={mark.className}>
              {mark.symbol}
            </Mark>
            <div className="min-w-0 pt-1">
              <p className="m-0 font-medium">
                {s.title} <span className="sr-only">({mark.label})</span>
              </p>
              {s.detail && <p className={`m-0 text-sm [overflow-wrap:anywhere] ${s.state === "failed" ? "text-no" : "text-muted"}`}>{s.detail}</p>}
              {links?.[s.key] && <div className="mt-1 text-sm">{links[s.key]}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
