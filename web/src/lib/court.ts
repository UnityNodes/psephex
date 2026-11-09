import { isNearAccount, NEAR_COURT_CONTRACT } from "../deployment.js";
import { questionBytes } from "./dispute.js";
import { describeNearError, formatNear, parseNear } from "./near-dispute.js";

export const DEFAULT_MAX_FIELD_BYTES = 400;
export const MAX_ORACLE_QUESTION_BYTES = 2000;
export const WORST_CASE_QUESTION = "x".repeat(MAX_ORACLE_QUESTION_BYTES);
const TGAS = 1_000_000_000_000n;
export const OPEN_CASE_GAS = 100n * TGAS;
export const ASKING_GAS = 150n * TGAS;
export const SETTLE_GAS = 50n * TGAS;
const NS_PER_SECOND = 1_000_000_000n;
const CONTROL = /\p{Cc}/u;

export type Stage = "awaiting_response" | "asking" | "awaiting_verdict" | "decided" | "appealed" | "settled" | "refunded";
export type Winner = "claimant" | "counterparty";

export interface CourtCase {
  readonly claimant: string;
  readonly counterparty: string;
  readonly amount: string;
  readonly oracle_reserve: string;
  readonly oracle_paid: string | null;
  readonly claim: string;
  readonly evidence: string;
  readonly response: string | null;
  readonly stage: Stage;
  readonly opened_ns: string;
  readonly respond_by_ns: string;
  readonly asked_ns: string | null;
  readonly request_id: number | null;
  readonly answer_by_ns: string | null;
  readonly verdict: string | null;
  readonly appeal_by_ns: string | null;
  readonly appeal_bond: string;
  readonly appellant: string | null;
  readonly arbiter: string | null;
  readonly arbitrate_by_ns: string | null;
  readonly winner: string | null;
}

export interface CourtCaseView extends CourtCase {
  readonly case_id: number;
}

export interface RawCourtConfig {
  readonly owner: string;
  readonly oracle: string;
  readonly arbiter: string;
  readonly min_stake: string;
  readonly appeal_bond: string;
  readonly response_window_sec: number;
  readonly appeal_window_sec: number;
  readonly answer_timeout_sec: number;
  readonly arbitration_window_sec?: number;
  readonly max_field_bytes: number;
  readonly last_case_id: number;
}

export interface CourtConfig {
  readonly oracle: string;
  readonly arbiter: string;
  readonly minStake: bigint;
  readonly appealBond: bigint;
  readonly responseWindowSec: number;
  readonly appealWindowSec: number;
  readonly answerTimeoutSec: number;
  readonly maxFieldBytes: number;
  readonly lastCaseId: number;
}

export function courtConfigFrom(raw: RawCourtConfig): CourtConfig {
  return {
    oracle: raw.oracle,
    arbiter: raw.arbiter,
    minStake: BigInt(raw.min_stake),
    appealBond: BigInt(raw.appeal_bond),
    responseWindowSec: raw.response_window_sec,
    appealWindowSec: raw.appeal_window_sec,
    answerTimeoutSec: raw.answer_timeout_sec,
    maxFieldBytes: raw.max_field_bytes,
    lastCaseId: raw.last_case_id,
  };
}

export const FINAL_STAGES: ReadonlySet<Stage> = new Set(["settled", "refunded"]);

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  awaiting_response: "Waiting for the response",
  asking: "Sending to the oracle",
  awaiting_verdict: "Waiting for the verdict",
  decided: "Decided, appeal window open",
  appealed: "Appealed to the arbiter",
  settled: "Settled",
  refunded: "Refunded",
};

export interface CaseDeposit {
  readonly stake: bigint;
  readonly oracleReserve: bigint;
  readonly storageDeposit: bigint;
}

/**
 * The court keeps whatever is attached above the oracle reserve and the case storage as the
 * stake, so the wallet must attach all three. Less fails on chain after the user has signed.
 */
export function caseDepositTotal(d: CaseDeposit): bigint {
  return d.stake + d.oracleReserve + d.storageDeposit;
}

/**
 * The court embeds each party text as a JSON string and applies its limit to that escaped form,
 * so quotes and backslashes count twice. Counting the raw text would let a field pass here and
 * fail on chain after signing.
 */
/** The court refuses control characters, so line breaks and tabs typed into a field become spaces as they are typed. */
export function oneLine(text: string): string {
  return text.replace(/\p{Cc}+/gu, " ");
}

export function quotedBytes(text: string): number {
  return questionBytes(JSON.stringify(text));
}

export function fieldError(name: string, text: string, maxBytes: number): string | null {
  if (text.length === 0) return `Write the ${name}.`;
  if (CONTROL.test(text)) return `The ${name} must be one line: remove line breaks and tabs.`;
  const bytes = quotedBytes(text);
  if (bytes > maxBytes) return `The ${name} is ${bytes} bytes; the limit is ${maxBytes}.`;
  return null;
}

export interface CaseInput {
  readonly claim: string;
  readonly evidence: string;
  readonly counterparty: string;
  readonly stakeNear: string;
}

export interface ValidCase {
  readonly claim: string;
  readonly evidence: string;
  readonly counterparty: string;
  readonly stake: bigint;
}

export type CaseErrors = Partial<Record<"claim" | "evidence" | "counterparty" | "stake", string>>;
export type CaseValidation = { readonly ok: true; readonly value: ValidCase } | { readonly ok: false; readonly errors: CaseErrors };

export interface CaseLimits {
  readonly minStake: bigint;
  readonly maxFieldBytes: number;
}

export function validateCase(input: CaseInput, limits: CaseLimits, claimant: string | null): CaseValidation {
  const errors: CaseErrors = {};
  const claim = input.claim.trim();
  const evidence = input.evidence.trim();
  const claimError = fieldError("claim", claim, limits.maxFieldBytes);
  if (claimError) errors.claim = claimError;
  const evidenceError = fieldError("evidence", evidence, limits.maxFieldBytes);
  if (evidenceError) errors.evidence = evidenceError;

  const counterparty = input.counterparty.trim().toLowerCase();
  if (!isNearAccount(counterparty)) errors.counterparty = "Enter the counterparty's NEAR account, for example seller-agent.testnet.";
  else if (claimant !== null && counterparty === claimant) errors.counterparty = "The counterparty must be someone other than you.";

  const stake = parseNear(input.stakeNear);
  if (stake === null) errors.stake = "Enter the stake in NEAR, for example 0.1.";
  else if (stake < limits.minStake) errors.stake = `The minimum stake is ${formatNear(limits.minStake)} NEAR.`;

  if (Object.keys(errors).length > 0 || stake === null) return { ok: false, errors };
  return { ok: true, value: { claim, evidence, counterparty, stake } };
}

export type Role = "claimant" | "counterparty" | "other";

export function roleOf(c: Pick<CourtCase, "claimant" | "counterparty">, account: string | null): Role {
  if (account === c.claimant) return "claimant";
  if (account === c.counterparty) return "counterparty";
  return "other";
}

export type ActionKind = "respond" | "submit" | "appeal" | "finalize" | "refund";

export interface CaseAction {
  readonly kind: ActionKind;
  readonly args: Readonly<Record<string, unknown>>;
  readonly deposit: bigint;
  readonly gas: bigint;
}

export interface ActionContext {
  readonly account: string | null;
  readonly nowNs: bigint;
  readonly config: Pick<CourtConfig, "arbiter" | "appealBond" | "answerTimeoutSec">;
}

function ns(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

/** A decided case carries the bond fixed when its verdict landed; that, not today's config, is what `appeal` checks. */
export function appealBondOf(c: CourtCase, config: Pick<CourtConfig, "appealBond">): bigint {
  const own = BigInt(c.appeal_bond);
  return own > 0n ? own : config.appealBond;
}

function canAppeal(c: CourtCase, ctx: ActionContext): boolean {
  const appealBy = ns(c.appeal_by_ns);
  const arbiterIsParty = ctx.config.arbiter === c.claimant || ctx.config.arbiter === c.counterparty;
  return appealBy !== null && ctx.nowNs < appealBy && roleOf(c, ctx.account) !== "other" && !arbiterIsParty;
}

function canFinalize(c: CourtCase, nowNs: bigint): boolean {
  const deadline = c.stage === "decided" ? ns(c.appeal_by_ns) : c.stage === "appealed" ? ns(c.arbitrate_by_ns) : null;
  return deadline !== null && nowNs >= deadline;
}

export function askingRefundAt(c: CourtCase, answerTimeoutSec: number): bigint | null {
  const asked = ns(c.asked_ns);
  return asked === null ? null : asked + BigInt(answerTimeoutSec) * NS_PER_SECOND;
}

function canRefund(c: CourtCase, ctx: ActionContext): boolean {
  if (c.stage === "awaiting_verdict") {
    const answerBy = ns(c.answer_by_ns);
    return answerBy !== null && ctx.nowNs >= answerBy;
  }
  if (c.stage === "asking") {
    const at = askingRefundAt(c, ctx.config.answerTimeoutSec);
    return at !== null && ctx.nowNs >= at;
  }
  return false;
}

/**
 * Mirrors the court's own checks for who may call what and when, so the page only offers a call
 * the contract would accept from this account at this moment.
 */
export function availableActions(c: CourtCase, caseId: number, ctx: ActionContext): CaseAction[] {
  const id = { case_id: caseId };
  const actions: CaseAction[] = [];
  if (c.stage === "awaiting_response") {
    const open = ctx.nowNs < BigInt(c.respond_by_ns);
    if (open && roleOf(c, ctx.account) === "counterparty") actions.push({ kind: "respond", args: id, deposit: 0n, gas: ASKING_GAS });
    if (!open) actions.push({ kind: "submit", args: id, deposit: 0n, gas: ASKING_GAS });
  }
  if (c.stage === "decided" && canAppeal(c, ctx)) actions.push({ kind: "appeal", args: id, deposit: appealBondOf(c, ctx.config), gas: SETTLE_GAS });
  if (canFinalize(c, ctx.nowNs)) actions.push({ kind: "finalize", args: id, deposit: 0n, gas: SETTLE_GAS });
  if (canRefund(c, ctx)) actions.push({ kind: "refund", args: id, deposit: 0n, gas: SETTLE_GAS });
  return actions;
}

export function callText(methodName: string, args: Readonly<Record<string, unknown>>, deposit: bigint, gas: bigint): string {
  return `${methodName} ${JSON.stringify(args)}, deposit ${formatNear(deposit)} NEAR, ${gas / TGAS} Tgas`;
}

/**
 * The arbiter account comes from the RPC and lands inside a shell command, so anything that is
 * not a plain NEAR account id is refused rather than pasted into a terminal.
 */
export function arbiterCommand(caseId: number, winner: Winner, arbiter: string, court: string = NEAR_COURT_CONTRACT): string | null {
  if (!isNearAccount(arbiter) || !isNearAccount(court) || !Number.isSafeInteger(caseId) || caseId <= 0) return null;
  const args = JSON.stringify({ case_id: caseId, winner });
  return `near contract call-function as-transaction ${court} arbitrate json-args '${args}' prepaid-gas '${SETTLE_GAS / TGAS} Tgas' attached-deposit '0 NEAR' sign-as ${arbiter} network-config testnet sign-with-keychain send`;
}

export function secondsLeft(deadlineNs: bigint, nowNs: bigint): number {
  const left = deadlineNs - nowNs;
  return left <= 0n ? 0 : Number((left + NS_PER_SECOND - 1n) / NS_PER_SECOND);
}

export function countdown(deadlineNs: bigint, nowNs: bigint): string {
  const total = secondsLeft(deadlineNs, nowNs);
  if (total === 0) return "ended";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min left`;
  if (m > 0) return `${m} min ${s} s left`;
  return `${s} s left`;
}

export type TimelineState = "done" | "active" | "waiting" | "failed";

export interface TimelineStep {
  readonly key: string;
  readonly title: string;
  readonly state: TimelineState;
  readonly detail: string | null;
}

function step(key: string, title: string, state: TimelineState, detail: string | null = null): TimelineStep {
  return { key, title, state, detail };
}

export function verdictWinner(c: Pick<CourtCase, "verdict" | "claimant" | "counterparty">): string {
  return c.verdict === "NO" ? c.counterparty : c.claimant;
}

function responseStep(c: CourtCase, nowNs: bigint): TimelineStep {
  if (c.response !== null) return step("response", "Response", "done", `${c.counterparty} answered`);
  if (c.stage !== "awaiting_response") return step("response", "Response", "done", "No response within the window");
  const respondBy = BigInt(c.respond_by_ns);
  if (nowNs < respondBy) return step("response", "Response", "active", `${c.counterparty} can answer: ${countdown(respondBy, nowNs)}`);
  return step("response", "Response", "active", "The window is over; anyone can send the case to the oracle");
}

function askedStep(c: CourtCase): TimelineStep {
  if (c.request_id !== null) return step("asked", "Asked oracle", "done", `Oracle request #${c.request_id}`);
  if (c.stage === "asking") return step("asked", "Asked oracle", "active", "Waiting for the oracle to accept the question");
  if (c.stage === "refunded") return step("asked", "Asked oracle", "failed", "The question did not reach the oracle");
  return step("asked", "Asked oracle", "waiting");
}

function verdictStep(c: CourtCase, nowNs: bigint): TimelineStep {
  if (c.verdict !== null) return step("verdict", "Verdict", "done", c.verdict);
  const answerBy = ns(c.answer_by_ns);
  if (c.stage === "refunded") return step("verdict", "Verdict", "failed", "The oracle did not answer in time");
  if (c.stage === "awaiting_verdict" && answerBy !== null) {
    if (nowNs < answerBy) return step("verdict", "Verdict", "active", `Three models are answering: ${countdown(answerBy, nowNs)} before a refund opens`);
    return step("verdict", "Verdict", "failed", "The oracle did not answer in time; anyone can refund the stake");
  }
  return step("verdict", "Verdict", "waiting");
}

function appealWindowStep(c: CourtCase, nowNs: bigint): TimelineStep {
  const appealBy = ns(c.appeal_by_ns);
  if (c.appellant !== null) return step("appeal-window", "Appeal window", "done", `${c.appellant} appealed`);
  if (c.stage === "settled") return step("appeal-window", "Appeal window", "done", "Nobody appealed");
  if (c.stage === "decided" && appealBy !== null) {
    if (nowNs < appealBy) return step("appeal-window", "Appeal window", "active", `Either party can appeal: ${countdown(appealBy, nowNs)}`);
    return step("appeal-window", "Appeal window", "active", "The window is over; anyone can finalize");
  }
  return step("appeal-window", "Appeal window", "waiting");
}

function arbiterStep(c: CourtCase, nowNs: bigint): TimelineStep {
  if (c.stage === "settled") return step("arbiter", "Arbiter ruling", "done", c.winner ? `${c.winner} got the stake` : null);
  const by = ns(c.arbitrate_by_ns);
  if (by !== null && nowNs >= by) return step("arbiter", "Arbiter ruling", "failed", "The arbiter did not rule in time; anyone can finalize by the verdict");
  return step("arbiter", "Arbiter ruling", "active", by !== null ? `${c.arbiter ?? "The arbiter"} can rule: ${countdown(by, nowNs)}` : "Waiting for the arbiter");
}

export function caseTimeline(c: CourtCase, nowNs: bigint): TimelineStep[] {
  const opened = step("opened", "Opened", "done", `${c.claimant} staked ${formatNear(BigInt(c.amount))} NEAR`);
  const head = [opened, responseStep(c, nowNs), askedStep(c)];
  if (c.stage === "refunded") {
    const tail = c.request_id !== null ? [verdictStep(c, nowNs)] : [];
    return [...head, ...tail, step("refunded", "Refunded", "done", `The stake went back to ${c.claimant}`)];
  }
  const middle = [verdictStep(c, nowNs), appealWindowStep(c, nowNs)];
  if (c.appellant !== null) return [...head, ...middle, step("appealed", "Appealed", "done", `Bond ${formatNear(BigInt(c.appeal_bond))} NEAR`), arbiterStep(c, nowNs)];
  const settled = c.stage === "settled";
  const pending = c.stage === "decided" ? `If nobody appeals, ${verdictWinner(c)} gets the stake` : null;
  return [...head, ...middle, step("settled", "Settled", settled ? "done" : "waiting", settled && c.winner ? `${c.winner} got the stake` : pending)];
}

const COURT_ERRORS: readonly (readonly [RegExp, string])[] = [
  [/(claim|evidence|response) too long/i, "The text is longer than the court accepts."],
  [/must not contain control characters/i, "The text must be one line, without line breaks or tabs."],
  [/must not be empty/i, "The text must not be empty."],
  [/stake too low/i, "The stake is below the minimum the court accepts."],
  [/attach a stake above/i, "The deposit does not cover the oracle reserve and storage. Reload the page to read the current amounts."],
  [/counterparty must differ/i, "The counterparty must be someone other than you."],
  [/only the counterparty can respond/i, "Only the counterparty can respond to this case."],
  [/response window is over/i, "The response window is over."],
  [/counterparty can still respond/i, "The counterparty can still respond; try again after the window."],
  [/not waiting for a response/i, "The case has already moved on from the response stage."],
  [/only a party can appeal/i, "Only the claimant or the counterparty can appeal."],
  [/arbiter is a party/i, "The arbiter is a party to this case, so it cannot be appealed."],
  [/attach exactly the appeal bond/i, "The deposit must equal the appeal bond exactly. Reload the page to read it."],
  [/appeal window is over/i, "The appeal window is over."],
  [/appeal window is still open/i, "The appeal window is still open; finalize after it ends."],
  [/arbiter can still rule/i, "The arbiter can still rule; finalize after the arbitration window."],
  [/oracle can still answer|request can still go through/i, "The oracle can still answer; the refund opens after its deadline."],
  [/unknown case/i, "There is no court case with this number."],
];

export function describeCourtError(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [pattern, message] of COURT_ERRORS) if (pattern.test(text)) return message;
  return describeNearError(err);
}

export interface CaseExample {
  readonly label: string;
  readonly claim: string;
  readonly evidence: string;
}

export const CASE_EXAMPLES: readonly CaseExample[] = [
  {
    label: "Dataset short by 40 rows",
    claim: "I paid for a 100-row dataset of EU company records and the seller agent delivered only 60 rows.",
    evidence: "Order: 100 rows of EU company records with name, country and VAT id, due 2026-11-05. The delivered file companies.csv, received 2026-11-05, has a header row and 60 data rows.",
  },
  {
    label: "Translation delivered late",
    claim: "The translation agent delivered my translation two days after the agreed deadline.",
    evidence: "Order: translate a 4-page contract from German to English by 2026-11-01 12:00 UTC. The delivery message with the translated file is timestamped 2026-11-03 09:14 UTC.",
  },
  {
    label: "Logo the buyer calls ugly",
    claim: "The logo the design agent delivered does not fulfil the order, because it is ugly.",
    evidence: "Order: a logo for a coffee shop, PNG, at least 512x512 pixels. The delivered logo.png is 1024x1024 pixels, PNG, a brown cup on a white background.",
  },
];

export function caseIdFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface AgentReputation {
  readonly account: string;
  readonly cases: number;
  readonly open: number;
  readonly won: number;
  readonly lost: number;
  readonly refunded: number;
  readonly appeals_filed: number;
  readonly named_as_counterparty: number;
  readonly did_not_respond: number;
  readonly win_rate: number | null;
}

type RecordFields = Pick<CourtCase, "claimant" | "counterparty" | "stage" | "winner" | "response" | "appellant">;

export function isPartyTo(c: Pick<CourtCase, "claimant" | "counterparty">, account: string): boolean {
  return c.claimant === account || c.counterparty === account;
}

/**
 * Agents read the same record through the MCP server's `reputationOf`, so this counts exactly
 * the same way: only settled cases are won or lost, and silence is a counterparty without a
 * response once the case has moved past awaiting_response.
 */
export function reputationOf(account: string, cases: readonly RecordFields[]): AgentReputation {
  const mine = cases.filter((c) => isPartyTo(c, account));
  const settled = mine.filter((c) => c.stage === "settled");
  const won = settled.filter((c) => c.winner === account).length;
  const asCounterparty = mine.filter((c) => c.counterparty === account);
  return {
    account,
    cases: mine.length,
    open: mine.filter((c) => !FINAL_STAGES.has(c.stage)).length,
    won,
    lost: settled.length - won,
    refunded: mine.filter((c) => c.stage === "refunded").length,
    appeals_filed: mine.filter((c) => c.appellant === account).length,
    named_as_counterparty: asCounterparty.length,
    did_not_respond: asCounterparty.filter((c) => c.response === null && c.stage !== "awaiting_response").length,
    win_rate: settled.length === 0 ? null : Math.round((won / settled.length) * 100) / 100,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function reputationLine(r: AgentReputation): string {
  if (r.cases === 0) return "No cases yet";
  const settled = r.won + r.lost;
  const head = settled > 0 ? `Won ${r.won} of ${plural(settled, "settled case")}` : r.open > 0 ? `No settled cases yet; ${r.open} open` : `No settled cases; ${r.refunded} refunded`;
  return r.did_not_respond > 0 ? `${head}; did not answer ${plural(r.did_not_respond, "case")}` : head;
}

export type AgentOutcome = "won" | "lost" | "refunded" | "open";

export function outcomeFor(c: Pick<CourtCase, "stage" | "winner">, account: string): AgentOutcome {
  if (c.stage === "refunded") return "refunded";
  if (c.stage !== "settled") return "open";
  return c.winner === account ? "won" : "lost";
}

export function agentCases<T extends CourtCaseView>(account: string, cases: readonly T[]): T[] {
  return cases.filter((c) => isPartyTo(c, account)).sort((a, b) => b.case_id - a.case_id);
}
