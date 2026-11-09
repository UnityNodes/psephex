import { keccak256, parseEventLogs, stringToBytes, type Log } from "viem";
import { disputeAbi } from "../abi.js";
import type { RequestDetail } from "../api.js";
import { DISPUTE_ADDRESS } from "../deployment.js";
import { SOURCE_SHORT, type Source } from "../sources.js";

export { ballots, type Ballot } from "./ballots.js";

export interface CaseInfo {
  readonly claimant: string;
  readonly counterparty: string;
  readonly amount: bigint;
  readonly deadline: bigint;
  readonly escalated: boolean;
  readonly settled: boolean;
}

export type StepKey = "asked" | "models" | "near" | "mpc" | "delivered" | "stored";
export type StepState = "done" | "active" | "waiting" | "failed";
export type Outcome = "pending" | "claimant" | "counterparty" | "escalated" | "refunded" | "settled" | "failed";

export interface Step {
  readonly key: StepKey;
  readonly title: string;
  readonly state: StepState;
  readonly detail: string | null;
}

function title(key: StepKey, source: Source): string {
  const chain = SOURCE_SHORT[source];
  switch (key) {
    case "asked":
      return source === "near" ? "Question asked on NEAR" : `Question recorded on ${chain}`;
    case "models":
      return "Three models answer in TEEs";
    case "near":
      return "NEAR checks signatures and 2 of 3";
    case "mpc":
      return `NEAR MPC signs the ${chain} transaction`;
    case "delivered":
      return `Answer delivered on ${chain}`;
    case "stored":
      return "Verdict stored on NEAR";
  }
}

/**
 * A NEAR request is answered inside the NEAR contract itself, so it has no MPC signature and no
 * delivery to another chain; showing those steps would claim work that never happens.
 */
export function stepOrder(source: Source): readonly StepKey[] {
  return source === "near" ? ["asked", "models", "near", "stored"] : ["asked", "models", "near", "mpc", "delivered"];
}
const ZERO_ADDRESS = /^0x0{40}$/i;

function caseExists(c: CaseInfo | null): c is CaseInfo {
  return c !== null && !ZERO_ADDRESS.test(c.claimant);
}

function completed(detail: RequestDetail | null, caseInfo: CaseInfo | null): Record<StepKey, boolean> {
  const signed = detail ? detail.models.length > 0 && detail.models.every((m) => m.signatureHex !== null) : false;
  return {
    asked: detail !== null || caseExists(caseInfo),
    models: signed,
    near: detail !== null && detail.answer !== null && detail.votes !== null,
    mpc: detail?.near.some((t) => t.ok === true) ?? false,
    delivered: detail?.base.some((t) => t.status === "success") ?? false,
    stored: detail?.near.some((t) => t.ok === true) ?? false,
  };
}

function activeDetail(key: StepKey, detail: RequestDetail | null, source: Source): string | null {
  if (key === "models") {
    if (!detail) return `Waiting for the relayer to see the question on ${SOURCE_SHORT[source]}`;
    const signed = detail.models.filter((m) => m.signatureHex !== null).length;
    return `${signed} of ${Math.max(detail.models.length, 3)} signed answers`;
  }
  return null;
}

function sameAddress(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Who received the stake is read from the chain, never from the API: a settled case pays the
 * winner named in the Dispute Settled event, and an escalated case can only settle by refund.
 */
function outcomeOf(detail: RequestDetail | null, caseInfo: CaseInfo | null, winner: string | null): Outcome {
  if (caseExists(caseInfo) && caseInfo.settled) {
    if (caseInfo.escalated) return "refunded";
    if (sameAddress(winner, caseInfo.claimant)) return "claimant";
    if (sameAddress(winner, caseInfo.counterparty)) return "counterparty";
    if (detail && (detail.status === "failed" || detail.status === "rejected")) return "refunded";
    return "settled";
  }
  if (caseExists(caseInfo) && caseInfo.escalated) return "escalated";
  if (detail && (detail.status === "failed" || detail.status === "rejected")) return "failed";
  return "pending";
}

export function settlementWinner(logs: readonly Log[], id: number, dispute: string = DISPUTE_ADDRESS): string | null {
  const own = logs.filter((l) => l.address.toLowerCase() === dispute.toLowerCase());
  const settled = parseEventLogs({ abi: disputeAbi, eventName: "Settled", logs: own }).find((e) => e.args.id === BigInt(id));
  return settled ? settled.args.winner : null;
}

export function questionMatchesChain(question: string, chainHash: string | null | undefined): boolean | null {
  if (!chainHash || /^0x0{64}$/i.test(chainHash)) return null;
  return keccak256(stringToBytes(question)).toLowerCase() === chainHash.toLowerCase();
}

export interface ProgressInput {
  readonly detail: RequestDetail | null;
  readonly caseInfo: CaseInfo | null;
  readonly winner?: string | null;
  readonly source?: Source;
}

export function deriveProgress(input: ProgressInput): { steps: Step[]; outcome: Outcome } {
  const { detail, caseInfo } = input;
  const source = input.source ?? detail?.source ?? "base";
  const order = stepOrder(source);
  const done = completed(detail, caseInfo);
  const stopped = detail !== null && (detail.status === "failed" || detail.status === "rejected");
  const firstOpen = order.findIndex((k) => !done[k]);
  const steps = order.map((key, i): Step => {
    const name = title(key, source);
    if (done[key]) return { key, title: name, state: "done", detail: null };
    if (i !== firstOpen) return { key, title: name, state: "waiting", detail: null };
    if (stopped) return { key, title: name, state: "failed", detail: detail.reason ?? detail.status };
    return { key, title: name, state: "active", detail: activeDetail(key, detail, source) };
  });
  return { steps, outcome: outcomeOf(detail, caseInfo, input.winner ?? null) };
}


export function canRefund(caseInfo: CaseInfo | null, nowSeconds: bigint): boolean {
  if (!caseExists(caseInfo) || caseInfo.settled) return false;
  return caseInfo.escalated || nowSeconds >= caseInfo.deadline;
}
