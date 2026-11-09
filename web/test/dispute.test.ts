import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { disputeAbi } from "../src/abi.js";
import { describeTxError, EXAMPLES, validateDispute } from "../src/lib/dispute.js";
import { CLAIMANT, COUNTERPARTY } from "./fixtures.js";

const LIMITS = { maxQuestionBytes: 2000, minStakeWei: parseEther("0.001") };

describe("validateDispute", () => {
  it("accepts a valid dispute and trims the question", () => {
    const r = validateDispute({ question: "  Was it delivered?  ", counterparty: COUNTERPARTY.toLowerCase(), stakeEth: "0.001" }, LIMITS, CLAIMANT);
    expect(r).toEqual({ ok: true, value: { question: "Was it delivered?", counterparty: COUNTERPARTY, stakeWei: parseEther("0.001") } });
  });

  it("counts the question limit in UTF-8 bytes, as the contracts do", () => {
    const r = validateDispute({ question: "ї".repeat(1001), counterparty: COUNTERPARTY, stakeEth: "0.001" }, LIMITS, CLAIMANT);
    expect(r).toMatchObject({ ok: false, errors: { question: "The question is 2002 bytes; the limit is 2000." } });
  });

  it("explains each invalid field", () => {
    const r = validateDispute({ question: " ", counterparty: "0x123", stakeEth: "0.0005" }, LIMITS, CLAIMANT);
    expect(r).toEqual({
      ok: false,
      errors: {
        question: "Write the question the models should answer.",
        counterparty: "Enter the counterparty's 0x address.",
        stake: "The minimum stake is 0.001 ETH.",
      },
    });
    expect(validateDispute({ question: "q", counterparty: CLAIMANT, stakeEth: "abc" }, LIMITS, CLAIMANT)).toMatchObject({
      errors: { counterparty: "The counterparty must be someone other than you.", stake: "Enter the stake in ETH, for example 0.001." },
    });
    expect(validateDispute({ question: "q", counterparty: "0x0000000000000000000000000000000000000000", stakeEth: "1" }, LIMITS, CLAIMANT)).toMatchObject({
      errors: { counterparty: "Enter the counterparty's 0x address." },
    });
  });
});

describe("describeTxError", () => {
  function reverted(errorName: "StakeTooLow" | "TooEarly", args: readonly bigint[]): BaseError {
    const data = encodeErrorResult({ abi: disputeAbi, errorName, args } as never);
    return new ContractFunctionRevertedError({ abi: disputeAbi, data, functionName: "openDispute" });
  }

  it("names contract errors in plain words", () => {
    expect(describeTxError(reverted("StakeTooLow", [1n, 2n]))).toBe("The stake is below the minimum the dispute contract accepts.");
    expect(describeTxError(reverted("TooEarly", [7n, 1_000n]))).toBe("The refund opens after the dispute deadline; try again later.");
  });

  it("recognises a rejected wallet prompt and missing funds", () => {
    expect(describeTxError(new UserRejectedRequestError(new Error("denied")))).toBe("You rejected the transaction in your wallet.");
    expect(describeTxError(new Error("insufficient funds for gas * price + value"))).toMatch(/Not enough Base Sepolia ETH/);
    expect(describeTxError("weird")).toBe("The transaction failed. Check your wallet for details.");
  });
});

describe("EXAMPLES", () => {
  it("covers the three answers with questions the models were checked on", () => {
    expect(EXAMPLES.map((e) => e.expected)).toEqual(["YES", "NO", "UNKNOWN"]);
    for (const e of EXAMPLES) expect(new TextEncoder().encode(e.question).length).toBeLessThanOrEqual(2000);
  });
});
