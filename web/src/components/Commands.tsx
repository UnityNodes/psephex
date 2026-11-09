import { useState } from "react";
import type { VerifyPlan } from "../api.js";

const MAX_COMMAND_LENGTH = 600;
const SAFE_COMMAND = /^(near|cast|jq|curl) [A-Za-z0-9 ._:/~'"|>()=,^[\]-]+$/;

/**
 * Commands come from the API and end up pasted into a terminal. A compromised API could hide a
 * second command behind padding, a newline or control characters, so anything outside the
 * printable shapes our own commands use is withheld instead of shown with a copy button.
 */
export function isSafeCommand(command: string): boolean {
  return command.length <= MAX_COMMAND_LENGTH && SAFE_COMMAND.test(command) && !/;|&|`|\$\(|\s{2,}/.test(command);
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="shrink-0 rounded border border-line px-2 py-1 text-xs font-medium hover:border-ink"
      onClick={() => {
        const clipboard = navigator.clipboard as Clipboard | undefined;
        if (!clipboard) {
          setState("failed");
          return;
        }
        clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        );
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

export function Commands({ plan }: { plan: VerifyPlan }) {
  return (
    <div className="min-w-0">
      {!plan.available && plan.reason && <p className="text-sm text-muted">The model signatures cannot be re-checked for this request: {plan.reason}.</p>}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {plan.steps.map((step, i) => (
          <li key={i} className="min-w-0">
            <p className="m-0 mb-1 text-sm font-medium">{step.title}</p>
            {isSafeCommand(step.command) ? (
              <div className="flex min-w-0 items-start gap-2 rounded bg-ink p-3 text-paper">
                <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">{step.command}</code>
                <CopyButton text={step.command} />
              </div>
            ) : (
              <p className="m-0 rounded border border-no p-3 text-sm text-no">This command failed a safety check and is not shown.</p>
            )}
            {step.expect && step.expect.length > 0 && <p className="m-0 mt-1 text-xs break-all text-muted">Expect: {step.expect.join(", ")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
