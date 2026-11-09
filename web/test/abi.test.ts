import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toEventSelector, toFunctionSelector, type AbiEvent, type AbiFunction } from "viem";
import { describe, expect, it } from "vitest";
import { aiOracleAbi, disputeAbi } from "../src/abi.js";
import { DISPUTE_TOPICS } from "./topics.js";

const abiMd = readFileSync(resolve(process.cwd(), "../contracts/base/ABI.md"), "utf8");

function documentedSelector(signature: string): string | undefined {
  const row = abiMd.split("\n").find((line) => line.startsWith(`| ${signature} |`));
  return row?.split("|")[2]?.trim();
}

describe("generated ABI", () => {
  it("matches the selectors documented for the deployed v2 contracts", () => {
    const used = [
      [disputeAbi, "openDispute"],
      [disputeAbi, "getCase"],
      [disputeAbi, "refund"],
      [disputeAbi, "minStake"],
      [disputeAbi, "timeout"],
      [aiOracleAbi, "fee"],
      [aiOracleAbi, "maxQuestionBytes"],
    ] as const;
    for (const [abi, name] of used) {
      const fn = (abi as readonly { type: string; name?: string }[]).find((i) => i.type === "function" && i.name === name) as AbiFunction;
      const signature = `${name}(${fn.inputs.map((i) => i.type).join(",")})`;
      expect(toFunctionSelector(fn), signature).toBe(documentedSelector(signature));
    }
  });

  it("matches the documented Dispute event topics", () => {
    for (const [name, topic] of Object.entries(DISPUTE_TOPICS)) {
      const ev = disputeAbi.find((i) => i.type === "event" && i.name === name) as AbiEvent;
      expect(toEventSelector(ev), name).toBe(topic);
    }
  });
});
