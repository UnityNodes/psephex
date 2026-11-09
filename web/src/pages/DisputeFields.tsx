import { BallotDisc } from "../components/Ballots.js";
import { EXAMPLES } from "../lib/dispute.js";

export const FIELD = "w-full rounded-lg border border-line bg-paper px-3 py-2.5 text-base text-ink transition-colors duration-150 placeholder:text-muted hover:border-muted focus:border-bronze aria-invalid:border-no";

export function ExamplePicker({ onPick }: { onPick: (question: string) => void }) {
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">Start from an example</legend>
      <div className="flex flex-col gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.expected}
            type="button"
            onClick={() => onPick(ex.question)}
            className="flex items-center gap-3 rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-left transition-colors duration-150 hover:border-bronze hover:bg-paper"
          >
            <BallotDisc vote={ex.expected} size={28} />
            <span className="min-w-0">
              <span className="block font-medium">{ex.label}</span>
              <span className="block text-xs text-muted">{ex.evidence}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
