import type { Address, Hex } from "viem";
import type { Repository } from "./db.js";
import { assembleSignedFulfill, SignatureError } from "./evm-signature.js";
import { computeFees, FeeCapExceeded, type Fees } from "./fees.js";
import { ModelProviderError, type ModelErrorKind } from "./nearai.js";
import {
  TERMINAL_STATUSES,
  type BaseChainPort,
  type Clock,
  type ConsensusAnswer,
  type ModelAnswerRow,
  type ModelInfo,
  type ModelProviderPort,
  type NearOraclePort,
  type OnSignedResult,
  type RequestRow,
  type RequestStatus,
} from "./types.js";

const HOUR_MS = 3_600_000;
const MAX_STEPS = 64;
const ALREADY_BROADCAST = /already known|known transaction/i;
const NONCE_TOO_LOW = /nonce too low/i;
const RESIGN_PANICS = /max_fee_per_gas above cap|max_priority_fee_per_gas above max_fee_per_gas/;
const SIGNING_IN_PROGRESS = /request signing in progress/;
const ANSWER_CODES: Readonly<Record<string, number>> = { UNKNOWN: 0, YES: 1, NO: 2 };

export interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ProcessorSettings {
  readonly aiOracleAddress: Address;
  readonly oracleEvmAddress: Address;
  readonly baseChainId: number;
  readonly maxFeePerGas: bigint;
  readonly dailyModelBudget: number;
  readonly perAddressHourlyLimit: number;
  readonly modelRetries: number;
  readonly mpcRetries: number;
  readonly receiptAlertMs: number;
  readonly confirmations: number;
  readonly maxQuestionBytes: number;
  readonly stuckMs: number;
  readonly maxQueue: number;
  readonly evmGasLimit: bigint;
  readonly feeBaseMultiplier: number;
}

export interface ProcessorDeps {
  readonly repo: Repository;
  readonly near: NearOraclePort;
  readonly models: ModelProviderPort;
  readonly base: BaseChainPort;
  readonly clock: Clock;
  readonly log: Log;
  readonly settings: ProcessorSettings;
}

export interface StepResult {
  readonly status: RequestStatus;
  readonly waiting: boolean;
}

export interface DrainSummary {
  readonly processed: number[];
  readonly blockedOn: number | null;
}

type Handler = (req: RequestRow) => Promise<StepResult>;

class ConcurrentUpdate extends Error {
  override readonly name = "ConcurrentUpdate";
}

function isTerminal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function modelErrorKind(err: unknown): ModelErrorKind {
  return err instanceof ModelProviderError ? err.kind : "transient";
}

export class Processor {
  readonly #d: ProcessorDeps;
  readonly #handlers: Readonly<Record<RequestStatus, Handler>>;

  constructor(deps: ProcessorDeps) {
    this.#d = deps;
    const done: Handler = async (req) => ({ status: req.status, waiting: false });
    this.#handlers = {
      seen: (r) => this.#seen(r),
      answering: (r) => this.#answering(r),
      verified: (r) => this.#verified(r),
      near_sent: (r) => this.#nearSent(r),
      near_signed: (r) => this.#nearSigned(r),
      base_sent: (r) => this.#baseSent(r),
      confirmed: done,
      rejected: done,
      failed: done,
    };
  }

  async drain(): Promise<DrainSummary> {
    const processed: number[] = [];
    for (const req of this.#d.repo.listActive()) {
      processed.push(req.id);
      const result = await this.run(req.id);
      if (result.waiting) return { processed, blockedOn: req.id };
    }
    return { processed, blockedOn: null };
  }

  async run(id: number): Promise<StepResult> {
    let result: StepResult = { status: "seen", waiting: true };
    for (let step = 0; step < MAX_STEPS; step++) {
      result = await this.advance(id);
      if (result.waiting || isTerminal(result.status)) return result;
    }
    return { status: result.status, waiting: true };
  }

  async advance(id: number): Promise<StepResult> {
    const req = this.#d.repo.getRequest(id);
    if (!req) throw new Error(`unknown request ${id}`);
    try {
      return await this.#handlers[req.status](req);
    } catch (err) {
      this.#d.log.warn({ requestId: id, status: req.status, err: errorMessage(err) }, "step failed, will retry");
      return { status: req.status, waiting: true };
    }
  }

  #transition(req: RequestRow, status: RequestStatus, patch: { reason?: string; retries?: number } = {}): void {
    if (!this.#d.repo.updateRequest(req.id, { status, ...patch }, req.status)) {
      throw new ConcurrentUpdate(`request ${req.id} left ${req.status} while this step ran`);
    }
  }

  #move(req: RequestRow, status: RequestStatus): StepResult {
    this.#transition(req, status);
    this.#d.log.info({ requestId: req.id, status }, "request advanced");
    return { status, waiting: false };
  }

  #end(req: RequestRow, status: "rejected" | "failed", reason: string): StepResult {
    this.#transition(req, status, { reason });
    const level = status === "failed" ? "error" : "warn";
    this.#d.log[level]({ requestId: req.id, status, reason, alert: status === "failed" }, `request ${status}`);
    return { status, waiting: false };
  }

  #wait(req: RequestRow, why: string, extra: object = {}): StepResult {
    this.#d.log.warn({ requestId: req.id, status: req.status, ...extra }, why);
    return { status: req.status, waiting: true };
  }

  #waitOrStuck(req: RequestRow, why: string, extra: object = {}): StepResult {
    const age = this.#d.clock.now() - req.updatedAt;
    if (age > this.#d.settings.stuckMs) return this.#end(req, "failed", `stuck in ${req.status} for ${Math.round(age / 60_000)} min: ${why}`);
    return this.#wait(req, why, extra);
  }

  async #seen(req: RequestRow): Promise<StepResult> {
    const { repo, base, near, clock, settings } = this.#d;
    if (repo.countActiveBefore(req.id) >= settings.maxQueue) return this.#end(req, "rejected", `queue full: ${settings.maxQueue} active requests`);
    const origin = req.origin ?? (await base.txSender(req.askedTx as Hex));
    if (!req.origin) repo.updateRequest(req.id, { origin });
    const bytes = Buffer.byteLength(req.question, "utf8");
    if (bytes > settings.maxQuestionBytes) return this.#end(req, "rejected", `question too long: ${bytes} bytes, max ${settings.maxQuestionBytes}`);
    if (await base.isFulfilledOnBase(BigInt(req.id))) return this.#end(req, "rejected", "already fulfilled on Base");
    if (await near.isFulfilled(req.id)) return this.#end(req, "failed", "fulfilled in NEAR without a local record");
    const recent = repo.countOriginBefore(origin, req.id, clock.now() - HOUR_MS);
    if (recent >= settings.perAddressHourlyLimit) return this.#end(req, "rejected", `rate limit: ${recent} requests from ${origin} in the last hour`);
    return this.#move(req, "answering");
  }

  #today(): string {
    return new Date(this.#d.clock.now()).toISOString().slice(0, 10);
  }

  async #answering(req: RequestRow): Promise<StepResult> {
    const { repo, near, settings } = this.#d;
    const list = await near.models();
    if (list.length === 0) return this.#wait(req, "no models registered in NEAR", { alert: true });
    const stored = repo.getModelAnswers(req.id);
    const next = list.find((m) => !stored.some((a) => a.model === m.model && a.signatureHex));
    if (!next) return this.#verify(req, list, stored);
    const previous = stored.find((a) => a.model === next.model);
    if (previous?.chatId && previous.responseBody) return this.#fetchSignature(req, next, previous.chatId);
    if (previous && previous.attempts >= settings.modelRetries) {
      return this.#end(req, "failed", `model ${next.model} did not answer after ${previous.attempts} attempts`);
    }
    const day = this.#today();
    if (repo.modelCallsOn(day) >= settings.dailyModelBudget) return this.#wait(req, "daily model budget spent", { day, alert: true });
    const body = previous?.requestBody ?? (await near.buildRequest(req.id, req.question, next.model));
    return this.#askModel(req, next, body, day);
  }

  async #askModel(req: RequestRow, model: ModelInfo, body: string, day: string): Promise<StepResult> {
    const { repo, models, settings } = this.#d;
    const attempt = repo.beginModelAttempt(req.id, model.model, model.provider, body);
    repo.addModelCalls(day, 1);
    let chatId: string;
    try {
      const reply = await models.complete(body);
      repo.saveModelCompletion(req.id, model.model, reply);
      chatId = reply.chatId;
    } catch (err) {
      const kind = modelErrorKind(err);
      const extra = { model: model.model, attempt, kind, err: errorMessage(err) };
      if (kind === "auth") {
        repo.releaseModelAttempt(req.id, model.model);
        return this.#wait(req, "model provider refused our credentials", { ...extra, alert: true });
      }
      if (kind === "permanent") return this.#end(req, "failed", `model ${model.model} rejected the request: ${errorMessage(err)}`);
      if (attempt >= settings.modelRetries) return this.#end(req, "failed", `model ${model.model} did not answer after ${attempt} attempts`);
      return this.#waitOrStuck(req, "model call failed, will retry the same body", extra);
    }
    return this.#fetchSignature(req, model, chatId);
  }

  async #fetchSignature(req: RequestRow, model: ModelInfo, chatId: string): Promise<StepResult> {
    try {
      const signature = await this.#d.models.signature(chatId);
      this.#d.repo.saveModelSignature(req.id, model.model, signature);
    } catch (err) {
      const kind = modelErrorKind(err);
      const extra = { model: model.model, chatId, kind, err: errorMessage(err) };
      if (kind === "permanent") return this.#end(req, "failed", `model ${model.model} signature unusable: ${errorMessage(err)}`);
      if (kind === "auth") return this.#wait(req, "model provider refused our credentials", { ...extra, alert: true });
      return this.#waitOrStuck(req, "model signature not available yet", extra);
    }
    return { status: "answering", waiting: false };
  }

  #answers(list: readonly ModelInfo[], stored: readonly ModelAnswerRow[]): ConsensusAnswer[] {
    return list.map((m) => {
      const a = stored.find((s) => s.model === m.model);
      return { model: m.model, response_body: a?.responseBody ?? "", signature_hex: a?.signatureHex ?? "" };
    });
  }

  async #verify(req: RequestRow, list: readonly ModelInfo[], stored: readonly ModelAnswerRow[]): Promise<StepResult> {
    const result = await this.#d.near.verifyConsensus(req.id, req.question, this.#answers(list, stored));
    if (!result.ok) return this.#end(req, "rejected", `consensus: ${result.reason}`);
    this.#d.repo.updateRequest(req.id, { answer: result.answer, votesJson: JSON.stringify(result.votes) });
    return this.#move(req, "verified");
  }

  async #fees(): Promise<Fees> {
    const { base, near, settings } = this.#d;
    const [quote, contractCap] = await Promise.all([base.feeQuote(), near.maxFeePerGasCap()]);
    return computeFees(quote, { configCap: settings.maxFeePerGas, contractCap }, settings.feeBaseMultiplier);
  }

  async #nonce(): Promise<number> {
    const { repo, base, settings, log } = this.#d;
    const pending = await base.pendingNonce(settings.oracleEvmAddress);
    const confirmed = repo.maxConfirmedNonce();
    const floor = confirmed === null ? 0 : confirmed + 1;
    if (pending < floor) log.warn({ pending, floor }, "Base RPC nonce is behind confirmed transactions, using the floor");
    return pending > floor ? pending : floor;
  }

  async #verified(req: RequestRow): Promise<StepResult> {
    const { repo, near } = this.#d;
    if (await near.isFulfilled(req.id)) return this.#end(req, "failed", "fulfilled in NEAR without a local record");
    let fees: Fees;
    try {
      fees = await this.#fees();
    } catch (err) {
      if (err instanceof FeeCapExceeded) return this.#wait(req, "gas price above cap", { err: err.message, alert: true });
      throw err;
    }
    const nonce = await this.#nonce();
    const answers = this.#answers(await near.models(), repo.getModelAnswers(req.id));
    const maxFee = fees.maxFeePerGas.toString();
    const maxPriorityFee = fees.maxPriorityFeePerGas.toString();
    const signed = await near.signFulfill({ request_id: req.id, question: req.question, answers, nonce, max_fee_per_gas: maxFee, max_priority_fee_per_gas: maxPriorityFee });
    repo.saveNearTx({ requestId: req.id, txHash: signed.txHash, nonce, maxFee, maxPriorityFee, signedTxBase64: signed.signedTxBase64 });
    return this.#move(req, "near_sent");
  }

  #resign(req: RequestRow, why: string): StepResult {
    const retries = req.retries + 1;
    if (retries >= this.#d.settings.mpcRetries) return this.#end(req, "failed", `${why}; gave up after ${retries} signing attempts`);
    this.#transition(req, "verified", { retries });
    this.#d.log.warn({ requestId: req.id, retries, why }, "signing again with fresh nonce and fees");
    return { status: "verified", waiting: false };
  }

  async #nearSent(req: RequestRow): Promise<StepResult> {
    const { repo, near } = this.#d;
    const tx = repo.latestNearTx(req.id);
    if (!tx) return this.#end(req, "failed", "near_sent without a stored NEAR transaction");
    let outcome = await near.txOutcome(tx.txHash);
    if (outcome.kind === "unknown") outcome = await near.sendSigned({ txHash: tx.txHash, signedTxBase64: tx.signedTxBase64 });
    if (outcome.kind === "invalid") {
      const recheck = await near.txOutcome(tx.txHash);
      if (recheck.kind === "unknown" || recheck.kind === "invalid") return this.#resign(req, `NEAR rejected the stored transaction: ${outcome.error}`);
      outcome = recheck;
    }
    if (outcome.kind === "unknown") return this.#waitOrStuck(req, "NEAR transaction not final yet", { txHash: tx.txHash });
    if (outcome.kind === "failure") return this.#onNearFailure(req, tx.txHash, outcome.error);
    if (outcome.kind === "success") return this.#onSigned(req, tx.txHash, outcome.result);
    return this.#wait(req, "unexpected NEAR outcome", { txHash: tx.txHash });
  }

  #onNearFailure(req: RequestRow, txHash: string, error: string): StepResult {
    if (RESIGN_PANICS.test(error)) {
      this.#d.repo.markNearResult(txHash, false, null, JSON.stringify({ ok: false, error }));
      return this.#resign(req, error);
    }
    if (SIGNING_IN_PROGRESS.test(error)) return this.#waitOrStuck(req, "NEAR reports signing in progress", { txHash, alert: true });
    return this.#end(req, "failed", `NEAR transaction failed: ${error}`);
  }

  #onSigned(req: RequestRow, txHash: string, result: OnSignedResult): StepResult {
    if (!result.ok) {
      this.#d.repo.markNearResult(txHash, false, null, JSON.stringify(result));
      return this.#resign(req, `MPC signing failed: ${result.error ?? "ok=false"}`);
    }
    this.#d.repo.markNearResult(txHash, true, result.unsigned_tx ?? null, JSON.stringify(result));
    return this.#move(req, "near_signed");
  }

  async #nearSigned(req: RequestRow): Promise<StepResult> {
    const { repo, settings } = this.#d;
    const tx = repo.latestNearTx(req.id);
    if (!tx?.signatureJson) return this.#end(req, "failed", "near_signed without a stored signature");
    try {
      const answerCode = req.answer === null ? undefined : ANSWER_CODES[req.answer];
      const signed = await assembleSignedFulfill(JSON.parse(tx.signatureJson) as OnSignedResult, {
        requestId: BigInt(req.id),
        aiOracle: settings.aiOracleAddress,
        oracleAddress: settings.oracleEvmAddress,
        chainId: settings.baseChainId,
        nonce: tx.nonce,
        maxFeePerGas: BigInt(tx.maxFee),
        maxGas: settings.evmGasLimit,
        questionHash: req.questionHash as Hex,
        ...(answerCode === undefined ? {} : { answerCode }),
      });
      repo.saveBaseTx({ requestId: req.id, txHash: signed.txHash, signedTx: signed.signedTx });
    } catch (err) {
      if (err instanceof SignatureError) return this.#end(req, "failed", err.message);
      throw err;
    }
    return this.#move(req, "base_sent");
  }

  async #broadcast(req: RequestRow, signedTx: Hex): Promise<void> {
    try {
      await this.#d.base.sendRawTransaction(signedTx);
    } catch (err) {
      const message = errorMessage(err);
      if (ALREADY_BROADCAST.test(message)) {
        this.#d.log.info({ requestId: req.id }, "Base transaction already broadcast");
        return;
      }
      if (NONCE_TOO_LOW.test(message)) {
        this.#d.log.error({ requestId: req.id, alert: true }, "Base reports nonce too low for our signed tx; another tx used this nonce or ours is mined");
        return;
      }
      throw err;
    }
  }

  async #baseSent(req: RequestRow): Promise<StepResult> {
    const { repo, base, clock, settings } = this.#d;
    const tx = repo.latestBaseTx(req.id);
    if (!tx) return this.#end(req, "failed", "base_sent without a stored Base transaction");
    const hash = tx.txHash as Hex;
    let receipt = await base.receipt(hash);
    if (!receipt) {
      await this.#broadcast(req, tx.signedTx as Hex);
      receipt = await base.receipt(hash);
    }
    if (!receipt) {
      const late = clock.now() - tx.sentAt > settings.receiptAlertMs;
      return this.#waitOrStuck(req, late ? "no Base receipt in time" : "waiting for Base receipt", { txHash: hash, alert: late });
    }
    const head = await base.headBlock();
    if (head - receipt.blockNumber + 1n < BigInt(settings.confirmations)) return this.#wait(req, "waiting for confirmations", { txHash: hash });
    repo.markBaseReceipt(hash, receipt.status, receipt.gasUsed, receipt.eventsJson);
    if (receipt.status === "reverted") return this.#end(req, "failed", `Base transaction ${hash} reverted`);
    return this.#move(req, "confirmed");
  }
}
