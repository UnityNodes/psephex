import {
  Account,
  actions,
  base64Decode,
  base64Encode,
  baseEncode,
  KeyPairSigner,
  SignedTransaction,
  teraToGas,
  type JsonRpcProvider,
  type KeyPairString,
} from "near-api-js";
import type {
  ConsensusAnswer,
  ConsensusResult,
  FulfillArgs,
  ModelInfo,
  NearFulfillArgs,
  NearOraclePort,
  NearRequestInfo,
  NearRequestsPort,
  NearTxOutcome,
  OnSignedResult,
  SignedNearTx,
  Vote,
} from "./types.js";

const FINAL_STATUSES = new Set(["FINAL", "EXECUTED"]);
const UNKNOWN_TX = /unknown transaction|UNKNOWN_TRANSACTION/i;
const RETRY_LATER = /timed out|timeout|\b408\b|\b504\b/i;
const NEVER_EXECUTED = /InvalidNonce|Expired/i;
const DECIMAL = /^\d+$/;

export const FULFILL_EVM_METHOD = "fulfill_on_evm";
export const FULFILL_NEAR_METHOD = "fulfill_on_near";

export interface NearRpc {
  callFunction<T>(args: { contractId: string; method: string; args: object }): Promise<T | undefined>;
  viewTransactionStatus(args: { txHash: string; accountId: string; waitUntil: "NONE" }): Promise<unknown>;
  sendTransactionUntil(signed: SignedTransaction, waitUntil: "FINAL"): Promise<unknown>;
  viewAccessKey(args: { accountId: string; publicKey: string }): Promise<unknown>;
}

export interface FulfillSigner {
  sign(method: string, args: object): Promise<SignedNearTx>;
  publicKey(): Promise<string>;
}

export interface NearOracleOptions {
  readonly rpc: NearRpc;
  readonly contractId: string;
  readonly relayerId: string;
  readonly chain: string;
  readonly signer: FulfillSigner | null;
  readonly timeoutMs: number;
  readonly decode?: (bytes: Uint8Array) => unknown;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

function failureMessage(failure: unknown): string {
  const kind = field(field(failure, "ActionError"), "kind");
  const exec = field(field(kind, "FunctionCallError"), "ExecutionError");
  return typeof exec === "string" ? exec : JSON.stringify(failure);
}

export type ResultParser = (value: unknown) => NearTxOutcome;

export const parseOnSigned: ResultParser = (value) => {
  if (typeof field(value, "ok") !== "boolean") return { kind: "failure", error: `unexpected ${FULFILL_EVM_METHOD} result: ${JSON.stringify(value)}` };
  return { kind: "success", result: value as OnSignedResult };
};

/**
 * fulfill_on_near returns its JSON verdict when the asker wanted no callback; with a callback the
 * final receipt is on_client_answered, a bool that only says whether on_answer worked. The verdict
 * is stored in both cases, so either shape counts as success.
 */
export const parseNearFulfill: ResultParser = (value) => {
  if (typeof value === "boolean") return { kind: "success", result: { ok: true, delivered: value } };
  if (field(value, "ok") === true) return { kind: "success", result: value as OnSignedResult };
  return { kind: "failure", error: `unexpected ${FULFILL_NEAR_METHOD} result: ${JSON.stringify(value)}` };
};

function decodeSuccess(base64: string, parse: ResultParser): NearTxOutcome {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return { kind: "failure", error: "the NEAR transaction returned a value that is not JSON" };
  }
  return parse(value);
}

export function outcomeFromResponse(resp: unknown, parse: ResultParser = parseOnSigned): NearTxOutcome {
  const finality = field(resp, "final_execution_status");
  const status = field(resp, "status");
  if (typeof finality !== "string" || !FINAL_STATUSES.has(finality)) return { kind: "unknown" };
  const failure = field(status, "Failure");
  if (failure !== undefined) return { kind: "failure", error: failureMessage(failure) };
  const success = field(status, "SuccessValue");
  if (typeof success === "string") return decodeSuccess(success, parse);
  return { kind: "unknown" };
}

export interface OracleChain {
  readonly chain: string;
  readonly chainId: number;
  readonly name: string;
  readonly oracleAddress: string;
}

export interface OracleConfig {
  readonly signer: string;
  readonly path: string;
  readonly chains: readonly OracleChain[];
  readonly nearChain: string;
  readonly nearFee: bigint;
  readonly lastNearRequestId: number;
}

function decimal(value: unknown, what: string): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) throw new Error(`${what} is not a decimal string`);
  return BigInt(value);
}

function parseChain(raw: unknown): OracleChain {
  const chain = field(raw, "chain");
  const chainId = field(raw, "chain_id");
  const name = field(raw, "name");
  const oracleAddress = field(raw, "oracle_address");
  if (typeof chain !== "string" || typeof chainId !== "number" || typeof name !== "string" || typeof oracleAddress !== "string") {
    throw new Error("config() lists a chain in an unexpected shape");
  }
  return { chain, chainId, name, oracleAddress };
}

function parseVotes(raw: unknown): Vote[] {
  if (!Array.isArray(raw)) throw new Error("near_request votes is not an array");
  return raw.map((v) => ({ model: String(field(v, "model")), answer: String(field(v, "answer")) }));
}

export function parseNearRequest(raw: unknown): NearRequestInfo {
  const chain = field(raw, "chain");
  const requestId = field(raw, "request_id");
  const asker = field(raw, "asker");
  const question = field(raw, "question");
  const questionHash = field(raw, "question_hash");
  const answer = field(raw, "answer") ?? null;
  if (typeof chain !== "string" || typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId <= 0) {
    throw new Error("near_request returned an unexpected chain or id");
  }
  if (typeof asker !== "string" || typeof question !== "string" || typeof questionHash !== "string" || (answer !== null && typeof answer !== "string")) {
    throw new Error(`near_request ${requestId} has an unexpected shape`);
  }
  return { chain, requestId, asker, question, questionHash, paidYocto: decimal(field(raw, "paid"), "near_request paid").toString(), answer, votes: parseVotes(field(raw, "votes")) };
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export class NearOracle implements NearOraclePort, NearRequestsPort {
  readonly #o: NearOracleOptions;
  readonly #parse: ResultParser;

  constructor(opts: NearOracleOptions) {
    this.#o = opts;
    this.#parse = opts.chain.startsWith("near:") ? parseNearFulfill : parseOnSigned;
  }

  get chain(): string {
    return this.#o.chain;
  }

  async #view<T>(method: string, args: object): Promise<T | undefined> {
    return withTimeout(this.#o.rpc.callFunction<T>({ contractId: this.#o.contractId, method, args }), this.#o.timeoutMs, `view ${method}`);
  }

  async models(): Promise<ModelInfo[]> {
    const raw = await this.#view<unknown>("models", {});
    if (!Array.isArray(raw)) throw new Error("models() did not return an array");
    return raw.map((m) => ({
      model: String(field(m, "model")),
      provider: String(field(m, "provider")),
      scheme: String(field(m, "scheme")),
      publicKey: String(field(m, "public_key")),
    }));
  }

  async buildRequest(requestId: number, question: string, model: string): Promise<string> {
    const body = await this.#view<unknown>("build_request", { chain: this.#o.chain, request_id: requestId, question, model });
    if (typeof body !== "string") throw new Error("build_request did not return a string");
    return body;
  }

  async verifyConsensus(requestId: number, question: string, answers: readonly ConsensusAnswer[]): Promise<ConsensusResult> {
    const result = await this.#view<ConsensusResult>("verify_consensus", { chain: this.#o.chain, request_id: requestId, question, answers });
    if (!result || typeof result.ok !== "boolean") throw new Error("verify_consensus returned an unexpected value");
    return result;
  }

  async isFulfilled(requestId: number): Promise<boolean> {
    return (await this.#view<boolean>("is_fulfilled", { chain: this.#o.chain, request_id: requestId })) === true;
  }

  async maxFeePerGasCap(): Promise<bigint> {
    const raw = await this.#view<unknown>("max_fee_per_gas_cap", {});
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error("max_fee_per_gas_cap is not a decimal string");
    return BigInt(raw);
  }

  async config(): Promise<OracleConfig> {
    const raw = await this.#view<unknown>("config", {});
    const signer = field(raw, "signer");
    const path = field(raw, "path");
    const chains = field(raw, "chains");
    const nearChain = field(raw, "near_chain");
    const last = field(raw, "last_near_request_id");
    if (typeof signer !== "string" || typeof path !== "string" || !Array.isArray(chains) || typeof nearChain !== "string" || typeof last !== "number") {
      throw new Error("config() returned an unexpected value");
    }
    return { signer, path, chains: chains.map(parseChain), nearChain, nearFee: decimal(field(raw, "near_fee"), "config() near_fee"), lastNearRequestId: last };
  }

  async nearFee(): Promise<bigint> {
    return decimal(await this.#view<unknown>("near_fee", {}), "near_fee");
  }

  async lastNearRequestId(): Promise<number> {
    const raw = await this.#view<unknown>("last_near_request_id", {});
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) throw new Error("last_near_request_id is not a count");
    return raw;
  }

  async nearRequest(requestId: number): Promise<NearRequestInfo | null> {
    const raw = await this.#view<unknown>("near_request", { request_id: requestId });
    return raw === null || raw === undefined ? null : parseNearRequest(raw);
  }

  async nearRequests(fromId: number, limit: number): Promise<NearRequestInfo[]> {
    const raw = await this.#view<unknown>("near_requests", { from_id: fromId, limit });
    if (!Array.isArray(raw)) throw new Error("near_requests did not return an array");
    return raw.map(parseNearRequest);
  }

  async derivedPublicKey(signer: string, path: string, predecessor: string): Promise<string> {
    const call = this.#o.rpc.callFunction<unknown>({ contractId: signer, method: "derived_public_key", args: { path, predecessor, domain_id: 0 } });
    const key = await withTimeout(call, this.#o.timeoutMs, "view derived_public_key");
    if (typeof key !== "string") throw new Error("derived_public_key did not return a string");
    return key;
  }

  #signer(): FulfillSigner {
    if (!this.#o.signer) throw new Error("no relayer key configured for signing");
    return this.#o.signer;
  }

  async signFulfill(args: FulfillArgs): Promise<SignedNearTx> {
    return this.#signer().sign(FULFILL_EVM_METHOD, { chain: this.#o.chain, ...args });
  }

  async signFulfillNear(args: NearFulfillArgs): Promise<SignedNearTx> {
    return this.#signer().sign(FULFILL_NEAR_METHOD, { ...args });
  }

  async relayerKeyPermission(): Promise<unknown> {
    const publicKey = await this.#signer().publicKey();
    const view = this.#o.rpc.viewAccessKey({ accountId: this.#o.relayerId, publicKey });
    return field(await withTimeout(view, this.#o.timeoutMs, "view access key"), "permission");
  }

  async sendSigned(signed: SignedNearTx): Promise<NearTxOutcome> {
    const decode = this.#o.decode ?? ((bytes: Uint8Array) => SignedTransaction.decode(bytes));
    const tx = decode(base64Decode(signed.signedTxBase64)) as SignedTransaction;
    try {
      return outcomeFromResponse(await withTimeout(this.#o.rpc.sendTransactionUntil(tx, "FINAL"), this.#o.timeoutMs, "send_tx"), this.#parse);
    } catch (err) {
      const text = errorText(err);
      if (NEVER_EXECUTED.test(text)) return { kind: "invalid", error: err instanceof Error ? err.message : text };
      if (RETRY_LATER.test(text)) return { kind: "unknown" };
      throw err;
    }
  }

  async txOutcome(txHash: string): Promise<NearTxOutcome> {
    try {
      const resp = await withTimeout(
        this.#o.rpc.viewTransactionStatus({ txHash, accountId: this.#o.relayerId, waitUntil: "NONE" }),
        this.#o.timeoutMs,
        "tx status",
      );
      return outcomeFromResponse(resp, this.#parse);
    } catch (err) {
      if (UNKNOWN_TX.test(errorText(err))) return { kind: "unknown" };
      throw err;
    }
  }
}

export function createFulfillSigner(provider: JsonRpcProvider, relayerId: string, secretKey: string, contractId: string, gasTera: number): FulfillSigner {
  const signer = KeyPairSigner.fromSecretKey(secretKey as KeyPairString);
  const account = new Account(relayerId, provider, signer);
  return {
    async publicKey(): Promise<string> {
      return (await signer.getPublicKey()).toString();
    },
    async sign(method: string, args: object): Promise<SignedNearTx> {
      const publicKey = await signer.getPublicKey();
      const call = actions.functionCall(method, { ...args }, teraToGas(gasTera), 0n);
      const tx = await account.createTransaction({ receiverId: contractId, actions: [call], publicKey });
      const { txHash, signedTransaction } = await signer.signTransaction(tx);
      return { txHash: baseEncode(txHash), signedTxBase64: base64Encode(signedTransaction.encode()) };
    },
  };
}
