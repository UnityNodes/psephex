import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Repository } from "../src/db.js";
import { mergeDatabases } from "../src/merge.js";
import { askedEvent, ManualClock } from "./fakes.js";

const STUB = "already fulfilled on Base";

function confirm(repo: Repository, id: number, nonce: number): void {
  repo.beginModelAttempt(id, "m/A", "near-ai", `body-${id}`);
  repo.saveModelCompletion(id, "m/A", { chatId: `c${id}`, responseBody: `resp-${id}`, latencyMs: 5 });
  repo.saveModelSignature(id, "m/A", { text: `t${id}`, signatureHex: "ab", signingAddress: "00" });
  const near = `near${id}${"x".repeat(40)}`;
  repo.saveNearTx({ requestId: id, txHash: near, nonce, maxFee: "1", maxPriorityFee: "1", signedTxBase64: "AA" });
  repo.markNearResult(near, true, "02", "{}");
  const base = `0x${String(id).padStart(64, "0")}`;
  repo.saveBaseTx({ requestId: id, txHash: base, signedTx: "0x02" });
  repo.markBaseReceipt(base, "success", 70_000n, "[]");
  repo.updateRequest(id, { status: "confirmed", answer: "YES", votesJson: "[]" });
}

describe("mergeDatabases", () => {
  let dir: string;
  let primary: string;
  let secondary: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "psephex-merge-"));
    primary = join(dir, "run2.sqlite");
    secondary = join(dir, "run1.sqlite");
    out = join(dir, "prod.sqlite");
    const second = openDatabase(secondary, new ManualClock());
    second.recordAsked([askedEvent(1n), askedEvent(2n)], 150n);
    confirm(second, 1, 0);
    confirm(second, 2, 1);
    second.addModelCalls("2026-11-08", 9);
    second.close();
    const first = openDatabase(primary, new ManualClock());
    first.recordAsked([askedEvent(1n), askedEvent(2n), askedEvent(3n)], 300n);
    first.updateRequest(1, { status: "rejected", reason: STUB });
    first.updateRequest(2, { status: "rejected", reason: STUB });
    confirm(first, 3, 2);
    first.addModelCalls("2026-11-08", 4);
    first.addModelCalls("2026-11-09", 1);
    first.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaces already-fulfilled stubs with the full rows from the other run", () => {
    const report = mergeDatabases({ primary, secondary, out });
    expect(report).toEqual({ fromPrimary: [3], fromSecondary: [1, 2], cursor: "300", requests: 3 });
    const db = new Database(out, { readonly: true });
    expect(db.prepare("SELECT id, status, answer FROM requests ORDER BY id").all()).toEqual([
      { id: 1, status: "confirmed", answer: "YES" },
      { id: 2, status: "confirmed", answer: "YES" },
      { id: 3, status: "confirmed", answer: "YES" },
    ]);
    expect(db.prepare("SELECT request_id, nonce FROM near_txs ORDER BY nonce").all()).toEqual([
      { request_id: 1, nonce: 0 },
      { request_id: 2, nonce: 1 },
      { request_id: 3, nonce: 2 },
    ]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM base_txs").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM model_answers").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT day, model_calls FROM budget ORDER BY day").all()).toEqual([
      { day: "2026-11-08", model_calls: 13 },
      { day: "2026-11-09", model_calls: 1 },
    ]);
    db.close();
  });

  it("produces a database the relayer opens and continues from", () => {
    mergeDatabases({ primary, secondary, out });
    const repo = openDatabase(out, new ManualClock());
    expect(repo.getCursor("base")).toBe(300n);
    expect(repo.listActive()).toEqual([]);
    expect(repo.maxConfirmedNonce()).toBe(2);
    repo.close();
  });

  it("does not touch its inputs", () => {
    const before = [statSync(primary).mtimeMs, statSync(secondary).mtimeMs];
    mergeDatabases({ primary, secondary, out });
    expect([statSync(primary).mtimeMs, statSync(secondary).mtimeMs]).toEqual(before);
  });

  it("refuses to overwrite an existing output", () => {
    mergeDatabases({ primary, secondary, out });
    expect(() => mergeDatabases({ primary, secondary, out })).toThrow(/already exists/);
  });

  it("refuses ids whose question differs between runs", () => {
    const db = new Database(secondary);
    db.prepare("UPDATE requests SET question_hash = ? WHERE id = 1").run(`0x${"ff".repeat(32)}`);
    db.close();
    expect(() => mergeDatabases({ primary, secondary, out })).toThrow(/request 1 has another question/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses two real copies of the same request", () => {
    const db = new Database(primary);
    db.prepare("UPDATE requests SET status = 'failed', reason = 'stuck' WHERE id = 1").run();
    db.close();
    expect(() => mergeDatabases({ primary, secondary, out })).toThrow(/request 1 is processed in both/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses databases with different schema versions", () => {
    const db = new Database(secondary);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (2, 0)").run();
    db.close();
    expect(() => mergeDatabases({ primary, secondary, out })).toThrow(/schema version/);
  });
});
