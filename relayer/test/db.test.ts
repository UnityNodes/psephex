import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Repository } from "../src/db.js";
import type { AskedEvent } from "../src/types.js";

function asked(id: bigint, overrides: Partial<AskedEvent> = {}): AskedEvent {
  return {
    id,
    requester: "0xCa744C595A6C2EE470257D2B873aEd2b1a78E092",
    question: `question ${id}`,
    questionHash: `0x${"ab".repeat(32)}`,
    paidWei: 100_000_000_000_000n,
    blockNumber: 100n + id,
    txHash: `0x${id.toString(16).padStart(64, "0")}`,
    logIndex: 0,
    ...overrides,
  };
}

describe("repository", () => {
  let repo: Repository;
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    repo = openDatabase(":memory:", { now: () => now });
  });

  afterEach(() => repo.close());

  it("applies migrations once and reports the schema version", () => {
    expect(repo.schemaVersion()).toBe(1);
    repo.migrate();
    expect(repo.schemaVersion()).toBe(1);
  });

  it("stores asked events and cursor atomically, ignoring duplicates", () => {
    expect(repo.getCursor("base")).toBeNull();
    repo.recordAsked([asked(1n), asked(2n)], 150n);
    repo.recordAsked([asked(2n, { question: "changed" })], 160n);
    expect(repo.getCursor("base")).toBe(160n);
    expect(repo.getRequest(2)?.question).toBe("question 2");
    expect(repo.getRequest(1)?.status).toBe("seen");
    expect(repo.getRequest(1)?.paidWei).toBe("100000000000000");
  });

  it("lists only active requests in id order", () => {
    repo.recordAsked([asked(3n), asked(1n), asked(2n)], 10n);
    repo.updateRequest(2, { status: "confirmed" });
    repo.updateRequest(3, { status: "near_sent" });
    expect(repo.listActive().map((r) => r.id)).toEqual([1, 3]);
  });

  it("updates status, reason, retries and answer and bumps updatedAt", () => {
    repo.recordAsked([asked(1n)], 10n);
    now = 2_000;
    repo.updateRequest(1, { status: "rejected", reason: "consensus: no majority", retries: 2, answer: "YES", votesJson: "[]" });
    const row = repo.getRequest(1);
    expect(row).toMatchObject({ status: "rejected", reason: "consensus: no majority", retries: 2, answer: "YES", votesJson: "[]", createdAt: 1_000, updatedAt: 2_000 });
  });

  it("counts earlier requests from the same origin inside a window", () => {
    repo.recordAsked([asked(1n), asked(2n), asked(3n)], 10n);
    repo.updateRequest(1, { origin: "0xaaa" });
    repo.updateRequest(2, { origin: "0xaaa" });
    repo.updateRequest(3, { origin: "0xaaa" });
    expect(repo.countOriginBefore("0xaaa", 3, 0)).toBe(2);
    expect(repo.countOriginBefore("0xaaa", 3, 5_000)).toBe(0);
    expect(repo.countOriginBefore("0xbbb", 3, 0)).toBe(0);
  });

  it("tracks model attempts, completions and signatures separately", () => {
    repo.recordAsked([asked(1n)], 10n);
    expect(repo.beginModelAttempt(1, "m1", "near-ai", "{\"a\":1}")).toBe(1);
    expect(repo.beginModelAttempt(1, "m1", "near-ai", "{\"a\":1}")).toBe(2);
    repo.releaseModelAttempt(1, "m1");
    repo.saveModelCompletion(1, "m1", { chatId: "chat-1", responseBody: "{\"r\":1}", latencyMs: 42 });
    expect(repo.getModelAnswers(1)[0]).toMatchObject({ attempts: 1, chatId: "chat-1", responseBody: "{\"r\":1}", signatureHex: null });
    repo.saveModelSignature(1, "m1", { text: "t", signatureHex: "aa", signingAddress: "bb" });
    expect(repo.getModelAnswers(1)[0]).toMatchObject({ model: "m1", attempts: 1, signatureHex: "aa", signedText: "t", latencyMs: 42 });
  });

  it("refuses to overwrite a stored completion or signature", () => {
    repo.recordAsked([asked(1n)], 10n);
    repo.beginModelAttempt(1, "m1", "near-ai", "{}");
    expect(() => repo.saveModelSignature(1, "m1", { text: "t", signatureHex: "aa", signingAddress: "bb" })).toThrow(/no completion/);
    repo.saveModelCompletion(1, "m1", { chatId: "c", responseBody: "{}", latencyMs: 1 });
    expect(() => repo.saveModelCompletion(1, "m1", { chatId: "c2", responseBody: "{}", latencyMs: 1 })).toThrow(/already/);
    repo.saveModelSignature(1, "m1", { text: "t", signatureHex: "aa", signingAddress: "bb" });
    expect(() => repo.saveModelSignature(1, "m1", { text: "t", signatureHex: "cc", signingAddress: "bb" })).toThrow(/already/);
  });

  it("updates only from the expected status", () => {
    repo.recordAsked([asked(1n)], 10n);
    expect(repo.updateRequest(1, { status: "answering" }, "seen")).toBe(true);
    expect(repo.updateRequest(1, { status: "verified" }, "seen")).toBe(false);
    expect(repo.getRequest(1)?.status).toBe("answering");
  });

  it("reports the highest nonce with a Base receipt", () => {
    repo.recordAsked([asked(1n), asked(2n), asked(3n)], 10n);
    expect(repo.maxConfirmedNonce()).toBeNull();
    repo.saveNearTx({ requestId: 1, txHash: "N1", nonce: 4, maxFee: "1", maxPriorityFee: "1", signedTxBase64: "a" });
    repo.markNearResult("N1", true, "02", "{}");
    repo.saveBaseTx({ requestId: 1, txHash: "0x1", signedTx: "0x02" });
    expect(repo.maxConfirmedNonce()).toBeNull();
    repo.markBaseReceipt("0x1", "success", 1n, "[]");
    repo.saveNearTx({ requestId: 2, txHash: "N2", nonce: 5, maxFee: "1", maxPriorityFee: "1", signedTxBase64: "a" });
    repo.markNearResult("N2", false, null, "{}");
    expect(repo.maxConfirmedNonce()).toBe(4);
  });

  it("reports id conflicts after a reorg and records invalid events as rejected", () => {
    repo.recordAsked([asked(1n)], 10n);
    const conflicts = repo.recordAsked([asked(1n, { questionHash: `0x${"cd".repeat(32)}` })], 20n, [{ event: asked(2n), reason: "question hash mismatch" }]);
    expect(conflicts).toEqual([1]);
    expect(repo.getRequest(2)).toMatchObject({ status: "rejected", reason: "question hash mismatch" });
    expect(repo.countActive()).toBe(1);
  });

  it("counts model calls per day", () => {
    expect(repo.modelCallsOn("2026-11-08")).toBe(0);
    repo.addModelCalls("2026-11-08", 3);
    repo.addModelCalls("2026-11-08", 1);
    expect(repo.modelCallsOn("2026-11-08")).toBe(4);
    expect(repo.modelCallsOn("2026-11-09")).toBe(0);
  });

  it("stores near txs before sending and records their result", () => {
    repo.recordAsked([asked(1n)], 10n);
    repo.saveNearTx({ requestId: 1, txHash: "H1", nonce: 5, maxFee: "2000", maxPriorityFee: "1", signedTxBase64: "c2lnbmVk" });
    expect(repo.latestNearTx(1)).toMatchObject({ txHash: "H1", nonce: 5, ok: null });
    repo.markNearResult("H1", true, "02ab", "{\"s\":1}");
    expect(repo.latestNearTx(1)).toMatchObject({ ok: true, unsignedTx: "02ab", signatureJson: "{\"s\":1}" });
    repo.saveNearTx({ requestId: 1, txHash: "H2", nonce: 6, maxFee: "2000", maxPriorityFee: "1", signedTxBase64: "eA==" });
    expect(repo.latestNearTx(1)?.txHash).toBe("H2");
  });

  it("stores base txs and receipts", () => {
    repo.recordAsked([asked(1n)], 10n);
    repo.saveBaseTx({ requestId: 1, txHash: "0xb1", signedTx: "0x02ff" });
    expect(repo.latestBaseTx(1)).toMatchObject({ txHash: "0xb1", signedTx: "0x02ff", status: "sent", sentAt: 1_000 });
    repo.markBaseReceipt("0xb1", "success", 40_000n, "[]");
    expect(repo.latestBaseTx(1)).toMatchObject({ status: "success", gasUsed: "40000", eventsJson: "[]" });
  });

  it("returns undefined for unknown rows", () => {
    expect(repo.getRequest(99)).toBeUndefined();
    expect(repo.latestNearTx(99)).toBeUndefined();
    expect(repo.latestBaseTx(99)).toBeUndefined();
  });
});
