import type { FeeQuote } from "./types.js";

export interface FeeCaps {
  readonly configCap: bigint;
  readonly contractCap: bigint;
}

export interface Fees {
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export class FeeCapExceeded extends Error {
  override readonly name = "FeeCapExceeded";
}

export function computeFees(quote: FeeQuote, caps: FeeCaps, baseMultiplier = 2): Fees {
  const cap = caps.configCap < caps.contractCap ? caps.configCap : caps.contractCap;
  if (quote.baseFeePerGas > cap) {
    throw new FeeCapExceeded(`base fee ${quote.baseFeePerGas} wei is above the cap ${cap} wei`);
  }
  const wanted = quote.baseFeePerGas * BigInt(baseMultiplier) + quote.maxPriorityFeePerGas;
  const maxFeePerGas = wanted < cap ? wanted : cap;
  const maxPriorityFeePerGas = quote.maxPriorityFeePerGas < maxFeePerGas ? quote.maxPriorityFeePerGas : maxFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}
