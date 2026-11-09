import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Repository } from "../src/db.js";
import { Processor, type ProcessorSettings } from "../src/pipeline.js";
import { byProvider } from "../src/providers.js";
import { AIORACLE, askedEvent, CHAIN_ID, FakeBase, FakeModels, FakeNear, ManualClock, ORACLE_ADDRESS, silentLog } from "./fakes.js";

const SETTINGS: ProcessorSettings = {
  aiOracleAddress: AIORACLE,
  oracleEvmAddress: ORACLE_ADDRESS,
  baseChainId: CHAIN_ID,
  maxFeePerGas: 2_000_000_000n,
  dailyModelBudget: 100,
  perAddressHourlyLimit: 5,
  modelRetries: 3,
  mpcRetries: 3,
  receiptAlertMs: 120_000,
  confirmations: 2,
  maxQuestionBytes: 2000,
  stuckMs: 1_800_000,
  maxQueue: 50,
  evmGasLimit: 300_000n,
  feeBaseMultiplier: 4,
};

describe("Processor", () => {
  let repo: Repository;
  let near: FakeNear;
  let models: FakeModels;
  let phalaModels: FakeModels;
  let base: FakeBase;
  let clock: ManualClock;

  function processor(settings: Partial<ProcessorSettings> = {}): Processor {
    return new Processor({ repo, near, models: byProvider({ "near-ai": models, phala: phalaModels }), base, clock, log: silentLog, settings: { ...SETTINGS, ...settings } });
  }

  async function settle(p: Processor, id: number, rounds = 20): Promise<{ status: string; waiting: boolean }> {
    let result = await p.run(id);
    for (let i = 0; i < rounds && result.waiting; i++) {
      clock.t += 1_000;
      result = await p.run(id);
    }
    return result;
  }

  function seed(...ids: number[]): void {
    repo.recordAsked(ids.map((id) => askedEvent(BigInt(id))), 500n);
  }

  beforeEach(() => {
    clock = new ManualClock();
    repo = openDatabase(":memory:", clock);
    near = new FakeNear();
    models = new FakeModels();
    phalaModels = new FakeModels();
    base = new FakeBase();
  });

  afterEach(() => repo.close());

  it("takes a request from seen to confirmed, calling each model once", async () => {
    seed(1);
    let savedBeforeSend = false;
    near.onSend = (hash) => {
      savedBeforeSend = repo.latestNearTx(1)?.txHash === hash;
    };
    const result = await processor().run(1);
    expect(result).toEqual({ status: "confirmed", waiting: false });
    expect(models.calls.sort()).toEqual(["m-a", "m-b", "m-c"]);
    expect(savedBeforeSend).toBe(true);
    expect(base.sent).toHaveLength(1);
    const row = repo.getRequest(1);
    expect(row?.answer).toBe("YES");
    expect(row?.origin).toBe("0x00000000000000000000000000000000000000a1");
    expect(JSON.parse(row?.votesJson ?? "[]")).toEqual(near.consensus.votes);
    expect(repo.modelCallsOn("2026-11-08")).toBe(3);
    expect(repo.latestBaseTx(1)?.status).toBe("success");
    expect(near.verifyCalls[0]?.map((a) => a.model)).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("sends fees within both caps and the pending nonce", async () => {
    seed(1);
    base.nonce = 7;
    await processor().run(1);
    expect(near.signCalls[0]).toMatchObject({ request_id: 1, nonce: 7, max_fee_per_gas: "25000000", max_priority_fee_per_gas: "1000000" });
  });

  it("rejects when consensus fails, without a NEAR transaction", async () => {
    seed(1);
    near.consensus = { ok: false, answer: "", reason: "invalid signature for model m-b", required: 2, votes: [] };
    const result = await processor().run(1);
    expect(result.status).toBe("rejected");
    expect(repo.getRequest(1)?.reason).toBe("consensus: invalid signature for model m-b");
    expect(near.signCalls).toHaveLength(0);
  });

  it("rejects a question over the byte limit before calling models", async () => {
    repo.recordAsked([askedEvent(1n, "ї".repeat(1001))], 500n);
    const result = await processor().run(1);
    expect(result.status).toBe("rejected");
    expect(repo.getRequest(1)?.reason).toMatch(/2002 bytes/);
    expect(models.calls).toHaveLength(0);
  });

  it("rejects requests over the hourly limit of one origin", async () => {
    seed(1, 2, 3);
    const p = processor({ perAddressHourlyLimit: 2 });
    expect((await p.run(1)).status).toBe("confirmed");
    expect((await p.run(2)).status).toBe("confirmed");
    expect((await p.run(3)).status).toBe("rejected");
    expect(repo.getRequest(3)?.reason).toMatch(/rate limit/);
  });

  it("does not count requests older than an hour against the limit", async () => {
    seed(1);
    const p = processor({ perAddressHourlyLimit: 1 });
    await p.run(1);
    clock.t += 3_600_001;
    repo.recordAsked([askedEvent(2n)], 600n);
    expect((await p.run(2)).status).toBe("confirmed");
  });

  it("retries a silent model with the same body and then fails after the limit", async () => {
    seed(1, 2);
    models.plan.set("m-b", ["fail", "fail"]);
    expect((await settle(processor(), 1)).status).toBe("confirmed");
    expect(repo.getModelAnswers(1).find((a) => a.model === "m-b")?.attempts).toBe(3);
    models.plan.set("m-c", ["fail", "fail", "fail"]);
    expect((await settle(processor(), 2)).status).toBe("failed");
    expect(repo.getRequest(2)?.reason).toMatch(/m-c did not answer after 3 attempts/);
  });

  it("does not ask an answered model again after a restart", async () => {
    seed(1);
    const crashed = processor();
    expect(await crashed.advance(1)).toEqual({ status: "answering", waiting: false });
    expect(await crashed.advance(1)).toEqual({ status: "answering", waiting: false });
    expect(models.calls).toEqual(["m-a"]);
    expect((await processor().run(1)).status).toBe("confirmed");
    expect(models.calls).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("waits when the daily model budget is spent", async () => {
    seed(1);
    repo.addModelCalls("2026-11-08", 99);
    const result = await processor().run(1);
    expect(result).toEqual({ status: "answering", waiting: true });
    expect(models.calls).toEqual(["m-a"]);
  });

  it("waits when no models are registered", async () => {
    seed(1);
    near.modelList = [];
    expect(await processor().run(1)).toEqual({ status: "answering", waiting: true });
  });

  it("resumes a NEAR transaction from its saved hash after a crash", async () => {
    seed(1);
    near.sendPlan = ["network_error"];
    const first = await processor().run(1);
    expect(first).toEqual({ status: "near_sent", waiting: true });
    expect(near.signCalls).toHaveLength(1);
    expect((await processor().run(1)).status).toBe("confirmed");
    expect(near.signCalls).toHaveLength(1);
    expect(near.sendCalls).toEqual(["NEARTX1", "NEARTX1"]);
  });

  it("waits while the NEAR transaction is still pending", async () => {
    seed(1);
    near.sendPlan = ["pending"];
    expect(await processor().run(1)).toEqual({ status: "near_sent", waiting: true });
  });

  it("re-signs with a fresh nonce when MPC returns ok=false", async () => {
    seed(1);
    near.sendPlan = ["mpc_fail", "ok"];
    expect((await processor().run(1)).status).toBe("confirmed");
    expect(near.signCalls).toHaveLength(2);
    expect(repo.getRequest(1)?.retries).toBe(1);
  });

  it("fails after repeated MPC failures", async () => {
    seed(1);
    near.sendPlan = ["mpc_fail", "mpc_fail", "mpc_fail"];
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/MPC/);
  });

  it("fails when the NEAR contract panics", async () => {
    seed(1);
    near.sendPlan = ["panic"];
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/already fulfilled/);
  });

  it("fails when the MPC signature does not recover to the oracle address", async () => {
    seed(1);
    near.signingKey = generatePrivateKey();
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/recovered signer/);
    expect(base.sent).toHaveLength(0);
  });

  it("waits when the base fee is above the cap", async () => {
    seed(1);
    base.quote = { baseFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 0n };
    expect(await processor().run(1)).toEqual({ status: "verified", waiting: true });
    expect(near.signCalls).toHaveLength(0);
  });

  it("fails when NEAR already fulfilled the request without a local record", async () => {
    seed(1);
    near.fulfilled.add(1);
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/NEAR/);
  });

  it("rejects a request Base already fulfilled", async () => {
    seed(1);
    base.fulfilledOnBase.add(1n);
    expect((await processor().run(1)).status).toBe("rejected");
  });

  it("waits for confirmations and rebroadcasts the same bytes after a restart", async () => {
    seed(1);
    base.autoMine = false;
    expect(await processor().run(1)).toEqual({ status: "base_sent", waiting: true });
    const first = base.sent[0];
    base.sendError = "already known";
    expect(await processor().run(1)).toEqual({ status: "base_sent", waiting: true });
    expect(base.sent[1]).toBe(first);
    base.sendError = undefined;
    const hash = repo.latestBaseTx(1)?.txHash as `0x${string}`;
    base.mine(hash);
    base.receipts.set(hash, { ...base.receipts.get(hash)!, blockNumber: base.head });
    expect(await processor().run(1)).toEqual({ status: "base_sent", waiting: true });
    base.head += 1n;
    expect((await processor().run(1)).status).toBe("confirmed");
  });

  it("fails when the Base transaction reverts", async () => {
    seed(1);
    base.revert = true;
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/reverted/);
  });

  it("keeps the state and waits when a port throws", async () => {
    seed(1);
    base.txSender = async () => {
      throw new Error("rpc down");
    };
    expect(await processor().run(1)).toEqual({ status: "seen", waiting: true });
  });

  it("waits after a transient model error instead of retrying at once", async () => {
    seed(1);
    models.plan.set("m-a", ["transient"]);
    expect(await processor().run(1)).toEqual({ status: "answering", waiting: true });
    expect(models.calls).toEqual(["m-a"]);
    expect((await settle(processor(), 1)).status).toBe("confirmed");
  });

  it("does not count an auth error as an attempt", async () => {
    seed(1);
    models.plan.set("m-a", ["auth", "auth", "auth", "auth"]);
    const p = processor();
    for (let i = 0; i < 4; i++) expect(await p.run(1)).toEqual({ status: "answering", waiting: true });
    expect(repo.getModelAnswers(1).find((a) => a.model === "m-a")?.attempts).toBe(0);
    expect((await settle(p, 1)).status).toBe("confirmed");
  });

  it("fails at once on a permanent model error", async () => {
    seed(1);
    models.plan.set("m-a", ["permanent"]);
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/m-a/);
  });

  it("keeps a completion whose signature failed and only fetches the signature again", async () => {
    seed(1);
    models.signaturePlan.set("m-a", ["transient"]);
    expect(await processor().run(1)).toEqual({ status: "answering", waiting: true });
    expect(repo.getModelAnswers(1).find((a) => a.model === "m-a")?.responseBody).toContain("YES");
    expect((await settle(processor(), 1)).status).toBe("confirmed");
    expect(models.calls.filter((m) => m === "m-a")).toHaveLength(1);
    expect(models.signatureCalls.filter((m) => m === "m-a")).toHaveLength(2);
  });

  it("fails a request whose signature never arrives once it is stuck", async () => {
    seed(1);
    models.signaturePlan.set("m-a", Array(50).fill("transient"));
    expect(await processor().run(1)).toEqual({ status: "answering", waiting: true });
    clock.t += SETTINGS.stuckMs + 1;
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/stuck/);
    expect(models.calls.filter((m) => m === "m-a")).toHaveLength(1);
  });

  it("never reuses a nonce that already has a Base receipt when the RPC lags", async () => {
    seed(1, 2);
    const p = processor();
    expect((await p.run(1)).status).toBe("confirmed");
    base.staleNonce = 0;
    expect((await p.run(2)).status).toBe("confirmed");
    expect(near.signCalls.map((c) => c.nonce)).toEqual([0, 1]);
  });

  it("does not treat nonce too low as broadcast and fails once stuck", async () => {
    seed(1);
    base.autoMine = false;
    base.sendError = "nonce too low";
    expect(await processor().run(1)).toEqual({ status: "base_sent", waiting: true });
    clock.t += SETTINGS.stuckMs + 1;
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/stuck in base_sent/);
  });

  it("fails a NEAR transaction that stays pending past the stuck limit", async () => {
    seed(1);
    near.sendPlan = Array(5).fill("pending");
    expect(await processor().run(1)).toEqual({ status: "near_sent", waiting: true });
    clock.t += SETTINGS.stuckMs + 1;
    expect((await processor().run(1)).status).toBe("failed");
  });

  it("re-signs when NEAR rejects the stored transaction as invalid", async () => {
    seed(1);
    near.sendPlan = ["invalid", "ok"];
    expect((await processor().run(1)).status).toBe("confirmed");
    expect(near.signCalls).toHaveLength(2);
  });

  it("re-signs with new fees when the contract cap was lowered", async () => {
    seed(1);
    near.sendPlan = ["panic_cap", "ok"];
    expect((await processor().run(1)).status).toBe("confirmed");
    expect(near.signCalls).toHaveLength(2);
    expect(repo.getRequest(1)?.retries).toBe(1);
  });

  it("waits while NEAR reports signing in progress", async () => {
    seed(1);
    near.sendPlan = ["panic_progress"];
    expect(await processor().run(1)).toEqual({ status: "near_sent", waiting: true });
  });

  it("fails when the signed tx carries another answer than the consensus", async () => {
    seed(1);
    near.signedAnswer = "NO";
    expect((await processor().run(1)).status).toBe("failed");
    expect(repo.getRequest(1)?.reason).toMatch(/consensus answer/);
    expect(base.sent).toHaveLength(0);
  });

  it("rejects requests beyond the queue limit", async () => {
    seed(1, 2, 3);
    const p = processor({ maxQueue: 2 });
    expect((await p.advance(3)).status).toBe("rejected");
    expect(repo.getRequest(3)?.reason).toMatch(/queue full/);
    expect((await p.advance(2)).status).toBe("answering");
  });

  it("drains the queue in id order and stops at the first waiting request", async () => {
    seed(1, 2, 3);
    near.sendPlan = ["ok", "pending"];
    const summary = await processor().drain();
    expect(summary).toEqual({ processed: [1, 2], blockedOn: 2 });
    expect(repo.getRequest(3)?.status).toBe("seen");
  });

  it("reports nothing to do on an empty queue", async () => {
    expect(await processor().drain()).toEqual({ processed: [], blockedOn: null });
  });
  describe("model providers", () => {
    it("sends each model to the client of its provider", async () => {
      near.modelList = [
        { model: "m-a", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa" },
        { model: "m-b", provider: "near-ai", scheme: "nearai-v1", publicKey: "bb" },
        { model: "phala/m-c", provider: "phala", scheme: "nearai-v1", publicKey: "cc" },
      ];
      repo.recordAsked([askedEvent(1n)], 200n);
      await processor().run(1);
      expect(models.calls).toEqual(["m-a", "m-b"]);
      expect(phalaModels.calls).toEqual(["phala/m-c"]);
      expect(phalaModels.signatureCalls).toEqual(["phala/m-c"]);
    });

    it("waits with an alert when no client serves a provider", async () => {
      near.modelList = [
        { model: "m-a", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa" },
        { model: "m-b", provider: "near-ai", scheme: "nearai-v1", publicKey: "bb" },
        { model: "x/m-c", provider: "unknown-cloud", scheme: "nearai-v1", publicKey: "cc" },
      ];
      repo.recordAsked([askedEvent(1n)], 200n);
      const warnings: { obj: object; msg: string }[] = [];
      const log = { ...silentLog, warn: (obj: object, msg: string) => warnings.push({ obj, msg }) };
      const result = await new Processor({ repo, near, models: byProvider({ "near-ai": models }), base, clock, log, settings: SETTINGS }).run(1);
      expect(result).toMatchObject({ status: "answering", waiting: true });
      expect(warnings.at(-1)).toMatchObject({ msg: "no model client configured for provider unknown-cloud", obj: { model: "x/m-c", alert: true } });
    });
  });
});
