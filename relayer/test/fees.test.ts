import { describe, expect, it } from "vitest";
import { computeFees, FeeCapExceeded } from "../src/fees.js";

const GWEI = 1_000_000_000n;

describe("computeFees", () => {
  it("uses baseFee * 2 + priority under the caps", () => {
    const fees = computeFees({ baseFeePerGas: 10_000_000n, maxPriorityFeePerGas: 1_000_000n }, { configCap: 2n * GWEI, contractCap: 2n * GWEI });
    expect(fees.maxFeePerGas).toBe(21_000_000n);
    expect(fees.maxPriorityFeePerGas).toBe(1_000_000n);
  });

  it("clamps max fee to the lower of config and contract caps", () => {
    const fees = computeFees({ baseFeePerGas: 1n * GWEI, maxPriorityFeePerGas: 1_000_000n }, { configCap: 3n * GWEI, contractCap: 1_500_000_000n });
    expect(fees.maxFeePerGas).toBe(1_500_000_000n);
  });

  it("clamps priority to max fee", () => {
    const fees = computeFees({ baseFeePerGas: 0n, maxPriorityFeePerGas: 5n * GWEI }, { configCap: 2n * GWEI, contractCap: 2n * GWEI });
    expect(fees.maxFeePerGas).toBe(2n * GWEI);
    expect(fees.maxPriorityFeePerGas).toBe(2n * GWEI);
  });

  it("applies a larger base fee multiplier for headroom", () => {
    const fees = computeFees({ baseFeePerGas: 10_000_000n, maxPriorityFeePerGas: 1_000_000n }, { configCap: 2n * GWEI, contractCap: 2n * GWEI }, 4);
    expect(fees.maxFeePerGas).toBe(41_000_000n);
  });

  it("refuses when the base fee alone is above the cap", () => {
    expect(() => computeFees({ baseFeePerGas: 3n * GWEI, maxPriorityFeePerGas: 0n }, { configCap: 2n * GWEI, contractCap: 2n * GWEI })).toThrow(FeeCapExceeded);
  });
});
