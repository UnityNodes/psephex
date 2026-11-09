import { keccak256, parseEventLogs, stringToBytes, type Log } from "viem";
import { disputeAbi } from "../abi.js";
import type { Answer, RequestDetail } from "../api.js";
import { DISPUTE_ADDRESS } from "../deployment.js";

export interface CaseInfo {
  readonly claimant: string;
  readonly counterparty: string;
  readonly amount: bigint;
  readonly deadline: bigint;
  readonly escalated: boolean;
  readonly settled: boolean;
}

export type StepKey = "asked" | "models" | "near" | "mpc" | "base";
export type StepState = "done" | "active" | "waiting" | "failed";
export type Outcome = "pending" | "claimant" | "counterparty" | "escalated" | "refunded" | "settled" | "failed";

export interface Step {
  readonly key: StepKey;
  readonly title: string;
  readonly state: StepState;
  readonly detail: string | null;
}

export interface Ballot {
  readonly model: string;
  readonly vote: Answer | null;
  readonly signed: boolean;
}

const TITLES: Readonly<Record<StepKey, string>> = {
  asked: "Question recorded on Base",
  models: "Three models answer in TEEs",
  near: "NEAR checks signatures and 2 of 3",
  mpc: "NEAR MPC signs the Base transaction",
  base: "Answer delivered on Base",
};

const ORDER: readonly StepKey[] = ["asked", "models", "near", "mpc", "base"];
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
    base: detail?.base.some((t) => t.status === "success") ?? false,
  };
}

function activeDetail(key: StepKey, detail: RequestDetail | null): string | null {
  if (key === "models") {
    if (!detail) return "Waiting for the relayer to see the question (about 10 Base blocks)";
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

export function settlementWinner(logs: readonly Log[], id: number): string | null {
  const own = logs.filter((l) => l.address.toLowerCase() === DISPUTE_ADDRESS.toLowerCase());
  const settled = parseEventLogs({ abi: disputeAbi, eventName: "Settled", logs: own }).find((e) => e.args.id === BigInt(id));
  return settled ? settled.args.winner : null;
}

export function questionMatchesChain(question: string, chainHash: string | null | undefined): boolean | null {
  if (!chainHash || /^0x0{64}$/i.test(chainHash)) return null;
  return keccak256(stringToBytes(question)).toLowerCase() === chainHash.toLowerCase();
}

export function deriveProgress(input: { readonly detail: RequestDetail | null; readonly caseInfo: CaseInfo | null; readonly winner?: string | null }): { steps: Step[]; outcome: Outcome } {
  const { detail, caseInfo } = input;
  const done = completed(detail, caseInfo);
  const stopped = detail !== null && (detail.status === "failed" || detail.status === "rejected");
  const firstOpen = ORDER.findIndex((k) => !done[k]);
  const steps = ORDER.map((key, i): Step => {
    if (done[key]) return { key, title: TITLES[key], state: "done", detail: null };
    if (i !== firstOpen) return { key, title: TITLES[key], state: "waiting", detail: null };
    if (stopped) return { key, title: TITLES[key], state: "failed", detail: detail.reason ?? detail.status };
    return { key, title: TITLES[key], state: "active", detail: activeDetail(key, detail) };
  });
  return { steps, outcome: outcomeOf(detail, caseInfo, input.winner ?? null) };
}

export function ballots(detail: RequestDetail): Ballot[] {
  const votes = new Map((detail.votes ?? []).map((v) => [v.model, v.answer]));
  return detail.models.map((m) => ({ model: m.model, vote: m.signatureHex !== null ? (votes.get(m.model) ?? null) : null, signed: m.signatureHex !== null }));
}

export function canRefund(caseInfo: CaseInfo | null, nowSeconds: bigint): boolean {
  if (!caseExists(caseInfo) || caseInfo.settled) return false;
  return caseInfo.escalated || nowSeconds >= caseInfo.deadline;
}
