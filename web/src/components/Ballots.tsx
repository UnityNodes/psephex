import type { Answer } from "../api.js";
import type { Ballot } from "../lib/steps.js";

const COLOR: Readonly<Record<Answer, string>> = { YES: "var(--color-yes)", NO: "var(--color-no)", UNKNOWN: "var(--color-unknown)" };
const TEXT_CLASS: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };
const MEANING: Readonly<Record<Answer, string>> = { YES: "yes", NO: "no", UNKNOWN: "cannot tell" };

function shortName(model: string): string {
  return model.split("/").at(-1) ?? model;
}

export function BallotDisc({ vote, size = 64 }: { vote: Answer | null; size?: number }) {
  const color = vote ? COLOR[vote] : "transparent";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={vote ? "ballot-drop" : undefined}>
      <circle cx="32" cy="32" r="26" fill={color} stroke={vote ? color : "var(--color-line)"} strokeWidth="2" strokeDasharray={vote ? undefined : "4 4"} />
      {vote && vote !== "UNKNOWN" && <rect x="30" y="3" width="4" height="58" rx="2" fill="var(--color-ink)" />}
      {vote === "YES" && <circle cx="32" cy="32" r="8" fill="var(--color-ink)" />}
      {vote === "NO" && <circle cx="32" cy="32" r="7" fill={color} stroke="var(--color-ink)" strokeWidth="4" />}
      {vote === "UNKNOWN" && <circle cx="32" cy="32" r="7" fill="none" stroke="var(--color-paper)" strokeWidth="3" strokeDasharray="3 3" />}
    </svg>
  );
}

export function Ballots({ ballots, verdict }: { ballots: readonly Ballot[]; verdict: Answer | null }) {
  const slots = ballots.length > 0 ? ballots : [null, null, null];
  const agree = ballots.filter((b) => b.vote === verdict).length;
  return (
    <figure className="m-0">
      <ul className="m-0 flex list-none flex-wrap gap-6 p-0" aria-label="Model votes">
        {slots.map((b, i) => (
          <li key={b?.model ?? i} className="flex w-28 flex-col items-center gap-2 text-center">
            <BallotDisc vote={b?.vote ?? null} />
            <span className="text-sm font-medium break-words">{b ? shortName(b.model) : "Waiting"}</span>
            <span className="text-xs text-muted">{b?.vote ? `${MEANING[b.vote]}, signed` : b?.signed ? "signed" : "no answer yet"}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-4 text-base">
        {verdict ? (
          <>
            {agree} of {slots.length} signed answers say <strong className={TEXT_CLASS[verdict]}>{verdict}</strong>; two are enough.
          </>
        ) : (
          "The verdict needs two matching signed answers."
        )}
      </figcaption>
    </figure>
  );
}
