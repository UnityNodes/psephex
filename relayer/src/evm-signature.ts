import {
  decodeFunctionData,
  getAddress,
  keccak256,
  parseTransaction,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
  toHex,
  type Address,
  type Hex,
  type TransactionSerializableEIP1559,
} from "viem";
import { aiOracleAbi } from "./abi.js";
import type { MpcSignature, OnSignedResult } from "./types.js";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export class SignatureError extends Error {
  override readonly name = "SignatureError";
}

export interface ExpectedFulfill {
  readonly requestId: bigint;
  readonly aiOracle: Address;
  readonly oracleAddress: Address;
  readonly chainId: number;
  readonly nonce: number;
  readonly maxFeePerGas: bigint;
  readonly maxGas: bigint;
  readonly questionHash: Hex;
  readonly answerCode?: number;
}

export interface SignedFulfill {
  readonly signedTx: Hex;
  readonly txHash: Hex;
  readonly nonce: number;
  readonly answerCode: number;
}

interface EvmSignature {
  readonly r: Hex;
  readonly s: Hex;
  readonly yParity: number;
}

function strip0x(value: string): string {
  return value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
}

function hexField(value: { readonly affine_point: string } | { readonly scalar: string } | string): string {
  if (typeof value === "string") return strip0x(value).toLowerCase();
  const raw = "affine_point" in value ? value.affine_point : value.scalar;
  return strip0x(raw).toLowerCase();
}

function toEvmSignature(sig: MpcSignature): EvmSignature {
  const r = hexField(sig.big_r);
  const s = hexField(sig.s);
  if (!/^0[23][0-9a-f]{64}$/.test(r)) throw new SignatureError("big_r must be a 33-byte compressed secp256k1 point");
  if (!/^[0-9a-f]{64}$/.test(s)) throw new SignatureError("s must be 32 bytes of hex");
  if (sig.recovery_id !== 0 && sig.recovery_id !== 1) throw new SignatureError(`unsupported recovery_id ${sig.recovery_id}`);
  let sValue = BigInt(`0x${s}`);
  if (sValue === 0n || sValue >= SECP256K1_N) throw new SignatureError("s out of range");
  let yParity = sig.recovery_id;
  if (sValue > SECP256K1_N / 2n) {
    sValue = SECP256K1_N - sValue;
    yParity ^= 1;
  }
  return { r: `0x${r.slice(2)}`, s: toHex(sValue, { size: 32 }), yParity };
}

function parseUnsigned(result: OnSignedResult): { unsigned: Hex; payload: Hex; signature: MpcSignature } {
  if (!result.ok) throw new SignatureError(`MPC signing failed: ${result.error ?? "ok=false"}`);
  if (!result.signature) throw new SignatureError("result has no signature");
  const unsignedHex = strip0x(result.unsigned_tx ?? "").toLowerCase();
  const payloadHex = strip0x(result.payload ?? "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(unsignedHex)) throw new SignatureError("unsigned_tx is not hex");
  if (!/^[0-9a-f]{64}$/.test(payloadHex)) throw new SignatureError("payload is not 32 bytes of hex");
  const unsigned: Hex = `0x${unsignedHex}`;
  const payload: Hex = `0x${payloadHex}`;
  if (keccak256(unsigned) !== payload) throw new SignatureError("payload is not keccak256(unsigned_tx)");
  return { unsigned, payload, signature: result.signature };
}

function checkEnvelope(tx: TransactionSerializableEIP1559, expected: ExpectedFulfill): void {
  if (tx.chainId !== expected.chainId) throw new SignatureError(`tx chain ${tx.chainId} is not ${expected.chainId}`);
  if (tx.nonce !== expected.nonce) throw new SignatureError(`tx nonce ${tx.nonce} is not the reserved nonce ${expected.nonce}`);
  if ((tx.maxFeePerGas ?? 0n) > expected.maxFeePerGas) throw new SignatureError(`tx maxFeePerGas ${tx.maxFeePerGas} is above ${expected.maxFeePerGas}`);
  if ((tx.gas ?? 0n) > expected.maxGas) throw new SignatureError(`tx gas ${tx.gas} is above ${expected.maxGas}`);
}

function checkCall(tx: TransactionSerializableEIP1559, expected: ExpectedFulfill): number {
  checkEnvelope(tx, expected);
  if (!tx.to || getAddress(tx.to) !== getAddress(expected.aiOracle)) throw new SignatureError(`tx to ${tx.to} is not AiOracle ${expected.aiOracle}`);
  if ((tx.value ?? 0n) !== 0n) throw new SignatureError("tx carries value");
  const call = decodeFunctionData({ abi: aiOracleAbi, data: tx.data ?? "0x" });
  if (call.functionName !== "fulfill") throw new SignatureError(`tx calls ${call.functionName}, not fulfill`);
  const [id, answer, questionHash] = call.args;
  if (id !== expected.requestId) throw new SignatureError(`tx request id ${id} is not ${expected.requestId}`);
  if (questionHash.toLowerCase() !== expected.questionHash.toLowerCase()) throw new SignatureError(`tx question hash ${questionHash} is not ${expected.questionHash}`);
  if (expected.answerCode !== undefined && answer !== expected.answerCode) throw new SignatureError(`tx answer ${answer} is not the consensus answer ${expected.answerCode}`);
  return answer;
}

export async function assembleSignedFulfill(result: OnSignedResult, expected: ExpectedFulfill): Promise<SignedFulfill> {
  const { unsigned, payload, signature: mpc } = parseUnsigned(result);
  const parsed = parseTransaction(unsigned);
  if (parsed.type !== "eip1559") throw new SignatureError(`unsigned tx type ${parsed.type}, expected eip1559`);
  const tx = parsed as TransactionSerializableEIP1559;
  const answerCode = checkCall(tx, expected);
  const signature = toEvmSignature(mpc);
  const recovered = await recoverAddress({ hash: payload, signature });
  if (recovered !== getAddress(expected.oracleAddress)) throw new SignatureError(`recovered signer ${recovered} is not ${expected.oracleAddress}`);
  const signedTx = serializeTransaction(tx, signature);
  const sender = await recoverTransactionAddress({ serializedTransaction: signedTx as `0x02${string}` });
  if (sender !== getAddress(expected.oracleAddress)) throw new SignatureError(`signed tx recovers to ${sender}`);
  return { signedTx, txHash: keccak256(signedTx), nonce: tx.nonce ?? 0, answerCode };
}
