import type { Address, Hex } from "viem";

export type RequestStatus =
  | "seen"
  | "answering"
  | "verified"
  | "near_sent"
  | "near_signed"
  | "base_sent"
  | "confirmed"
  | "rejected"
  | "failed";

export const REQUEST_STATUSES: readonly RequestStatus[] = ["seen", "answering", "verified", "near_sent", "near_signed", "base_sent", "confirmed", "rejected", "failed"];

export const TERMINAL_STATUSES: readonly RequestStatus[] = ["confirmed", "rejected", "failed"];

export interface AskedEvent {
  readonly id: bigint;
  readonly requester: Address;
  readonly question: string;
  readonly questionHash: Hex;
  readonly paidWei: bigint;
  readonly blockNumber: bigint;
  readonly txHash: Hex;
  readonly logIndex: number;
}

export interface RequestRow {
  readonly id: number;
  readonly requester: string;
  readonly origin: string | null;
  readonly question: string;
  readonly questionHash: string;
  readonly paidWei: string;
  readonly askedTx: string;
  readonly status: RequestStatus;
  readonly reason: string | null;
  readonly retries: number;
  readonly answer: string | null;
  readonly votesJson: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ModelInfo {
  readonly model: string;
  readonly provider: string;
  readonly scheme: string;
  readonly publicKey: string;
}

export interface ModelAnswerRow {
  readonly requestId: number;
  readonly model: string;
  readonly provider: string;
  readonly requestBody: string;
  readonly responseBody: string | null;
  readonly chatId: string | null;
  readonly signatureHex: string | null;
  readonly signedText: string | null;
  readonly attempts: number;
  readonly latencyMs: number | null;
}

export interface Vote {
  readonly model: string;
  readonly answer: string;
}

export interface ConsensusResult {
  readonly ok: boolean;
  readonly answer: string;
  readonly reason: string;
  readonly required: number;
  readonly votes: readonly Vote[];
}

export interface ConsensusAnswer {
  readonly model: string;
  readonly response_body: string;
  readonly signature_hex: string;
}

export interface MpcSignature {
  readonly big_r: { readonly affine_point: string } | string;
  readonly s: { readonly scalar: string } | string;
  readonly recovery_id: number;
}

export interface OnSignedResult {
  readonly ok: boolean;
  readonly request_id?: number;
  readonly unsigned_tx?: string;
  readonly payload?: string;
  readonly signature?: MpcSignature;
  readonly error?: string;
}

export interface FulfillArgs {
  readonly request_id: number;
  readonly question: string;
  readonly answers: readonly ConsensusAnswer[];
  readonly nonce: number;
  readonly max_fee_per_gas: string;
  readonly max_priority_fee_per_gas: string;
}

export interface SignedNearTx {
  readonly txHash: string;
  readonly signedTxBase64: string;
}

export type NearTxOutcome =
  | { readonly kind: "success"; readonly result: OnSignedResult }
  | { readonly kind: "failure"; readonly error: string }
  | { readonly kind: "invalid"; readonly error: string }
  | { readonly kind: "unknown" };

export interface NearOraclePort {
  models(): Promise<ModelInfo[]>;
  buildRequest(requestId: number, question: string, model: string): Promise<string>;
  verifyConsensus(requestId: number, question: string, answers: readonly ConsensusAnswer[]): Promise<ConsensusResult>;
  isFulfilled(requestId: number): Promise<boolean>;
  maxFeePerGasCap(): Promise<bigint>;
  signFulfill(args: FulfillArgs): Promise<SignedNearTx>;
  sendSigned(signed: SignedNearTx): Promise<NearTxOutcome>;
  txOutcome(txHash: string): Promise<NearTxOutcome>;
}

export interface ModelReply {
  readonly chatId: string;
  readonly responseBody: string;
  readonly latencyMs: number;
}

export interface ModelSignature {
  readonly text: string;
  readonly signatureHex: string;
  readonly signingAddress: string;
}

export interface ModelProviderPort {
  complete(requestBody: string): Promise<ModelReply>;
  signature(chatId: string): Promise<ModelSignature>;
}

export interface FeeQuote {
  readonly baseFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface BaseReceipt {
  readonly status: "success" | "reverted";
  readonly blockNumber: bigint;
  readonly gasUsed: bigint;
  readonly eventsJson: string;
}

export interface BaseChainPort {
  headBlock(): Promise<bigint>;
  askedEvents(fromBlock: bigint, toBlock: bigint): Promise<AskedEvent[]>;
  txSender(txHash: Hex): Promise<Address>;
  isFulfilledOnBase(requestId: bigint): Promise<boolean>;
  pendingNonce(address: Address): Promise<number>;
  feeQuote(): Promise<FeeQuote>;
  sendRawTransaction(signedTx: Hex): Promise<Hex>;
  receipt(txHash: Hex): Promise<BaseReceipt | null>;
}

export interface Clock {
  now(): number;
}
