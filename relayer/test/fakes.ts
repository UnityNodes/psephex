import { encodeFunctionData, keccak256, serializeTransaction, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { aiOracleAbi } from "../src/abi.js";
import { ModelProviderError, type ModelErrorKind } from "../src/nearai.js";
import type {
  AskedEvent,
  BaseChainPort,
  BaseReceipt,
  ConsensusAnswer,
  ConsensusResult,
  FeeQuote,
  FulfillArgs,
  ModelInfo,
  ModelProviderPort,
  ModelReply,
  ModelSignature,
  NearFulfillArgs,
  NearOraclePort,
  NearRequestInfo,
  NearRequestsPort,
  NearTxOutcome,
  OnSignedResult,
  SignedNearTx,
} from "../src/types.js";

export const ORACLE_KEY: Hex = generatePrivateKey();
export const ORACLE_ADDRESS = privateKeyToAccount(ORACLE_KEY).address;
export const AIORACLE: Address = "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111";
export const DISPUTE: Address = "0xCa744C595A6C2EE470257D2B873aEd2b1a78E092";
export const CHAIN_ID = 84532;
export const ARBITRUM_CHAIN_ID = 421614;
export const NEAR_CHAIN = "near:testnet";
export const ASKER = "alice.testnet";

export function nearRequest(id: number, question = `NEAR question ${id}?`, overrides: Partial<NearRequestInfo> = {}): NearRequestInfo {
  return {
    chain: NEAR_CHAIN,
    requestId: id,
    asker: ASKER,
    question,
    questionHash: keccak256(new TextEncoder().encode(question)),
    paidYocto: "10000000000000000000000",
    answer: null,
    votes: [],
    ...overrides,
  };
}

const ANSWER_CODES: Readonly<Record<string, number>> = { UNKNOWN: 0, YES: 1, NO: 2 };

export function askedEvent(id: bigint, question = `Question ${id}?`, block = 100n + id): AskedEvent {
  return {
    id,
    requester: DISPUTE,
    question,
    questionHash: keccak256(new TextEncoder().encode(question)),
    paidWei: 100_000_000_000_000n,
    blockNumber: block,
    txHash: toHex(id, { size: 32 }),
    logIndex: 0,
  };
}

async function mpcSign(unsigned: Hex, key: Hex): Promise<OnSignedResult> {
  const payload = keccak256(unsigned);
  const sig = await sign({ hash: payload, privateKey: key });
  const parity = sig.yParity ?? 0;
  return {
    ok: true,
    unsigned_tx: unsigned.slice(2),
    payload: payload.slice(2),
    signature: { big_r: { affine_point: `${parity ? "03" : "02"}${sig.r.slice(2)}` }, s: { scalar: sig.s.slice(2) }, recovery_id: parity },
  };
}

export type SendBehavior = "ok" | "mpc_fail" | "panic" | "panic_cap" | "panic_progress" | "network_error" | "pending" | "invalid" | "callback_fail" | "rival";

export class FakeNear implements NearOraclePort, NearRequestsPort {
  chainId = CHAIN_ID;
  signedChain: string | undefined;
  requests = new Map<number, NearRequestInfo>();
  nearSignCalls: NearFulfillArgs[] = [];
  pageCalls: [number, number][] = [];
  readonly #nearArgs = new Map<string, NearFulfillArgs>();
  modelList: ModelInfo[] = [
    { model: "m-a", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa" },
    { model: "m-b", provider: "near-ai", scheme: "nearai-v1", publicKey: "bb" },
    { model: "m-c", provider: "near-ai", scheme: "nearai-v1", publicKey: "cc" },
  ];
  consensus: ConsensusResult = { ok: true, answer: "YES", reason: "", required: 2, votes: [{ model: "m-a", answer: "YES" }] };
  fulfilled = new Set<number>();
  cap = 2_000_000_000n;
  signingKey: Hex = ORACLE_KEY;
  sendPlan: SendBehavior[] = [];
  signCalls: FulfillArgs[] = [];
  sendCalls: string[] = [];
  verifyCalls: ConsensusAnswer[][] = [];
  onSend: ((hash: string) => void) | undefined;
  readonly #outcomes = new Map<string, NearTxOutcome>();
  readonly #args = new Map<string, FulfillArgs>();
  panicMessage = "Smart contract panicked: request already fulfilled";
  signedAnswer: string | undefined;

  async models(): Promise<ModelInfo[]> {
    return this.modelList;
  }

  async buildRequest(requestId: number, question: string, model: string): Promise<string> {
    return JSON.stringify({ model, request_id: requestId, question });
  }

  async verifyConsensus(_id: number, _q: string, answers: readonly ConsensusAnswer[]): Promise<ConsensusResult> {
    this.verifyCalls.push([...answers]);
    return this.consensus;
  }

  async isFulfilled(requestId: number): Promise<boolean> {
    return this.fulfilled.has(requestId);
  }

  async maxFeePerGasCap(): Promise<bigint> {
    return this.cap;
  }

  async signFulfill(args: FulfillArgs): Promise<SignedNearTx> {
    this.signCalls.push(args);
    const txHash = `NEARTX${this.signCalls.length}`;
    this.#args.set(txHash, args);
    return { txHash, signedTxBase64: Buffer.from(txHash).toString("base64") };
  }

  async signFulfillNear(args: NearFulfillArgs): Promise<SignedNearTx> {
    this.nearSignCalls.push(args);
    const txHash = `NEARFULFILL${this.nearSignCalls.length}`;
    this.#nearArgs.set(txHash, args);
    return { txHash, signedTxBase64: Buffer.from(txHash).toString("base64") };
  }

  async nearRequest(requestId: number): Promise<NearRequestInfo | null> {
    return this.requests.get(requestId) ?? null;
  }

  async nearRequests(fromId: number, limit: number): Promise<NearRequestInfo[]> {
    this.pageCalls.push([fromId, limit]);
    return [...this.requests.values()].filter((r) => r.requestId >= fromId && r.requestId < fromId + limit).sort((a, b) => a.requestId - b.requestId);
  }

  async lastNearRequestId(): Promise<number> {
    return Math.max(0, ...this.requests.keys());
  }

  #answerOnNear(id: number, answer: string): void {
    const r = this.requests.get(id);
    if (r) this.requests.set(id, { ...r, answer, votes: this.consensus.votes });
    this.fulfilled.add(id);
  }

  #settleNear(hash: string, args: NearFulfillArgs): NearTxOutcome {
    const behavior = this.sendPlan.shift() ?? "ok";
    if (behavior === "network_error") throw new Error("fetch failed");
    if (behavior === "pending") return { kind: "unknown" };
    if (behavior === "invalid") return { kind: "invalid", error: "InvalidTxError: Expired" };
    if (behavior === "rival") {
      this.#answerOnNear(args.request_id, this.signedAnswer ?? this.consensus.answer);
      return this.#store(hash, { kind: "failure", error: this.panicMessage });
    }
    if (behavior === "panic") return this.#store(hash, { kind: "failure", error: this.panicMessage });
    const answer = this.signedAnswer ?? this.consensus.answer;
    this.#answerOnNear(args.request_id, answer);
    if (behavior === "callback_fail") return this.#store(hash, { kind: "success", result: { ok: true, delivered: false } });
    return this.#store(hash, { kind: "success", result: { ok: true, chain: NEAR_CHAIN, request_id: args.request_id, answer } });
  }

  async #settle(hash: string): Promise<NearTxOutcome> {
    const nearArgs = this.#nearArgs.get(hash);
    if (nearArgs) return this.#settleNear(hash, nearArgs);
    const behavior = this.sendPlan.shift() ?? "ok";
    const args = this.#args.get(hash);
    if (!args) throw new Error(`unknown near tx ${hash}`);
    if (behavior === "network_error") throw new Error("fetch failed");
    if (behavior === "pending") return { kind: "unknown" };
    if (behavior === "panic") return this.#store(hash, { kind: "failure", error: this.panicMessage });
    if (behavior === "panic_cap") return this.#store(hash, { kind: "failure", error: "Smart contract panicked: max_fee_per_gas above cap" });
    if (behavior === "panic_progress") return this.#store(hash, { kind: "failure", error: "Smart contract panicked: request signing in progress" });
    if (behavior === "invalid") return { kind: "invalid", error: "InvalidTxError: Expired" };
    if (behavior === "mpc_fail") return this.#store(hash, { kind: "success", result: { ok: false, error: "sign failed" } });
    const unsigned = serializeTransaction({
      type: "eip1559",
      chainId: this.chainId,
      nonce: args.nonce,
      maxFeePerGas: BigInt(args.max_fee_per_gas),
      maxPriorityFeePerGas: BigInt(args.max_priority_fee_per_gas),
      gas: 300_000n,
      to: AIORACLE,
      value: 0n,
      data: encodeFunctionData({
        abi: aiOracleAbi,
        functionName: "fulfill",
        args: [BigInt(args.request_id), ANSWER_CODES[this.signedAnswer ?? this.consensus.answer] ?? 0, keccak256(new TextEncoder().encode(args.question))],
      }),
    });
    this.fulfilled.add(args.request_id);
    const chain = this.signedChain === undefined ? {} : { chain: this.signedChain };
    return this.#store(hash, { kind: "success", result: { ...(await mpcSign(unsigned, this.signingKey)), ...chain, request_id: args.request_id } });
  }

  #store(hash: string, outcome: NearTxOutcome): NearTxOutcome {
    this.#outcomes.set(hash, outcome);
    return outcome;
  }

  async sendSigned(signed: SignedNearTx): Promise<NearTxOutcome> {
    this.sendCalls.push(signed.txHash);
    this.onSend?.(signed.txHash);
    return this.#outcomes.get(signed.txHash) ?? this.#settle(signed.txHash);
  }

  async txOutcome(txHash: string): Promise<NearTxOutcome> {
    return this.#outcomes.get(txHash) ?? { kind: "unknown" };
  }
}

export type ModelBehavior = "ok" | "fail" | ModelErrorKind;

export class FakeModels implements ModelProviderPort {
  plan = new Map<string, ModelBehavior[]>();
  signaturePlan = new Map<string, ModelBehavior[]>();
  answer = "YES";
  calls: string[] = [];
  signatureCalls: string[] = [];

  async complete(requestBody: string): Promise<ModelReply> {
    const model = String((JSON.parse(requestBody) as { model: string }).model);
    this.calls.push(model);
    const behavior = this.plan.get(model)?.shift() ?? "ok";
    if (behavior === "fail") throw new Error(`model ${model} timed out`);
    if (behavior !== "ok") throw new ModelProviderError(`model ${model} ${behavior}`, behavior);
    return { chatId: `chat-${model}`, responseBody: `{"id":"x","choices":[{"message":{"content":"${this.answer}"}}]}`, latencyMs: 10 };
  }

  async signature(chatId: string): Promise<ModelSignature> {
    const model = chatId.replace(/^chat-/, "");
    this.signatureCalls.push(model);
    const behavior = this.signaturePlan.get(model)?.shift() ?? "ok";
    if (behavior !== "ok" && behavior !== "fail") throw new ModelProviderError(`signature ${behavior}`, behavior);
    if (behavior === "fail") throw new Error("signature fetch failed");
    return { text: `${chatId}:req:resp`, signatureHex: "ab".repeat(64), signingAddress: "cd".repeat(32) };
  }
}

export class FakeBase implements BaseChainPort {
  head = 1_000n;
  events: AskedEvent[] = [];
  nonce = 0;
  quote: FeeQuote = { baseFeePerGas: 6_000_000n, maxPriorityFeePerGas: 1_000_000n };
  sent: Hex[] = [];
  receipts = new Map<Hex, BaseReceipt>();
  fulfilledOnBase = new Set<bigint>();
  autoMine = true;
  revert = false;
  sendError: string | undefined;
  origins = new Map<Hex, Address>();
  logCalls: [bigint, bigint][] = [];

  headStep = 0n;

  async headBlock(): Promise<bigint> {
    const current = this.head;
    this.head += this.headStep;
    return current;
  }

  async askedEvents(fromBlock: bigint, toBlock: bigint): Promise<AskedEvent[]> {
    this.logCalls.push([fromBlock, toBlock]);
    return this.events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }

  async txSender(txHash: Hex): Promise<Address> {
    return this.origins.get(txHash) ?? "0x00000000000000000000000000000000000000a1";
  }

  async isFulfilledOnBase(requestId: bigint): Promise<boolean> {
    return this.fulfilledOnBase.has(requestId);
  }

  staleNonce: number | undefined;

  async pendingNonce(): Promise<number> {
    return this.staleNonce ?? this.nonce;
  }

  async feeQuote(): Promise<FeeQuote> {
    return this.quote;
  }

  async sendRawTransaction(signedTx: Hex): Promise<Hex> {
    this.sent.push(signedTx);
    if (this.sendError) throw new Error(this.sendError);
    const hash = keccak256(signedTx);
    if (this.autoMine) this.mine(hash);
    return hash;
  }

  mine(hash: Hex): void {
    this.nonce += 1;
    this.receipts.set(hash, {
      status: this.revert ? "reverted" : "success",
      blockNumber: this.head - 5n,
      gasUsed: 61_000n,
      eventsJson: this.revert ? "[]" : JSON.stringify([{ event: "Fulfilled", answer: 1 }]),
    });
  }

  async receipt(txHash: Hex): Promise<BaseReceipt | null> {
    return this.receipts.get(txHash) ?? null;
  }
}

export class ManualClock {
  t = Date.UTC(2026, 10, 8, 12, 0, 0);
  now(): number {
    return this.t;
  }
}

export const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
