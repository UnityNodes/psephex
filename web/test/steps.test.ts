import { encodeAbiParameters, encodeEventTopics, keccak256, stringToBytes, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { disputeAbi } from "../src/abi.js";
import { DISPUTE_ADDRESS } from "../src/deployment.js";
import { detailPollInterval } from "../src/hooks.js";
import { requestDetailSchema, type RequestDetail } from "../src/api.js";
import { ballots, canRefund, deriveProgress, questionMatchesChain, settlementWinner, type CaseInfo } from "../src/lib/steps.js";
import { CLAIMANT, COUNTERPARTY, dataOf } from "./fixtures.js";

const detail = (id: number): RequestDetail => requestDetailSchema.parse(dataOf(`request-${id}.json`));
const openCase = (over: Partial<CaseInfo> = {}): CaseInfo => ({ claimant: CLAIMANT, counterparty: COUNTERPARTY, amount: 10n ** 15n, deadline: 2_000n, escalated: false, settled: false, ...over });

describe("deriveProgress", () => {
  it("marks every step done for a confirmed NO and pays the counterparty", () => {
    const p = deriveProgress({ detail: detail(7), caseInfo: openCase({ settled: true }), winner: COUNTERPARTY.toLowerCase() });
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(p.outcome).toBe("counterparty");
    expect(deriveProgress({ detail: detail(4), caseInfo: openCase({ settled: true }), winner: CLAIMANT }).outcome).toBe("claimant");
  });

  it("shows UNKNOWN as escalated until the claimant takes the refund", () => {
    expect(deriveProgress({ detail: detail(3), caseInfo: openCase({ escalated: true }) }).outcome).toBe("escalated");
    expect(deriveProgress({ detail: detail(3), caseInfo: openCase({ escalated: true, settled: true }) }).outcome).toBe("refunded");
  });

  it("waits for the relayer when Base has the case but the API does not", () => {
    const p = deriveProgress({ detail: null, caseInfo: openCase() });
    expect(p.steps.map((s) => s.state)).toEqual(["done", "active", "waiting", "waiting", "waiting"]);
    expect(p.steps[1]?.detail).toMatch(/relayer/);
    expect(p.outcome).toBe("pending");
  });

  it("puts the failure on the step that stopped and offers the refund path", () => {
    const p = deriveProgress({ detail: detail(5), caseInfo: openCase() });
    expect(p.steps.map((s) => s.state)).toEqual(["done", "failed", "waiting", "waiting", "waiting"]);
    expect(p.steps[1]?.detail).toMatch(/model signature not available/);
    expect(p.outcome).toBe("failed");
  });

  it("reports a rejected request on the first step after Base", () => {
    const p = deriveProgress({ detail: detail(6), caseInfo: openCase() });
    expect(p.steps[1]).toMatchObject({ state: "failed", detail: expect.stringMatching(/rate limit/) });
  });

  it("counts signed model answers while they arrive", () => {
    const d = detail(7);
    const partial: RequestDetail = { ...d, status: "answering", answer: null, votes: null, near: [], base: [], models: d.models.map((m, i) => (i === 0 ? m : { ...m, signatureHex: null })) };
    const p = deriveProgress({ detail: partial, caseInfo: openCase() });
    expect(p.steps[1]).toMatchObject({ state: "active", detail: "1 of 3 signed answers" });
  });

  it("does not name a winner the chain has not shown, whatever the API says", () => {
    expect(deriveProgress({ detail: detail(7), caseInfo: openCase({ settled: true }) }).outcome).toBe("settled");
    expect(deriveProgress({ detail: detail(7), caseInfo: openCase({ settled: true }), winner: "0x000000000000000000000000000000000000dEaD" }).outcome).toBe("settled");
  });

  it("is pending with nothing known", () => {
    expect(deriveProgress({ detail: null, caseInfo: null }).steps.map((s) => s.state)).toEqual(["active", "waiting", "waiting", "waiting", "waiting"]);
  });
});

describe("ballots", () => {
  it("pairs each model with its vote and signature", () => {
    expect(ballots(detail(7))).toEqual([
      { model: "Qwen/Qwen3.6-35B-A3B-FP8", vote: "NO", signed: true },
      { model: "Qwen/Qwen3.8-27B", vote: "NO", signed: true },
      { model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", vote: "NO", signed: true },
    ]);
    expect(ballots(detail(5)).find((b) => b.model === "Qwen/Qwen3.6-35B-A3B-FP8")).toEqual({ model: "Qwen/Qwen3.6-35B-A3B-FP8", vote: null, signed: false });
  });
});

describe("canRefund", () => {
  it("opens after escalation or after the deadline, never once settled", () => {
    expect(canRefund(openCase({ escalated: true }), 0n)).toBe(true);
    expect(canRefund(openCase(), 1_999n)).toBe(false);
    expect(canRefund(openCase(), 2_000n)).toBe(true);
    expect(canRefund(openCase({ settled: true, escalated: true }), 9_999n)).toBe(false);
    expect(canRefund(null, 9_999n)).toBe(false);
  });
});

describe("chain checks", () => {
  function settledLog(id: bigint, winner: string, address: string = DISPUTE_ADDRESS): Log {
    return {
      address: address as `0x${string}`,
      topics: encodeEventTopics({ abi: disputeAbi, eventName: "Settled", args: { id, winner: winner as `0x${string}` } }) as [`0x${string}`, ...`0x${string}`[]],
      data: encodeAbiParameters([{ type: "uint256" }], [10n ** 15n]),
      blockHash: null,
      blockNumber: null,
      logIndex: null,
      transactionHash: null,
      transactionIndex: null,
      removed: false,
    };
  }

  it("reads the winner only from a Settled event of our Dispute contract for this id", () => {
    expect(settlementWinner([settledLog(7n, COUNTERPARTY)], 7)?.toLowerCase()).toBe(COUNTERPARTY.toLowerCase());
    expect(settlementWinner([settledLog(8n, COUNTERPARTY)], 7)).toBeNull();
    expect(settlementWinner([settledLog(7n, COUNTERPARTY, "0x000000000000000000000000000000000000dEaD")], 7)).toBeNull();
  });

  it("checks the question text against the hash stored on Base", () => {
    const q = "Was it delivered?";
    expect(questionMatchesChain(q, keccak256(stringToBytes(q)))).toBe(true);
    expect(questionMatchesChain(`${q} `, keccak256(stringToBytes(q)))).toBe(false);
    expect(questionMatchesChain(q, `0x${"00".repeat(32)}`)).toBeNull();
    expect(questionMatchesChain(q, undefined)).toBeNull();
  });
});

describe("detailPollInterval", () => {
  it("keeps polling until the API itself reports a final status", () => {
    const d = detail(7);
    expect(detailPollInterval(undefined)).toBe(3_000);
    expect(detailPollInterval(null)).toBe(3_000);
    expect(detailPollInterval({ ...d, status: "base_sent" })).toBe(3_000);
    expect(detailPollInterval(d)).toBe(false);
    expect(detailPollInterval(detail(5))).toBe(false);
    expect(detailPollInterval(detail(6))).toBe(false);
  });
});
