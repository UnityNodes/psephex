import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NEAR_CURSOR, openDatabase, type Repository } from "../src/db.js";
import { NearScanner } from "../src/near-scanner.js";
import { ASKER, FakeNear, ManualClock, NEAR_CHAIN, nearRequest } from "./fakes.js";

describe("NearScanner", () => {
  let repo: Repository;
  let near: FakeNear;
  const errors: string[] = [];
  const log = { info: () => {}, warn: () => {}, error: (_o: object, m: string) => errors.push(m) };

  function scanner(pageSize = 2, startId = 1): NearScanner {
    return new NearScanner({ repo, near, log, settings: { chain: NEAR_CHAIN, startId, pageSize } });
  }

  beforeEach(() => {
    repo = openDatabase(":memory:", new ManualClock());
    near = new FakeNear();
    errors.length = 0;
  });

  afterEach(() => repo.close());

  it("records NEAR requests with the asker as requester and origin and the paid yocto", async () => {
    near.requests.set(1, nearRequest(1, "Is NEAR fast?"));
    expect(await scanner().poll()).toEqual({ from: 1n, to: 1n, found: 1 });
    expect(repo.getRequest(1)).toMatchObject({
      requester: ASKER,
      origin: ASKER,
      question: "Is NEAR fast?",
      questionHash: nearRequest(1, "Is NEAR fast?").questionHash,
      paidWei: "10000000000000000000000",
      askedTx: "",
      status: "seen",
    });
    expect(repo.getCursor(NEAR_CURSOR)).toBe(1n);
  });

  it("pages from the last recorded id until the contract has nothing newer", async () => {
    for (const id of [1, 2, 3, 4, 5]) near.requests.set(id, nearRequest(id));
    expect(await scanner(2).catchUp()).toBe(3);
    expect(near.pageCalls).toEqual([
      [1, 2],
      [3, 2],
      [5, 2],
      [6, 2],
    ]);
    expect(repo.listActive().map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    near.requests.set(6, nearRequest(6));
    await scanner(2).catchUp();
    expect(near.pageCalls.at(-2)).toEqual([6, 2]);
    expect(repo.getCursor(NEAR_CURSOR)).toBe(6n);
  });

  it("starts at NEAR_START_ID and reports scanned and head", async () => {
    for (const id of [1, 2, 3]) near.requests.set(id, nearRequest(id));
    const s = scanner(100, 3);
    expect(s.scanned()).toBe(2n);
    await s.catchUp();
    expect(repo.getRequest(2)).toBeUndefined();
    expect(repo.getRequest(3)?.status).toBe("seen");
    expect(s.scanned()).toBe(3n);
    expect(await s.head()).toBe(3n);
  });

  it("records a request whose hash does not match its question as rejected", async () => {
    near.requests.set(1, nearRequest(1, "q", { questionHash: `0x${"00".repeat(32)}` }));
    expect(await scanner().poll()).toEqual({ from: 1n, to: 1n, found: 0 });
    expect(repo.getRequest(1)).toMatchObject({ status: "rejected", reason: "question hash does not match the stored question" });
    expect(errors[0]).toMatch(/hash/);
  });

  it("stops on a page from another chain or out of order", async () => {
    near.requests.set(1, nearRequest(1, "q", { chain: "near:mainnet" }));
    await expect(scanner().poll()).rejects.toThrow(/near:mainnet/);
    expect(repo.getRequest(1)).toBeUndefined();
    near.requests.clear();
    near.nearRequests = async () => [nearRequest(2), nearRequest(1)];
    await expect(scanner().poll()).rejects.toThrow(/after 2/);
  });
});
