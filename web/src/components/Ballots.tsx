import { useId } from "react";
import type { Answer } from "../api.js";
import type { Ballot } from "../lib/ballots.js";

const COLOR: Readonly<Record<Answer, string>> = { YES: "var(--color-yes)", NO: "var(--color-no)", UNKNOWN: "var(--color-unknown)" };
const TEXT_CLASS: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };
const MEANING: Readonly<Record<Answer, string>> = { YES: "yes", NO: "no", UNKNOWN: "cannot tell" };

function shortName(model: string): string {
  return model.split("/").at(-1) ?? model;
}

export function BallotDisc({ vote, size = 64, drop = true }: { vote: Answer | null; size?: number; drop?: boolean }) {
  const metal = `psephos-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!vote) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="25" fill="none" stroke="var(--color-muted)" strokeWidth="2" strokeDasharray="4 4" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={drop ? "ballot-drop" : undefined}>
      <defs>
        <radialGradient id={metal} cx="34%" cy="28%" r="78%">
          <stop offset="0" stopColor="var(--bronze-hi)" />
          <stop offset="0.55" stopColor="var(--bronze)" />
          <stop offset="1" stopColor="var(--bronze-lo)" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="none" stroke={COLOR[vote]} strokeWidth="3" />
      <circle cx="32" cy="32" r="23.5" fill={`url(#${metal})`} />
      {vote !== "UNKNOWN" && <rect x="30" y="1" width="4" height="62" rx="2" fill="var(--axle)" />}
      {vote === "YES" && <circle cx="32" cy="32" r="7.5" fill="var(--axle)" />}
      {vote === "NO" && <circle cx="32" cy="32" r="6.5" fill={`url(#${metal})`} stroke="var(--axle)" strokeWidth="4" />}
      {vote === "UNKNOWN" && <circle cx="32" cy="32" r="7" fill="none" stroke="var(--axle)" strokeWidth="3" strokeDasharray="3 3" />}
    </svg>
  );
}

export function Ballots({ ballots, verdict, compact = false, stopped = false }: { ballots: readonly Ballot[]; verdict: Answer | null; compact?: boolean; stopped?: boolean }) {
  const slots = ballots.length > 0 ? ballots : [null, null, null];
  const agree = ballots.filter((b) => b.vote === verdict).length;
  return (
    <figure className="m-0">
      <ul className={`m-0 grid list-none grid-cols-3 p-0 ${compact ? "gap-2" : "gap-2 sm:flex sm:flex-wrap sm:gap-6"}`} aria-label="Model votes">
        {slots.map((b, i) => (
          <li key={b?.model ?? i} className={`flex flex-col items-center gap-2 text-center ${compact ? "" : "sm:w-28"}`}>
            <BallotDisc vote={b?.vote ?? null} size={compact ? 48 : 64} />
            <span className={`font-medium break-words ${compact ? "text-xs" : "text-sm"}`}>{b ? shortName(b.model) : "Waiting"}</span>
            <span className="text-xs text-muted">{stopped && !b?.signed ? "not counted" : b?.vote ? `${MEANING[b.vote]}, signed` : b?.signed ? "signed" : "no answer yet"}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-base">
        {verdict ? (
          <>
            {agree} of {slots.length} signed answers say <strong className={TEXT_CLASS[verdict]}>{verdict}</strong>; two are enough.
          </>
        ) : stopped ? (
          "Stopped before a verdict."
        ) : (
          "The verdict needs two matching signed answers."
        )}
      </figcaption>
    </figure>
  );
}
