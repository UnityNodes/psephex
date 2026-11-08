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
  NearOraclePort,
  NearTxOutcome,
  OnSignedResult,
  SignedNearTx,
} from "./types.js";

const FINAL_STATUSES = new Set(["FINAL", "EXECUTED"]);
const UNKNOWN_TX = /unknown transaction|UNKNOWN_TRANSACTION/i;
const RETRY_LATER = /timed out|timeout|\b408\b|\b504\b/i;
const NEVER_EXECUTED = /InvalidNonce|Expired/i;

export interface NearRpc {
  callFunction<T>(args: { contractId: string; method: string; args: object }): Promise<T | undefined>;
  viewTransactionStatus(args: { txHash: string; accountId: string; waitUntil: "NONE" }): Promise<unknown>;
  sendTransactionUntil(signed: SignedTransaction, waitUntil: "FINAL"): Promise<unknown>;
  viewAccessKey(args: { accountId: string; publicKey: string }): Promise<unknown>;
}

export interface FulfillSigner {
  sign(args: FulfillArgs): Promise<SignedNearTx>;
  publicKey(): Promise<string>;
}

export interface NearOracleOptions {
  readonly rpc: NearRpc;
  readonly contractId: string;
  readonly relayerId: string;
  readonly signer: FulfillSigner | null;
  readonly fulfillGasTera: number;
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

function parseOnSigned(base64: string): NearTxOutcome {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return { kind: "failure", error: "fulfill_on_base returned a value that is not JSON" };
  }
  if (typeof field(value, "ok") !== "boolean") return { kind: "failure", error: `unexpected fulfill_on_base result: ${JSON.stringify(value)}` };
  return { kind: "success", result: value as OnSignedResult };
}

export function outcomeFromResponse(resp: unknown): NearTxOutcome {
  const finality = field(resp, "final_execution_status");
  const status = field(resp, "status");
  if (typeof finality !== "string" || !FINAL_STATUSES.has(finality)) return { kind: "unknown" };
  const failure = field(status, "Failure");
  if (failure !== undefined) return { kind: "failure", error: failureMessage(failure) };
  const success = field(status, "SuccessValue");
  if (typeof success === "string") return parseOnSigned(success);
  return { kind: "unknown" };
}

function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export class NearOracle implements NearOraclePort {
  readonly #o: NearOracleOptions;

  constructor(opts: NearOracleOptions) {
    this.#o = opts;
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
    const body = await this.#view<unknown>("build_request", { request_id: requestId, question, model });
    if (typeof body !== "string") throw new Error("build_request did not return a string");
    return body;
  }

  async verifyConsensus(requestId: number, question: string, answers: readonly ConsensusAnswer[]): Promise<ConsensusResult> {
    const result = await this.#view<ConsensusResult>("verify_consensus", { request_id: requestId, question, answers });
    if (!result || typeof result.ok !== "boolean") throw new Error("verify_consensus returned an unexpected value");
    return result;
  }

  async isFulfilled(requestId: number): Promise<boolean> {
    return (await this.#view<boolean>("is_fulfilled", { request_id: requestId })) === true;
  }

  async maxFeePerGasCap(): Promise<bigint> {
    const raw = await this.#view<unknown>("max_fee_per_gas_cap", {});
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error("max_fee_per_gas_cap is not a decimal string");
    return BigInt(raw);
  }

  async config(): Promise<{ base_oracle_address: string; base_chain_id: number; signer: string; path: string }> {
    const raw = await this.#view<unknown>("config", {});
    const address = field(raw, "base_oracle_address");
    const chainId = field(raw, "base_chain_id");
    const signer = field(raw, "signer");
    const path = field(raw, "path");
    if (typeof address !== "string" || typeof chainId !== "number" || typeof signer !== "string" || typeof path !== "string") {
      throw new Error("config() returned an unexpected value");
    }
    return { base_oracle_address: address, base_chain_id: chainId, signer, path };
  }

  async derivedPublicKey(signer: string, path: string, predecessor: string): Promise<string> {
    const call = this.#o.rpc.callFunction<unknown>({ contractId: signer, method: "derived_public_key", args: { path, predecessor, domain_id: 0 } });
    const key = await withTimeout(call, this.#o.timeoutMs, "view derived_public_key");
    if (typeof key !== "string") throw new Error("derived_public_key did not return a string");
    return key;
  }

  async signFulfill(args: FulfillArgs): Promise<SignedNearTx> {
    if (!this.#o.signer) throw new Error("no relayer key configured for signing");
    return this.#o.signer.sign(args);
  }

  async relayerKeyPermission(): Promise<unknown> {
    if (!this.#o.signer) throw new Error("no relayer key configured for signing");
    const publicKey = await this.#o.signer.publicKey();
    const view = this.#o.rpc.viewAccessKey({ accountId: this.#o.relayerId, publicKey });
    return field(await withTimeout(view, this.#o.timeoutMs, "view access key"), "permission");
  }

  async sendSigned(signed: SignedNearTx): Promise<NearTxOutcome> {
    const decode = this.#o.decode ?? ((bytes: Uint8Array) => SignedTransaction.decode(bytes));
    const tx = decode(base64Decode(signed.signedTxBase64)) as SignedTransaction;
    try {
      return outcomeFromResponse(await withTimeout(this.#o.rpc.sendTransactionUntil(tx, "FINAL"), this.#o.timeoutMs, "send_tx"));
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
      return outcomeFromResponse(resp);
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
    async sign(args: FulfillArgs): Promise<SignedNearTx> {
      const publicKey = await signer.getPublicKey();
      const call = actions.functionCall("fulfill_on_base", { ...args }, teraToGas(gasTera), 0n);
      const tx = await account.createTransaction({ receiverId: contractId, actions: [call], publicKey });
      const { txHash, signedTransaction } = await signer.signTransaction(tx);
      return { txHash: baseEncode(txHash), signedTxBase64: base64Encode(signedTransaction.encode()) };
    },
  };
}
