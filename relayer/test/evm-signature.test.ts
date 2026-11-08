import { describe, expect, it } from "vitest";
import { encodeFunctionData, keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { aiOracleAbi } from "../src/abi.js";
import { assembleSignedFulfill, SignatureError } from "../src/evm-signature.js";
import type { MpcSignature, OnSignedResult } from "../src/types.js";

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const PRIVATE_KEY = generatePrivateKey();
const signer = privateKeyToAccount(PRIVATE_KEY);
const AIORACLE = "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111" as const;
const QUESTION_HASH = keccak256(new TextEncoder().encode("Did it ship?"));

function unsignedFulfill(id: bigint, answer: number, to: Hex = AIORACLE): Hex {
  return serializeTransaction({
    type: "eip1559",
    chainId: 84532,
    nonce: 3,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    gas: 300_000n,
    to,
    value: 0n,
    data: encodeFunctionData({ abi: aiOracleAbi, functionName: "fulfill", args: [id, answer, QUESTION_HASH] }),
  });
}

async function mpcSign(unsigned: Hex, opts: { highS?: boolean } = {}): Promise<MpcSignature> {
  const payload = keccak256(unsigned);
  const sig = await sign({ hash: payload, privateKey: PRIVATE_KEY });
  const yParity = sig.yParity ?? 0;
  let s = BigInt(sig.s);
  let parity = yParity;
  if (opts.highS) {
    s = SECP256K1_N - s;
    parity ^= 1;
  }
  const prefix = parity === 1 ? "03" : "02";
  return {
    big_r: { affine_point: `${prefix}${sig.r.slice(2)}`.toUpperCase() },
    s: { scalar: s.toString(16).padStart(64, "0").toUpperCase() },
    recovery_id: parity,
  };
}

async function nearResult(unsigned: Hex, opts: { highS?: boolean } = {}): Promise<OnSignedResult> {
  return { ok: true, request_id: 7, unsigned_tx: unsigned.slice(2), payload: keccak256(unsigned).slice(2), signature: await mpcSign(unsigned, opts) };
}

const expected = { requestId: 7n, aiOracle: AIORACLE, oracleAddress: signer.address, chainId: 84532, nonce: 3, maxFeePerGas: 2_000_000_000n, maxGas: 300_000n, questionHash: QUESTION_HASH };

describe("assembleSignedFulfill", () => {
  it("assembles a signed tx that recovers to the oracle address", async () => {
    const unsigned = unsignedFulfill(7n, 1);
    const result = await assembleSignedFulfill(await nearResult(unsigned), expected);
    const parsed = parseTransaction(result.signedTx);
    expect(parsed.to?.toLowerCase()).toBe(AIORACLE.toLowerCase());
    expect(result.txHash).toBe(keccak256(result.signedTx));
    expect(result.answerCode).toBe(1);
    expect(result.nonce).toBe(3);
  });

  it("normalizes a high-s signature and flips parity", async () => {
    const unsigned = unsignedFulfill(7n, 2);
    const result = await assembleSignedFulfill(await nearResult(unsigned, { highS: true }), expected);
    const parsed = parseTransaction(result.signedTx);
    expect(BigInt(parsed.s ?? "0x0") <= SECP256K1_N / 2n).toBe(true);
    expect(result.answerCode).toBe(2);
  });

  it("accepts plain string big_r and s fields", async () => {
    const unsigned = unsignedFulfill(7n, 0);
    const sig = await mpcSign(unsigned);
    const flat: MpcSignature = {
      big_r: typeof sig.big_r === "string" ? sig.big_r : sig.big_r.affine_point,
      s: typeof sig.s === "string" ? sig.s : sig.s.scalar,
      recovery_id: sig.recovery_id,
    };
    const result = await assembleSignedFulfill({ ok: true, unsigned_tx: unsigned, payload: keccak256(unsigned), signature: flat }, expected);
    expect(result.answerCode).toBe(0);
  });

  it("rejects a result that is not ok", async () => {
    await expect(assembleSignedFulfill({ ok: false, error: "mpc down" }, expected)).rejects.toThrow(SignatureError);
  });

  it("rejects a payload that is not keccak of the unsigned tx", async () => {
    const unsigned = unsignedFulfill(7n, 1);
    const result = { ...(await nearResult(unsigned)), payload: "00".repeat(32) };
    await expect(assembleSignedFulfill(result, expected)).rejects.toThrow(/payload/);
  });

  it("rejects a signature from a different key", async () => {
    const unsigned = unsignedFulfill(7n, 1);
    const other = { ...expected, oracleAddress: "0x0000000000000000000000000000000000000001" as const };
    await expect(assembleSignedFulfill(await nearResult(unsigned), other)).rejects.toThrow(/recovered/);
  });

  it("rejects a tx to another contract", async () => {
    const unsigned = unsignedFulfill(7n, 1, "0x0000000000000000000000000000000000000002");
    await expect(assembleSignedFulfill(await nearResult(unsigned), expected)).rejects.toThrow(/to/);
  });

  it("rejects a tx for another request id", async () => {
    const unsigned = unsignedFulfill(8n, 1);
    await expect(assembleSignedFulfill(await nearResult(unsigned), expected)).rejects.toThrow(/request id/);
  });

  it("rejects a tx for another chain", async () => {
    const unsigned = unsignedFulfill(7n, 1);
    await expect(assembleSignedFulfill(await nearResult(unsigned), { ...expected, chainId: 1 })).rejects.toThrow(/chain/);
  });

  it("checks the answer code when the consensus answer is known", async () => {
    const unsigned = unsignedFulfill(7n, 2);
    await expect(assembleSignedFulfill(await nearResult(unsigned), { ...expected, answerCode: 1 })).rejects.toThrow(/answer/);
    await expect(assembleSignedFulfill(await nearResult(unsigned), { ...expected, answerCode: 2 })).resolves.toMatchObject({ answerCode: 2 });
  });

  it("rejects a tx whose nonce, fee, gas or question hash differ from what was signed for", async () => {
    const result = await nearResult(unsignedFulfill(7n, 1));
    await expect(assembleSignedFulfill(result, { ...expected, nonce: 4 })).rejects.toThrow(/nonce/);
    await expect(assembleSignedFulfill(result, { ...expected, maxFeePerGas: 1_000_000_000n })).rejects.toThrow(/maxFeePerGas/);
    await expect(assembleSignedFulfill(result, { ...expected, maxGas: 200_000n })).rejects.toThrow(/gas/);
    await expect(assembleSignedFulfill(result, { ...expected, questionHash: `0x${"00".repeat(32)}` })).rejects.toThrow(/question hash/);
  });

  it("rejects malformed signature fields", async () => {
    const unsigned = unsignedFulfill(7n, 1);
    const base = await nearResult(unsigned);
    const badR = { ...base, signature: { big_r: "04" + "11".repeat(32), s: "11".repeat(32), recovery_id: 0 } };
    await expect(assembleSignedFulfill(badR, expected)).rejects.toThrow(/big_r/);
    const badS = { ...base, signature: { big_r: "02" + "11".repeat(32), s: "00".repeat(32), recovery_id: 0 } };
    await expect(assembleSignedFulfill(badS, expected)).rejects.toThrow(/s out of range/);
    const badRec = { ...base, signature: { big_r: "02" + "11".repeat(32), s: "11".repeat(32), recovery_id: 2 } };
    await expect(assembleSignedFulfill(badRec, expected)).rejects.toThrow(/recovery_id/);
  });
});
