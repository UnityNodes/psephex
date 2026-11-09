import { describe, expect, it } from "vitest";
import { cachedSource, createChainStatus, type ChainReader } from "../../src/api/chain.js";
import type { SourceName } from "../../src/sources.js";
import { MODELS } from "./fixture.js";

const ORACLE = "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F" as const;
const BASE_ONLY = { sources: [{ source: "base", kind: "evm", name: "Base Sepolia" }] as const, oracleEvmAddress: ORACLE, nearRelayerAccount: "relayer.psephex.testnet" };

class FakeReader implements ChainReader {
  calls = { head: 0, balance: 0, near: 0, models: 0, fee: 0 };
  heads: string[] = [];
  failBase = false;
  async head(source: SourceName): Promise<bigint> {
    this.calls.head++;
    this.heads.push(source);
    if (this.failBase && source === "base") throw new Error("fetch failed https://base.rpc.test/secret-key");
    return source === "near" ? 7n : 1_000n;
  }
  async evmBalance(): Promise<bigint> {
    this.calls.balance++;
    return 15n * 10n ** 15n;
  }
  async nearFee(): Promise<bigint> {
    this.calls.fee++;
    return 10n ** 22n;
  }
  async nearBalance(): Promise<bigint> {
    this.calls.near++;
    return 5n * 10n ** 24n;
  }
  async models() {
    this.calls.models++;
    return [...MODELS];
  }
}

describe("cachedSource", () => {
  it("serves a fresh value from cache and shares one call between concurrent readers", async () => {
    let t = 0;
    let calls = 0;
    const get = cachedSource({ load: async () => ++calls, ttlMs: 1_000, now: () => t, label: "thing" });
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toEqual({ ok: true, value: 1, at: 0, stale: false });
    expect(b).toEqual(a);
    t = 999;
    expect(await get()).toMatchObject({ value: 1 });
    t = 1_000;
    expect(await get()).toMatchObject({ value: 2, at: 1_000 });
    expect(calls).toBe(2);
  });

  it("does not cache a failure and falls back to the last good value marked stale", async () => {
    let t = 0;
    let fail = false;
    let calls = 0;
    const errors: unknown[] = [];
    const get = cachedSource({
      load: async () => {
        calls++;
        if (fail) throw new Error("timeout");
        return "v";
      },
      ttlMs: 10,
      now: () => t,
      label: "thing",
      onError: (err) => errors.push(err),
    });
    expect(await get()).toMatchObject({ ok: true, stale: false });
    fail = true;
    t = 20;
    expect(await get()).toEqual({ ok: true, value: "v", at: 0, stale: true });
    t = 21;
    await get();
    expect(calls).toBe(3);
    expect(errors).toHaveLength(2);
  });

  it("reports a generic error when nothing was ever loaded", async () => {
    const get = cachedSource({ load: async () => Promise.reject(new Error("https://rpc/secret")), ttlMs: 10, now: () => 0, label: "Base RPC" });
    expect(await get()).toEqual({ ok: false, error: "Base RPC unavailable" });
  });

  it("waits retryAfterMs after a failure before calling the RPC again", async () => {
    let t = 0;
    let calls = 0;
    const get = cachedSource({ load: async () => (calls++, Promise.reject(new Error("down"))), ttlMs: 10, now: () => t, label: "NEAR RPC", retryAfterMs: 3_000 });
    await get();
    t = 2_999;
    expect(await get()).toEqual({ ok: false, error: "NEAR RPC unavailable" });
    expect(calls).toBe(1);
    t = 3_000;
    await get();
    expect(calls).toBe(2);
  });
});

describe("createChainStatus", () => {
  it("reads Base head, oracle balance, relayer NEAR balance and models", async () => {
    const reader = new FakeReader();
    const chain = createChainStatus(reader, BASE_ONLY, 5_000, () => 0);
    const snap = await chain.snapshot();
    expect(snap.sources.base).toMatchObject({ ok: true, value: { head: 1_000n, oracleBalanceWei: 15n * 10n ** 15n } });
    expect(snap.near).toMatchObject({ ok: true, value: { relayerBalanceYocto: 5n * 10n ** 24n } });
    expect((await chain.models()).ok).toBe(true);
    expect(await chain.nearFee()).toMatchObject({ ok: true, value: 10n ** 22n });
    await chain.snapshot();
    expect(reader.calls).toEqual({ head: 1, balance: 1, near: 1, models: 1, fee: 1 });
  });

  it("reads every source and skips the oracle balance for NEAR", async () => {
    const reader = new FakeReader();
    const sources = [
      { source: "base", kind: "evm", name: "Base Sepolia" },
      { source: "arbitrum", kind: "evm", name: "Arbitrum Sepolia" },
      { source: "near", kind: "near", name: "NEAR testnet" },
    ] as const;
    const snap = await createChainStatus(reader, { ...BASE_ONLY, sources }, 5_000, () => 0).snapshot();
    expect(reader.heads.sort()).toEqual(["arbitrum", "base", "near"]);
    expect(reader.calls.balance).toBe(2);
    expect(snap.sources.near).toMatchObject({ ok: true, value: { head: 7n, oracleBalanceWei: null } });
    expect(snap.sources.arbitrum).toMatchObject({ ok: true, value: { head: 1_000n } });
  });

  it("keeps NEAR data when Base fails", async () => {
    const reader = new FakeReader();
    reader.failBase = true;
    const chain = createChainStatus(reader, BASE_ONLY, 5_000, () => 0);
    const snap = await chain.snapshot();
    expect(snap.sources.base).toEqual({ ok: false, error: "Base Sepolia RPC unavailable" });
    expect(snap.near.ok).toBe(true);
  });
});
