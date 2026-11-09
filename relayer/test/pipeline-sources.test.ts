import { parseTransaction, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Repository } from "../src/db.js";
import { Processor, type EvmSettings, type ProcessorSettings } from "../src/pipeline.js";
import { byProvider } from "../src/providers.js";
import { AIORACLE, ARBITRUM_CHAIN_ID, askedEvent, ASKER, FakeBase, FakeModels, FakeNear, ManualClock, NEAR_CHAIN, nearRequest, ORACLE_ADDRESS, silentLog } from "./fakes.js";

const COMMON: Omit<ProcessorSettings, "chain" | "chainLabel"> = {
  dailyModelBudget: 100,
  perAddressHourlyLimit: 5,
  modelRetries: 3,
  mpcRetries: 3,
  maxQuestionBytes: 2000,
  stuckMs: 1_800_000,
  maxQueue: 50,
};

describe("Processor for the NEAR source", () => {
  let repo: Repository;
  let near: FakeNear;
  let models: FakeModels;
  let clock: ManualClock;
  const alerts: string[] = [];
  const log = { ...silentLog, error: (_o: object, m: string) => alerts.push(m) };

  function processor(): Processor {
    return new Processor({ repo, near, models: byProvider({ "near-ai": models }), target: { kind: "near" }, clock, log, settings: { ...COMMON, chain: NEAR_CHAIN, chainLabel: "NEAR" } });
  }

  function seed(id: number): void {
    const r = nearRequest(id);
    near.requests.set(id, r);
    repo.recordNearRequests([r], id);
  }

  beforeEach(() => {
    clock = new ManualClock();
    repo = openDatabase(":memory:", clock);
    near = new FakeNear();
    models = new FakeModels();
    alerts.length = 0;
  });

  afterEach(() => repo.close());

  it("asks the models, sends fulfill_on_near and confirms from the stored verdict", async () => {
    seed(1);
    expect(await processor().run(1)).toEqual({ status: "confirmed", waiting: false });
    expect(models.calls.sort()).toEqual(["m-a", "m-b", "m-c"]);
    expect(near.nearSignCalls).toHaveLength(1);
    expect(near.nearSignCalls[0]).toEqual({ request_id: 1, answers: expect.any(Array) });
    expect(near.nearSignCalls[0]?.answers.map((a) => a.model)).toEqual(["m-a", "m-b", "m-c"]);
    expect(near.signCalls).toHaveLength(0);
    const row = repo.getRequest(1);
    expect(row).toMatchObject({ answer: "YES", origin: ASKER, requester: ASKER });
    expect(JSON.parse(row?.votesJson ?? "[]")).toEqual(near.consensus.votes);
    expect(repo.latestNearTx(1)).toMatchObject({ txHash: "NEARFULFILL1", ok: true, nonce: 0, maxFee: "0" });
    expect(repo.latestBaseTx(1)).toBeUndefined();
  });

  it("confirms when the asker's callback failed, since the verdict is stored either way", async () => {
    seed(1);
    near.sendPlan = ["callback_fail"];
    expect(await processor().run(1)).toEqual({ status: "confirmed", waiting: false });
    expect(JSON.parse(repo.latestNearTx(1)?.signatureJson ?? "{}")).toEqual({ ok: true, delivered: false });
  });

  it("treats request already fulfilled as done when near_request holds an answer", async () => {
    seed(1);
    near.sendPlan = ["rival"];
    near.signedAnswer = "NO";
    expect(await processor().run(1)).toEqual({ status: "confirmed", waiting: false });
    expect(repo.getRequest(1)?.answer).toBe("NO");
    expect(repo.latestNearTx(1)?.ok).toBe(false);
    expect(alerts).toContain("NEAR holds another answer than the local consensus");
  });

  it("fails request already fulfilled when near_request has no answer", async () => {
    seed(1);
    near.sendPlan = ["panic"];
    const result = await processor().run(1);
    expect(result).toEqual({ status: "failed", waiting: false });
    expect(repo.getRequest(1)?.reason).toMatch(/already fulfilled, but near_request\(1\) holds no answer/);
  });

  it("fails on another contract panic", async () => {
    seed(1);
    near.sendPlan = ["panic"];
    near.panicMessage = "Smart contract panicked: m-b: invalid signature";
    expect(await processor().run(1)).toEqual({ status: "failed", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("NEAR transaction failed: Smart contract panicked: m-b: invalid signature");
  });

  it("adopts the verdict without a transaction when NEAR answered before signing", async () => {
    seed(1);
    const p = processor();
    while ((await p.advance(1)).status !== "verified");
    near.requests.set(1, { ...nearRequest(1), answer: "UNKNOWN", votes: [] });
    near.fulfilled.add(1);
    expect(await p.run(1)).toEqual({ status: "confirmed", waiting: false });
    expect(near.nearSignCalls).toHaveLength(0);
    expect(repo.getRequest(1)?.answer).toBe("UNKNOWN");
  });

  it("records a request NEAR answered before the relayer saw it as already fulfilled", async () => {
    seed(1);
    near.fulfilled.add(1);
    expect(await processor().run(1)).toEqual({ status: "rejected", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("already fulfilled on NEAR");
    expect(models.calls).toHaveLength(0);
  });

  it("re-signs an expired NEAR transaction and resumes a pending one", async () => {
    seed(1);
    near.sendPlan = ["invalid", "pending", "ok"];
    const p = processor();
    expect(await p.run(1)).toMatchObject({ status: "near_sent", waiting: true });
    expect(near.nearSignCalls).toHaveLength(2);
    clock.t += 1_000;
    expect(await p.run(1)).toEqual({ status: "confirmed", waiting: false });
    expect(near.nearSignCalls).toHaveLength(2);
  });

  it("fails a NEAR request found in an EVM-only status", async () => {
    seed(1);
    repo.updateRequest(1, { status: "base_sent" });
    expect(await processor().run(1)).toEqual({ status: "failed", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("status base_sent does not exist for NEAR requests");
  });
});

describe("Processor for the Arbitrum source", () => {
  let repo: Repository;
  let near: FakeNear;
  let base: FakeBase;
  let clock: ManualClock;
  const chain = `eip155:${ARBITRUM_CHAIN_ID}`;
  const evm: EvmSettings = {
    aiOracleAddress: AIORACLE,
    oracleEvmAddress: ORACLE_ADDRESS,
    evmChainId: ARBITRUM_CHAIN_ID,
    maxFeePerGas: 2_000_000_000n,
    receiptAlertMs: 120_000,
    confirmations: 2,
    evmGasLimit: 300_000n,
    feeBaseMultiplier: 4,
  };

  function processor(evmChainId = ARBITRUM_CHAIN_ID): Processor {
    const target = { kind: "evm" as const, base, settings: { ...evm, evmChainId } };
    return new Processor({ repo, near, models: byProvider({ "near-ai": new FakeModels() }), target, clock, log: silentLog, settings: { ...COMMON, chain, chainLabel: "Arbitrum" } });
  }

  beforeEach(() => {
    clock = new ManualClock();
    repo = openDatabase(":memory:", clock);
    near = new FakeNear();
    near.chainId = ARBITRUM_CHAIN_ID;
    base = new FakeBase();
    repo.recordAsked([askedEvent(1n)], 500n, [], "arbitrum");
  });

  afterEach(() => repo.close());

  it("broadcasts a transaction signed for Arbitrum Sepolia", async () => {
    near.signedChain = chain;
    expect(await processor().run(1)).toEqual({ status: "confirmed", waiting: false });
    const sent = base.sent[0] as Hex;
    expect(parseTransaction(sent).chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(repo.getCursor("arbitrum")).toBe(500n);
  });

  it("refuses an MPC result for another chain", async () => {
    near.signedChain = "eip155:84532";
    expect(await processor().run(1)).toEqual({ status: "failed", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("NEAR signed for chain eip155:84532, relayer serves eip155:421614");
    expect(base.sent).toHaveLength(0);
  });

  it("refuses a transaction whose chain id is not the configured one", async () => {
    expect(await processor(84532).run(1)).toEqual({ status: "failed", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("tx chain 421614 is not 84532");
  });

  it("names Arbitrum when the request is already fulfilled there", async () => {
    base.fulfilledOnBase.add(1n);
    expect(await processor().run(1)).toEqual({ status: "rejected", waiting: false });
    expect(repo.getRequest(1)?.reason).toBe("already fulfilled on Arbitrum");
  });
});
