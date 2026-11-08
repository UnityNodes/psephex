import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Repository } from "../src/db.js";
import { Scanner } from "../src/scanner.js";
import { askedEvent, FakeBase, ManualClock } from "./fakes.js";

describe("Scanner", () => {
  let repo: Repository;
  let base: FakeBase;
  const errors: string[] = [];
  const log = { info: () => {}, warn: () => {}, error: (_o: object, m: string) => errors.push(m) };

  function scanner(range = 100n, confirmations = 2, startBlock = 50n): Scanner {
    return new Scanner({ repo, base, log, settings: { startBlock, confirmations, logBlockRange: range } });
  }

  beforeEach(() => {
    repo = openDatabase(":memory:", new ManualClock());
    base = new FakeBase();
    errors.length = 0;
  });

  afterEach(() => repo.close());

  it("starts at the start block and stops at the confirmed head", async () => {
    base.head = 120n;
    base.events = [askedEvent(1n, "a", 60n), askedEvent(2n, "b", 119n), askedEvent(3n, "c", 120n)];
    const result = await scanner().poll();
    expect(result).toEqual({ from: 50n, to: 119n, found: 2 });
    expect(repo.getCursor("base")).toBe(119n);
    expect(repo.getRequest(3)).toBeUndefined();
  });

  it("continues from the cursor in bounded ranges", async () => {
    base.head = 400n;
    const s = scanner(100n);
    expect(await s.poll()).toEqual({ from: 50n, to: 149n, found: 0 });
    expect(await s.poll()).toEqual({ from: 150n, to: 249n, found: 0 });
    expect(await s.catchUp()).toBe(2);
    expect(repo.getCursor("base")).toBe(399n);
    expect(await s.poll()).toBeNull();
  });

  it("stops catching up at the head it saw first even when new blocks keep coming", async () => {
    base.head = 300n;
    base.headStep = 1n;
    const rounds = await scanner(100n).catchUp();
    expect(rounds).toBeLessThanOrEqual(3);
    expect(repo.getCursor("base")).toBe(299n);
  });

  it("resumes from the stored cursor after a restart", async () => {
    base.head = 200n;
    await scanner().catchUp();
    base.head = 260n;
    base.events = [askedEvent(4n, "late", 255n)];
    await scanner().catchUp();
    expect(base.logCalls.at(-1)).toEqual([200n, 259n]);
    expect(repo.getRequest(4)?.question).toBe("late");
  });

  it("records an event whose hash does not match its question as rejected", async () => {
    base.head = 120n;
    base.events = [{ ...askedEvent(1n, "a", 60n), questionHash: `0x${"00".repeat(32)}` }];
    expect(await scanner().poll()).toEqual({ from: 50n, to: 119n, found: 0 });
    expect(repo.getRequest(1)).toMatchObject({ status: "rejected", reason: "question hash does not match the emitted question" });
    expect(errors[0]).toMatch(/hash/);
  });

  it("alerts when a known id comes back with another question", async () => {
    repo.recordAsked([askedEvent(1n, "original", 60n)], 59n);
    base.head = 120n;
    base.events = [askedEvent(1n, "replaced", 60n)];
    await scanner().poll();
    expect(repo.getRequest(1)?.question).toBe("original");
    expect(errors.some((e) => /reorg/.test(e))).toBe(true);
  });
});
