import { useState, type ReactNode } from "react";
import { NearAccount } from "../components/NearAccount.js";
import { Button } from "../components/ui/button.js";
import { NEAR_COURT_CONTRACT } from "../deployment.js";
import { availableActions, callText, describeCourtError, fieldError, oneLine, roleOf, verdictWinner, type ActionKind, type CaseAction, type CourtCase, type CourtConfig } from "../lib/court.js";
import { formatNear } from "../lib/near-dispute.js";
import { useNearRpc } from "../near/rpc.js";
import { useNearWallet } from "../near/wallet.js";
import { ByteHelp } from "./CaseForm.js";
import { FIELD } from "./DisputeFields.js";

const LABEL: Readonly<Record<ActionKind, string>> = {
  respond: "Send the response",
  submit: "Send to the oracle without a response",
  appeal: "Appeal to the arbiter",
  finalize: "Finalize and pay out",
  refund: "Refund the stake to the claimant",
};

function explain(kind: ActionKind, c: CourtCase, deposit: bigint): string {
  switch (kind) {
    case "respond":
      return "Your evidence goes next to the claim, and the court sends the question to the oracle in the same transaction.";
    case "submit":
      return "The counterparty did not answer in time. Anyone can send the case on; the question will say there was no response.";
    case "appeal":
      return `You attach exactly ${formatNear(deposit)} NEAR as a bond. If the arbiter rules for you, you get it back; if not, it goes to the other side.`;
    case "finalize":
      return c.stage === "appealed"
        ? `The arbiter did not rule in time, so the verdict stands: ${verdictWinner(c)} gets the stake and the appellant gets the bond back.`
        : `Nobody appealed. ${verdictWinner(c)} gets the stake.`;
    case "refund":
      return "The oracle did not answer in time. Anyone can send the refund; the stake always goes to the claimant.";
  }
}

function ActionRow({ action, c, account, maxBytes, onDone }: { action: CaseAction; c: CourtCase; account: string | null; maxBytes: number; onDone: () => void }) {
  const wallet = useNearWallet();
  const rpc = useNearRpc();
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const responding = action.kind === "respond";
  const args = responding ? { ...action.args, response: response.trim() } : action.args;
  const shownArgs = responding ? { ...action.args, response: response.trim() || "<your response>" } : action.args;

  async function handleClick() {
    if (!account) return;
    if (responding) {
      const error = fieldError("response", response.trim(), maxBytes);
      if (error) {
        setMessage(error);
        return;
      }
    }
    setBusy(true);
    setMessage(null);
    try {
      const hash = await wallet.call({ receiverId: NEAR_COURT_CONTRACT, methodName: action.kind, args, gas: action.gas, deposit: action.deposit });
      const result = await rpc.txResult(hash, account);
      if (!result.ok) throw new Error(result.error);
      setResponse("");
      onDone();
    } catch (err) {
      setMessage(describeCourtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {responding && (
        <div className="flex flex-col gap-1">
          <label htmlFor="case-response" className="font-medium">
            Your response and evidence
          </label>
          <textarea id="case-response" rows={4} value={response} onChange={(e) => setResponse(oneLine(e.target.value))} aria-describedby="case-response-help" className={FIELD} />
          <ByteHelp id="case-response-help" text={response} max={maxBytes} error={undefined} hint="The models read it next to the claim." />
        </div>
      )}
      <p className="m-0 text-sm text-muted">{explain(action.kind, c, action.deposit)}</p>
      <code className="block rounded-md border border-line bg-stone px-2 py-1.5 font-mono text-xs break-all">{callText(action.kind, shownArgs, action.deposit, action.gas)}</code>
      <Button type="button" disabled={!account || busy} onClick={() => void handleClick()} className="self-start">
        {busy ? "Confirm in your wallet…" : LABEL[action.kind]}
      </Button>
      {message && (
        <p role="alert" className="m-0 text-sm text-no">
          {message}
        </p>
      )}
    </li>
  );
}

function waitingText(c: CourtCase, account: string | null): string {
  const role = roleOf(c, account);
  switch (c.stage) {
    case "awaiting_response":
      return role === "claimant" ? "Waiting for the counterparty to respond. After the window anyone can send the case to the oracle." : "Only the counterparty can respond in the window. After it, anyone can send the case to the oracle.";
    case "asking":
    case "awaiting_verdict":
      return "Nothing to do: the oracle is working on the question.";
    case "decided":
      return role === "other" ? "The parties can appeal until the window closes. After that, anyone can finalize." : "Nothing to do now.";
    case "appealed":
      return "Waiting for the arbiter. If the arbiter does not rule in time, anyone can finalize by the verdict.";
    default:
      return "This case is closed.";
  }
}

export function CaseActions({ c, caseId, config, nowNs, onDone }: { c: CourtCase; caseId: number; config: CourtConfig; nowNs: bigint; onDone: () => void }) {
  const wallet = useNearWallet();
  const account = wallet.accountId;
  const actions = availableActions(c, caseId, { account, nowNs, config });
  const role = roleOf(c, account);
  const youAre: ReactNode = account ? <>You are {role === "other" ? "not a party to this case" : `the ${role}`}.</> : "Connect a NEAR wallet to act on this case.";
  return (
    <section aria-labelledby="actions-heading" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line border-l-4 border-l-bronze bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="actions-heading" className="m-0 font-display text-xl font-semibold">
          What you can do
        </h2>
        <NearAccount />
      </div>
      <p className="m-0 text-sm">{youAre}</p>
      {actions.length === 0 ? (
        <p className="m-0 text-sm text-muted">{waitingText(c, account)}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {actions.map((a) => (
            <ActionRow key={a.kind} action={a} c={c} account={account} maxBytes={config.maxFieldBytes} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  );
}
