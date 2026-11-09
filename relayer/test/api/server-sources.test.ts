import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { ReadStore } from "../../src/api/store.js";
import type { SourceName } from "../../src/sources.js";
import { allSources, apiConfig, buildFixture, NEAR_FULFILL_TX, T0, type Fixture } from "./fixture.js";
import { FakeChain } from "./fake-chain.js";

interface Summary {
  readonly source: SourceName;
  readonly chain: string;
  readonly id: number;
}

describe("API v2 over three sources", () => {
  let fx: Fixture;
  let stores: Map<SourceName, ReadStore>;
  let chain: FakeChain;
  let app: FastifyInstance;
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  beforeEach(async () => {
    fx = buildFixture();
    stores = new Map([
      ["base", ReadStore.open(fx.path, "base")],
      ["arbitrum", ReadStore.open(fx.arbitrumPath, "arbitrum")],
      ["near", ReadStore.open(fx.nearPath, "near")],
    ]);
    chain = new FakeChain();
    app = await buildServer({ stores, chain, config: apiConfig(fx.path, { sources: allSources(fx) }), log, now: () => T0 + 3_600_000 });
  });

  afterEach(async () => {
    await app.close();
    for (const s of stores.values()) s.close();
    fx.cleanup();
  });

  const keys = (rows: readonly Summary[]) => rows.map((r) => `${r.source}/${r.id}`);

  it("merges all sources newest first and tags each record with source and chain", async () => {
    const res = await app.inject("/requests?limit=100");
    const data = res.json().data as Summary[];
    expect(keys(data)).toEqual(["near/2", "arbitrum/1", "near/1", "base/4", "base/3", "base/2", "base/1"]);
    expect(data[1]).toMatchObject({ source: "arbitrum", chain: "eip155:421614" });
    expect(data[0]).toMatchObject({ source: "near", chain: "near:testnet", requester: "alice.testnet" });
    expect(res.json().meta.nextCursor).toBeNull();
  });

  it("walks the merged list with an opaque cursor without repeats or gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await app.inject(`/requests?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.statusCode).toBe(200);
      seen.push(...keys(res.json().data as Summary[]));
      cursor = res.json().meta.nextCursor as string | null;
      if (cursor === null) break;
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(seen).toEqual(["near/2", "arbitrum/1", "near/1", "base/4", "base/3", "base/2", "base/1"]);
  });

  it("filters by source and status together", async () => {
    expect(keys((await app.inject("/requests?source=near")).json().data)).toEqual(["near/2", "near/1"]);
    expect(keys((await app.inject("/requests?source=base&status=confirmed")).json().data)).toEqual(["base/3", "base/1"]);
    expect(keys((await app.inject("/requests?status=confirmed")).json().data)).toEqual(["near/1", "base/3", "base/1"]);
    const first = await app.inject("/requests?source=base&limit=3");
    const next = await app.inject(`/requests?source=base&limit=3&cursor=${first.json().meta.nextCursor as string}`);
    expect(keys(next.json().data)).toEqual(["base/1"]);
  });

  it("serves records under /requests/:source/:id and keeps /requests/:id as the Base alias", async () => {
    const near = (await app.inject("/requests/near/1")).json().data;
    expect(near).toMatchObject({ source: "near", chain: "near:testnet", id: 1, question: "Is NEAR fast?", requester: "alice.testnet", baseTxs: [] });
    expect(near.nearTxs).toEqual([expect.objectContaining({ txHash: NEAR_FULFILL_TX, ok: true })]);
    const legacy = (await app.inject("/requests/1")).json().data;
    const explicit = (await app.inject("/requests/base/1")).json().data;
    expect(legacy).toEqual(explicit);
    expect(legacy).toMatchObject({ source: "base", question: "Is 7 prime?" });
    expect((await app.inject("/requests/arbitrum/1")).json().data).toMatchObject({ source: "arbitrum", question: "Arbitrum one?" });
    const missing = await app.inject("/requests/near/9");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe("request near/9 not found");
  });

  it("returns verify plans with the chain argument, also through the legacy alias", async () => {
    const near = (await app.inject("/requests/near/1/verify")).json().data;
    expect(near).toMatchObject({ source: "near", chain: "near:testnet", available: true, near: { method: "verify_consensus", args: { chain: "near:testnet", request_id: 1, question: "Is NEAR fast?" } } });
    const legacy = (await app.inject("/requests/1/verify")).json().data;
    expect(legacy.near.args.chain).toBe("eip155:84532");
    expect(legacy).toEqual((await app.inject("/requests/base/1/verify")).json().data);
    expect((await app.inject("/requests/arbitrum/1/verify")).json().data.near.args.chain).toBe("eip155:421614");
  });

  it("GET /chains lists every source with its contracts and the NEAR fee", async () => {
    const res = await app.inject("/chains");
    const data = res.json().data as { source: string; kind: string; nearFee?: string; aiOracle?: string }[];
    expect(data.map((c) => [c.source, c.kind])).toEqual([
      ["base", "evm"],
      ["arbitrum", "evm"],
      ["near", "near"],
    ]);
    expect(data[2]).toMatchObject({ nearFee: "10000000000000000000000", aiOracle: "oracle.psephex.testnet", dispute: "dispute.psephex.testnet" });
    expect(res.json().meta).toEqual({ checkedAt: new Date(T0).toISOString(), stale: false });
    chain.fee = { ok: false, error: "NEAR RPC unavailable" };
    expect((await app.inject("/chains")).json().data[2].nearFee).toBeNull();
  });

  it("GET /health reports each source and the combined queue and budget", async () => {
    chain.arbitrum = { ok: false, error: "Arbitrum Sepolia RPC unavailable" };
    const data = (await app.inject("/health")).json().data;
    expect(data.status).toBe("degraded");
    expect(data.errors).toEqual(["Arbitrum Sepolia RPC unavailable"]);
    expect(data.sources).toEqual([
      expect.objectContaining({ source: "base", scanned: "210", head: "300", lag: "90", oracleBalance: "15000000000000000" }),
      { source: "arbitrum", chain: "eip155:421614", name: "Arbitrum Sepolia", scanned: "900", head: null, lag: null, oracleAddress: expect.any(String), oracleBalance: null, stale: null, checkedAt: null },
      { source: "near", chain: "near:testnet", name: "NEAR testnet", scanned: "2", head: "3", lag: "1", stale: false, checkedAt: new Date(T0).toISOString() },
    ]);
    expect(data.base).toMatchObject({ source: "base", lagBlocks: "90" });
    expect(data.queue).toEqual({ active: 3, byStatus: { answering: 1, confirmed: 3, rejected: 1, seen: 2 } });
    expect(data.budget).toEqual({ day: "2026-11-08", modelCalls: 10, dailyLimit: 900, perSourceLimit: 300, bySource: { base: 7, arbitrum: 0, near: 3 } });
  });

  it("GET /stats adds per-source figures", async () => {
    const data = (await app.inject("/stats")).json().data;
    expect(data).toMatchObject({ total: 7, answers: { YES: 2, NO: 0, UNKNOWN: 1 }, avgSecondsSeenToConfirmed: 41 });
    expect(Object.keys(data.bySource)).toEqual(["base", "arbitrum", "near"]);
    expect(data.bySource.near).toMatchObject({ total: 2, answers: { YES: 1 }, avgSecondsSeenToConfirmed: 20 });
    expect(data.bySource.arbitrum).toMatchObject({ total: 1, avgSecondsSeenToConfirmed: null });
  });
});
