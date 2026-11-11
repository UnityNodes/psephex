import { Check, Copy } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { useState } from "react";
import type { VerifyPlan } from "../api.js";

const MAX_COMMAND_LENGTH = 600;
const TOOLS = ["near", "cast", "jq", "curl"] as const;
const SAFE_COMMAND = new RegExp(`^(${TOOLS.join("|")}) [A-Za-z0-9 ._:/~'"|>()=,^[\\]-]+$`);
const TOOL_AT_SEGMENT = new RegExp(`(?:^|\\|\\s*)(${TOOLS.join("|")})\\s`, "g");

/**
 * Commands come from the API and end up pasted into a terminal. A compromised API could hide a
 * second command behind padding, a newline or control characters, so anything outside the
 * printable shapes our own commands use is withheld instead of shown with a copy button.
 */
export function isSafeCommand(command: string): boolean {
  return command.length <= MAX_COMMAND_LENGTH && SAFE_COMMAND.test(command) && !/;|&|`|\$\(|\s{2,}/.test(command);
}

export function toolsUsed(plan: Pick<VerifyPlan, "steps">): string[] {
  const used = new Set<string>();
  for (const { command } of plan.steps) {
    if (!isSafeCommand(command)) continue;
    for (const match of command.matchAll(TOOL_AT_SEGMENT)) if (match[1]) used.add(match[1]);
  }
  return [...used];
}

type CopyState = "idle" | "copied" | "failed";

const STATE_TEXT: Readonly<Record<CopyState, string>> = { idle: "Copy", copied: "Copied", failed: "Copy failed" };

function accessibleName(state: CopyState, label: string | undefined): string | undefined {
  if (!label) return undefined;
  return state === "failed" ? `Could not copy ${label}` : `${STATE_TEXT[state]} ${label}`;
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const still = useReducedMotion() === true;
  return (
    <button
      type="button"
      aria-label={accessibleName(state, label)}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-vault-line px-3 text-xs font-medium text-vault-ink transition-colors duration-150 hover:border-bronze hover:text-bronze-hi"
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
      <m.span key={state} className="flex" initial={still ? false : { scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 500, damping: 22 }}>
        {state === "copied" ? <Check className="size-3.5 text-yes" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      </m.span>
      {STATE_TEXT[state]}
    </button>
  );
}

export function Commands({ plan }: { plan: VerifyPlan }) {
  return (
    <div className="min-w-0">
      {!plan.available && plan.reason && <p className="m-0 mb-4 rounded-md border-l-4 border-line bg-paper p-3 text-sm text-muted [overflow-wrap:anywhere]">Why: {plan.reason}.</p>}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {plan.steps.map((step, i) => (
          <li key={i} className="min-w-0">
            <p className="m-0 mb-1 text-sm font-medium">{step.title}</p>
            {isSafeCommand(step.command) ? (
              <div className="flex min-w-0 items-start gap-2 rounded-lg border border-vault-line bg-vault p-3 text-vault-ink">
                <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">{step.command}</code>
                <CopyButton text={step.command} label={`the step ${i + 1} command`} />
              </div>
            ) : (
              <p className="m-0 rounded-md border border-no p-3 text-sm text-no">This command failed a safety check and is not shown.</p>
            )}
            {step.expect && step.expect.length > 0 && <p className="m-0 mt-1 text-xs break-all text-muted">Expect: {step.expect.join(", ")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
