import { formatNear, isAccountId, parseNear, type Config } from "./config.js";
import type { NearPort } from "./near.js";

export interface Case {
  readonly case_id?: number;
  readonly claimant: string;
  readonly counterparty: string;
  readonly amount: string;
  readonly claim: string;
  readonly evidence: string;
  readonly response: string | null;
  readonly stage: string;
  readonly respond_by_ns: string;
  readonly request_id: number | null;
  readonly verdict: string | null;
  readonly appeal_by_ns: string | null;
  readonly appeal_bond: string;
  readonly appellant: string | null;
  readonly arbiter: string | null;
  readonly arbitrate_by_ns: string | null;
  readonly winner: string | null;
}

const OPEN_GAS = 100;
const ASK_GAS = 150;
const PARTY_GAS = 50;
const PAGE = 50;
const MAX_PAGES = 40;
const NEAR = 10n ** 24n;
const MAX_ORACLE_RESERVE = NEAR + NEAR / 20n;
const MAX_STORAGE = NEAR / 20n;
const WORST_QUESTION = "x".repeat(2000);

function iso(ns: string | null): string | null {
  return ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : null;
}

export function describeCase(id: number, c: Case): Record<string, unknown> {
  return {
    case_id: id,
    stage: c.stage,
    claimant: c.claimant,
    counterparty: c.counterparty,
    stake_near: formatNear(BigInt(c.amount)),
    claim: c.claim,
    evidence: c.evidence,
    response: c.response,
    respond_by: iso(c.respond_by_ns),
    oracle_request: c.request_id,
    verdict: c.verdict,
    appeal_by: iso(c.appeal_by_ns),
    appeal_bond_near: c.appeal_bond === "0" ? null : formatNear(BigInt(c.appeal_bond)),
    appellant: c.appellant,
    arbiter: c.arbiter,
    arbitrate_by: iso(c.arbitrate_by_ns),
    winner: c.winner,
  };
}

export class Court {
  constructor(
    private readonly near: NearPort,
    private readonly cfg: Config,
  ) {}

  async config(): Promise<Record<string, unknown>> {
    return this.near.view(this.cfg.court, "config", {});
  }

  /**
   * The deposit has three parts the agent cannot see in advance: the oracle's price for the
   * longest question (the unused part comes back when the case is asked), the court's storage,
   * and the stake. Prices come from the RPC, so they are bounded by the contracts' own limits.
   */
  async quoteOpen(claim: string, evidence: string, stake: bigint): Promise<{ reserve: bigint; storage: bigint; total: bigint }> {
    const [reserveRaw, storageRaw] = await Promise.all([
      this.near.view<string>(this.cfg.oracle, "ask_deposit", { question: WORST_QUESTION }),
      this.near.view<string>(this.cfg.court, "storage_deposit", { claim, evidence }),
    ]);
    const reserve = BigInt(reserveRaw);
    const storage = BigInt(storageRaw);
    if (reserve <= 0n || reserve > MAX_ORACLE_RESERVE) throw new Error("the RPC returned an oracle price outside the contract limits");
    if (storage < 0n || storage > MAX_STORAGE) throw new Error("the RPC returned a storage price outside the contract limits");
    return { reserve, storage, total: stake + reserve + storage };
  }

  private requireSigner(): void {
    if (this.cfg.accountId === null) throw new Error("this server is read-only: set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to act");
  }

  async openCase(claim: string, evidence: string, counterparty: string, stakeNear: string): Promise<Record<string, unknown>> {
    this.requireSigner();
    if (counterparty === this.cfg.accountId) throw new Error("you cannot open a case against yourself");
    const stake = parseNear(stakeNear);
    if (stake === null || stake <= 0n) throw new Error("stake_near must be a positive NEAR amount like 0.05");
    if (stake > this.cfg.maxStakeYocto) throw new Error(`stake ${stakeNear} NEAR is above this agent's cap of ${formatNear(this.cfg.maxStakeYocto)} NEAR`);
    if (!isAccountId(counterparty)) throw new Error("counterparty must be a NEAR account id");
    if (!(await this.near.accountExists(counterparty))) throw new Error(`${counterparty} does not exist on NEAR`);
    const q = await this.quoteOpen(claim, evidence, stake);
    const out = await this.near.call(this.cfg.court, "open_case", { claim, evidence, counterparty, oracle_reserve: q.reserve.toString() }, q.total, OPEN_GAS);
    return { case_id: out.value, tx: out.txHash, paid_near: formatNear(q.total), stake_near: formatNear(stake), oracle_reserve_near: formatNear(q.reserve), storage_near: formatNear(q.storage) };
  }

  async respond(caseId: number, response: string): Promise<Record<string, unknown>> {
    this.requireSigner();
    const out = await this.near.call(this.cfg.court, "respond", { case_id: caseId, response }, 0n, ASK_GAS);
    return { case_id: caseId, tx: out.txHash, oracle_request: out.value };
  }

  async submit(caseId: number): Promise<Record<string, unknown>> {
    this.requireSigner();
    const out = await this.near.call(this.cfg.court, "submit", { case_id: caseId }, 0n, ASK_GAS);
    return { case_id: caseId, tx: out.txHash, oracle_request: out.value };
  }

  async appeal(caseId: number): Promise<Record<string, unknown>> {
    this.requireSigner();
    const c = await this.getRaw(caseId);
    const bond = BigInt(c.appeal_bond);
    if (c.stage !== "decided" || bond === 0n) throw new Error(`case ${caseId} is ${c.stage}; only a decided case can be appealed`);
    const out = await this.near.call(this.cfg.court, "appeal", { case_id: caseId }, bond, PARTY_GAS);
    return { case_id: caseId, tx: out.txHash, bond_near: formatNear(bond) };
  }

  async finalize(caseId: number): Promise<Record<string, unknown>> {
    this.requireSigner();
    const out = await this.near.call(this.cfg.court, "finalize", { case_id: caseId }, 0n, PARTY_GAS);
    return { case_id: caseId, tx: out.txHash, settled: out.logs.find((l) => l.includes('"settled"')) ?? null };
  }

  async refund(caseId: number): Promise<Record<string, unknown>> {
    this.requireSigner();
    const out = await this.near.call(this.cfg.court, "refund", { case_id: caseId }, 0n, PARTY_GAS);
    return { case_id: caseId, tx: out.txHash };
  }

  private async getRaw(caseId: number): Promise<Case> {
    const c = await this.near.view<Case | null>(this.cfg.court, "get_case", { case_id: caseId });
    if (!c) throw new Error(`case ${caseId} does not exist`);
    return c;
  }

  async getCase(caseId: number): Promise<Record<string, unknown>> {
    const c = await this.getRaw(caseId);
    const question = await this.near.view<string>(this.cfg.court, "question_for", { case_id: caseId });
    let votes: unknown = null;
    if (c.request_id !== null) {
      const r = await this.near.view<{ votes?: unknown } | null>(this.cfg.oracle, "near_request", { request_id: c.request_id });
      votes = r?.votes ?? null;
    }
    return { ...describeCase(caseId, c), oracle_question: question, votes };
  }

  async allCases(): Promise<{ id: number; c: Case }[]> {
    const out: { id: number; c: Case }[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.near.view<(Case & { case_id: number })[]>(this.cfg.court, "cases", { from_id: page * PAGE + 1, limit: PAGE });
      for (const c of batch) out.push({ id: c.case_id, c });
      if (batch.length < PAGE) break;
    }
    return out;
  }

  async listCases(account: string | null, openOnly: boolean): Promise<Record<string, unknown>[]> {
    const all = await this.allCases();
    return all
      .filter(({ c }) => account === null || c.claimant === account || c.counterparty === account)
      .filter(({ c }) => !openOnly || !["settled", "refunded"].includes(c.stage))
      .reverse()
      .map(({ id, c }) => ({ case_id: id, stage: c.stage, claimant: c.claimant, counterparty: c.counterparty, verdict: c.verdict, winner: c.winner, respond_by: iso(c.respond_by_ns), appeal_by: iso(c.appeal_by_ns) }));
  }

  async reputation(account: string): Promise<Record<string, unknown>> {
    return reputationOf(account, (await this.allCases()).map((x) => x.c));
  }

  /**
   * Re-runs the 2-of-3 check on the NEAR oracle contract with the signed model answers the
   * Psephex API kept, so an agent can trust a verdict without trusting the API or the relayer.
   */
  async verifyVerdict(requestId: number): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.cfg.apiUrl}/requests/near/${requestId}/verify`);
    if (!res.ok) throw new Error(`the Psephex API has no verification data for NEAR request ${requestId} (${res.status})`);
    const body = (await res.json()) as { data?: { near?: { args?: object } } };
    const args = body.data?.near?.args;
    if (!args) throw new Error(`no verify_consensus arguments for NEAR request ${requestId}`);
    const onChain = await this.near.view<{ answer?: string | null } | null>(this.cfg.oracle, "near_request", { request_id: requestId });
    const check = await this.near.view<{ ok: boolean; answer: string; reason: string; required: number; votes: unknown }>(this.cfg.oracle, "verify_consensus", args);
    return { request_id: requestId, signatures_ok: check.ok, recomputed_answer: check.answer, stored_answer: onChain?.answer ?? null, matches: check.ok && check.answer === onChain?.answer, required: check.required, votes: check.votes, reason: check.reason || null };
  }
}

export function reputationOf(account: string, cases: readonly Case[]): Record<string, unknown> {
  const mine = cases.filter((c) => c.claimant === account || c.counterparty === account);
  const settled = mine.filter((c) => c.stage === "settled");
  const won = settled.filter((c) => c.winner === account).length;
  const lost = settled.length - won;
  const asSeller = mine.filter((c) => c.counterparty === account);
  const silent = asSeller.filter((c) => c.response === null && c.stage !== "awaiting_response").length;
  return {
    account,
    cases: mine.length,
    open: mine.filter((c) => !["settled", "refunded"].includes(c.stage)).length,
    won,
    lost,
    refunded: mine.filter((c) => c.stage === "refunded").length,
    appeals_filed: mine.filter((c) => c.appellant === account).length,
    named_as_counterparty: asSeller.length,
    did_not_respond: silent,
    win_rate: settled.length === 0 ? null : Math.round((won / settled.length) * 100) / 100,
  };
}
