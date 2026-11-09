import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadStore } from "../../src/api/store.js";
import { openDatabase } from "../../src/db.js";
import { askedEvent, ManualClock } from "../fakes.js";
import { BASE_TX, buildFixture, NEAR_TX, type Fixture } from "./fixture.js";

describe("ReadStore", () => {
  let fx: Fixture;
  let store: ReadStore;

  beforeEach(() => {
    fx = buildFixture();
    store = ReadStore.open(fx.path);
  });

  afterEach(() => {
    store.close();
    fx.cleanup();
  });

  it("pages requests newest first below an exclusive (createdAt, id) bound", () => {
    expect(store.listRequests({ limit: 3 }).map((r) => r.id)).toEqual([4, 3, 2]);
    const t = store.request(2)?.createdAt ?? 0;
    expect(store.listRequests({ limit: 3, before: { createdAt: t, id: 2 } }).map((r) => r.id)).toEqual([1]);
    expect(store.listRequests({ limit: 3, before: { createdAt: t, id: Number.MAX_SAFE_INTEGER } }).map((r) => r.id)).toEqual([4, 3, 2]);
    expect(store.listRequests({ limit: 3, before: { createdAt: t, id: 0 } })).toEqual([]);
  });

  it("filters by status", () => {
    expect(store.listRequests({ limit: 10, status: "confirmed" }).map((r) => r.id)).toEqual([3, 1]);
  });

  it("refuses a database tagged with another source cursor", () => {
    expect(() => ReadStore.open(fx.nearPath)).toThrow(/cursor of near, not base/);
    const near = ReadStore.open(fx.nearPath, "near");
    expect(near.cursor()).toBe(2n);
    near.close();
  });

  it("returns everything stored for one request", () => {
    expect(store.request(1)?.status).toBe("confirmed");
    expect(store.request(99)).toBeUndefined();
    expect(store.modelAnswers(1)).toHaveLength(3);
    expect(store.nearTxs(1).map((t) => [t.txHash, t.ok])).toEqual([[NEAR_TX, true]]);
    expect(store.baseTxs(1).map((t) => [t.txHash, t.status, t.gasUsed])).toEqual([[BASE_TX, "success", "79561"]]);
    expect(store.nearTxs(2)).toEqual([]);
  });

  it("counts statuses, answers and time to confirm", () => {
    expect(store.statusCounts()).toEqual({ answering: 1, confirmed: 2, rejected: 1 });
    expect(store.answerCounts()).toEqual({ UNKNOWN: 1, YES: 1 });
    expect(store.avgConfirmMs()).toBe(51_000);
    expect(store.cursor()).toBe(210n);
    expect(store.modelCallsOn("2026-11-08")).toBe(7);
    expect(store.modelCallsOn("2026-11-09")).toBe(0);
  });

  it("sees rows the relayer commits while both are open", () => {
    const writer = openDatabase(fx.path, new ManualClock());
    writer.recordAsked([askedEvent(5n, "new one?")], 300n);
    expect(store.request(5)?.question).toBe("new one?");
    expect(store.cursor()).toBe(300n);
    writer.close();
  });

  it("opens the relayer database read-only", () => {
    expect(store.readonly).toBe(true);
  });

  it("refuses a database with another schema version", () => {
    const other = buildFixture();
    const db = new Database(other.path);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (99, 0)").run();
    db.close();
    expect(() => ReadStore.open(other.path)).toThrow(/schema version 99/);
    other.cleanup();
  });

  it("refuses a missing database instead of creating one", () => {
    expect(() => ReadStore.open(`${fx.path}.missing`)).toThrow();
  });
});
