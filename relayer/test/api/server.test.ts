import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChainSnapshot, ChainStatus, Sample } from "../../src/api/chain.js";
import type { ApiConfig } from "../../src/api/config.js";
import { buildServer, rateLimitKey } from "../../src/api/server.js";
import { ReadStore } from "../../src/api/store.js";
import type { ModelInfo } from "../../src/types.js";
import { apiConfig, buildFixture, MODELS, T0, type Fixture } from "./fixture.js";

class FakeChain implements ChainStatus {
  base: ChainSnapshot["base"] = { ok: true, value: { head: 300n, oracleBalanceWei: 15n * 10n ** 15n }, at: T0, stale: false };
  near: ChainSnapshot["near"] = { ok: true, value: { relayerBalanceYocto: 4n * 10n ** 24n }, at: T0, stale: false };
  modelList: Sample<readonly ModelInfo[]> = { ok: true, value: MODELS, at: T0, stale: false };
  async snapshot(): Promise<ChainSnapshot> {
    return { base: this.base, near: this.near };
  }
  async models(): Promise<Sample<readonly ModelInfo[]>> {
    return this.modelList;
  }
}

describe("API server", () => {
  let fx: Fixture;
  let store: ReadStore;
  let chain: FakeChain;
  let app: FastifyInstance;
  const logged: string[] = [];
  const log = { info: () => {}, warn: () => {}, error: (o: object, m: string) => logged.push(`${m} ${JSON.stringify(o)}`) };

  async function start(overrides: Partial<ApiConfig> = {}): Promise<FastifyInstance> {
    app = await buildServer({ store, chain, config: apiConfig(fx.path, overrides), log, now: () => T0 + 3_600_000 });
    return app;
  }

  beforeEach(async () => {
    fx = buildFixture();
    store = ReadStore.open(fx.path);
    chain = new FakeChain();
    logged.length = 0;
    await start();
  });

  afterEach(async () => {
    await app.close();
    store.close();
    fx.cleanup();
  });

  it("GET /health reports queue, chain balances and budget", async () => {
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      status: "ok",
      queue: { active: 1, byStatus: { answering: 1, confirmed: 2, rejected: 1 } },
      base: { scannedBlock: "210", headBlock: "300", lagBlocks: "90", oracleAddress: apiConfig(fx.path).oracleEvmAddress, oracleBalanceWei: "15000000000000000", checkedAt: new Date(T0).toISOString(), stale: false },
      near: { contract: "oracle.psephex.testnet", relayerAccount: "relayer.psephex.testnet", relayerBalanceYocto: "4000000000000000000000000", checkedAt: new Date(T0).toISOString(), stale: false },
      budget: { day: "2026-11-08", modelCalls: 7, dailyLimit: 300 },
      errors: [],
    });
  });

  it("GET /health degrades instead of failing when an RPC is down", async () => {
    chain.base = { ok: false, error: "Base RPC unavailable" };
    const res = await app.inject("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: "degraded", base: { headBlock: null, oracleBalanceWei: null, scannedBlock: "210" }, errors: ["Base RPC unavailable"] });
  });

  it("GET /requests pages with a cursor and filters by status", async () => {
    const first = await app.inject("/requests?limit=2");
    expect(first.json().data.map((r: { id: number }) => r.id)).toEqual([4, 3]);
    expect(first.json().meta).toEqual({ limit: 2, nextCursor: 3 });
    const next = await app.inject("/requests?limit=2&cursor=3");
    expect(next.json().data.map((r: { id: number }) => r.id)).toEqual([2, 1]);
    const confirmed = await app.inject("/requests?status=confirmed");
    expect(confirmed.json().data.map((r: { id: number }) => r.id)).toEqual([3, 1]);
  });

  it("rejects bad query and path parameters with 400", async () => {
    for (const url of ["/requests?limit=0", "/requests?limit=101", "/requests?cursor=abc", "/requests?status=pwned", "/requests?other=1", "/requests/abc", "/requests/0", "/requests/1e3", "/requests/-1/verify"]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe("bad_request");
    }
  });

  it("GET /requests/:id returns the full record or 404", async () => {
    const res = await app.inject("/requests/1");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: 1, answer: "YES", status: "confirmed" });
    expect(res.json().data.models).toHaveLength(3);
    const missing = await app.inject("/requests/99");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: { code: "not_found", message: "request 99 not found" } });
  });

  it("GET /requests/:id/verify returns commands", async () => {
    const res = await app.inject("/requests/1/verify");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.available).toBe(true);
    expect(res.json().data.steps.length).toBeGreaterThanOrEqual(4);
    expect((await app.inject("/requests/99/verify")).statusCode).toBe(404);
  });

  it("GET /requests/:id/verify checks the answers against the current model set", async () => {
    chain.modelList = { ok: true, value: [MODELS[0]!, MODELS[1]!, { ...MODELS[2]!, model: "phala/new" }], at: T0, stale: false };
    const res = await app.inject("/requests/1/verify");
    expect(res.json().data).toMatchObject({ available: false, reason: expect.stringMatching(/earlier model set/) });
  });

  it("GET /models serves the registered models and 503 when NEAR never answered", async () => {
    expect((await app.inject("/models")).json().data).toHaveLength(3);
    chain.modelList = { ok: false, error: "NEAR RPC unavailable" };
    const res = await app.inject("/models");
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toEqual({ code: "unavailable", message: "NEAR RPC unavailable" });
  });

  it("GET /stats counts requests and answers", async () => {
    expect((await app.inject("/stats")).json().data).toEqual({
      total: 4,
      byStatus: { answering: 1, confirmed: 2, rejected: 1 },
      answers: { YES: 1, NO: 0, UNKNOWN: 1 },
      answerShare: { YES: 0.5, NO: 0, UNKNOWN: 0.5 },
      avgSecondsSeenToConfirmed: 51,
    });
  });

  it("allows CORS only for the dashboard origin", async () => {
    const allowed = await app.inject({ url: "/stats", headers: { origin: "https://app.psephex.test" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.psephex.test");
    expect(allowed.headers.vary).toMatch(/Origin/);
    const other = await app.inject({ url: "/stats", headers: { origin: "https://evil.test" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sends no CORS headers when no origin is configured", async () => {
    await app.close();
    await start({ corsOrigin: null });
    const res = await app.inject({ url: "/stats", headers: { origin: "https://app.psephex.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("is read-only", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      const res = await app.inject({ method, url: "/requests/1", payload: {} });
      expect(res.statusCode, method).toBe(404);
    }
  });

  it("sets defensive headers on every response", async () => {
    const res = await app.inject("/nope");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("rate limits per client", async () => {
    await app.close();
    await start({ rateLimitPerMinute: 2 });
    expect((await app.inject("/stats")).statusCode).toBe(200);
    expect((await app.inject("/stats")).statusCode).toBe(200);
    const limited = await app.inject("/stats");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
  });

  it("counts one IPv6 /64 as one client", async () => {
    await app.close();
    await start({ rateLimitPerMinute: 2 });
    expect((await app.inject({ url: "/stats", remoteAddress: "2001:db8:1:2::1" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/stats", remoteAddress: "2001:db8:1:2::ffff" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/stats", remoteAddress: "2001:db8:1:2:aaaa:bbbb:cccc:dddd" })).statusCode).toBe(429);
    expect((await app.inject({ url: "/stats", remoteAddress: "2001:db8:1:3::1" })).statusCode).toBe(200);
  });

  it("maps addresses to rate-limit keys", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
  });

  it("sets server timeouts against slow clients", () => {
    expect(app.initialConfig).toMatchObject({ connectionTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5_000 });
  });

  it("hides internal errors from clients and logs them scrubbed", async () => {
    store.close();
    const res = await app.inject("/requests/1");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "internal", message: "internal error" } });
    expect(logged.some((l) => /request failed/.test(l))).toBe(true);
    store = ReadStore.open(fx.path);
  });
});
