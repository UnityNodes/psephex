import type { ReactNode } from "react";
import type { Step, StepState } from "../lib/steps.js";

const MARK: Readonly<Record<StepState, { symbol: string; label: string; className: string }>> = {
  done: { symbol: "✓", label: "done", className: "bg-yes text-paper border-yes" },
  active: { symbol: "…", label: "in progress", className: "bg-paper text-ink border-bronze animate-pulse motion-reduce:animate-none" },
  waiting: { symbol: "", label: "not started", className: "bg-transparent text-muted border-line" },
  failed: { symbol: "✕", label: "stopped", className: "bg-no text-paper border-no" },
};

export function Steps({ steps, links }: { steps: readonly Step[]; links?: Partial<Record<Step["key"], ReactNode>> }) {
  return (
    <ol className="m-0 list-none p-0">
      {steps.map((s, i) => {
        const mark = MARK[s.state];
        return (
          <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden="true" className="absolute top-8 left-[15px] h-[calc(100%-2rem)] w-0.5 bg-line" />}
            <span aria-hidden="true" className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${mark.className}`}>
              {mark.symbol}
            </span>
            <div className="min-w-0 pt-1">
              <p className="m-0 font-medium">
                {s.title} <span className="sr-only">({mark.label})</span>
              </p>
              {s.detail && <p className={`m-0 text-sm ${s.state === "failed" ? "text-no" : "text-muted"}`}>{s.detail}</p>}
              {links?.[s.key] && <div className="mt-1 text-sm">{links[s.key]}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
