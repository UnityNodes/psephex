import type { Health } from "../api.js";
import { useHealth } from "../hooks.js";

type Tone = "ok" | "warn" | "down";

const DOT: Readonly<Record<Tone, string>> = { ok: "bg-yes", warn: "bg-bronze", down: "bg-no" };

export function baseLagText(lagBlocks: string): string {
  const lag = Number(lagBlocks);
  if (!Number.isFinite(lag)) return "Base lag unknown";
  if (lag <= 0) return "Base in sync";
  return `Base ${lag} ${lag === 1 ? "block" : "blocks"} behind`;
}

export function relayerState(health: Health | undefined, failed: boolean): { tone: Tone; label: string } {
  if (failed) return { tone: "down", label: "API unreachable" };
  if (!health) return { tone: "warn", label: "Checking…" };
  if (health.status !== "ok" || health.base.stale || health.near.stale || health.errors.length > 0) return { tone: "warn", label: "Degraded" };
  return { tone: "ok", label: "Running" };
}

export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span aria-hidden="true" className="relative flex size-2">
      {tone === "ok" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-yes opacity-60 motion-reduce:animate-none" />}
      <span className={`relative inline-flex size-2 rounded-full ${DOT[tone]}`} />
    </span>
  );
}

export function NetworkStatus() {
  const health = useHealth();
  const state = relayerState(health.data, health.isError);
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-stone/60 p-3 text-xs">
      <p className="m-0 flex items-center gap-2 font-medium text-ink">
        <StatusDot tone={state.tone} />
        Relayer {state.label.toLowerCase()}
      </p>
      {health.data && (
        <p className="m-0 text-muted">
          {baseLagText(health.data.base.lagBlocks)}, {health.data.budget.modelCalls} of {health.data.budget.dailyLimit} model calls today
        </p>
      )}
    </div>
  );
}
