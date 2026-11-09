import type { RequestSummary } from "../api.js";

const FINAL: ReadonlySet<string> = new Set(["confirmed", "failed", "rejected"]);
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function tookSeconds(r: Pick<RequestSummary, "status" | "createdAt" | "updatedAt">): number | null {
  if (!FINAL.has(r.status)) return null;
  const ms = Date.parse(r.updatedAt) - Date.parse(r.createdAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(seconds)) return "";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return "just now";
}
