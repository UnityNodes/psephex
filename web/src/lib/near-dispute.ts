import { formatUnits, parseUnits } from "viem";

export const NEAR_DECIMALS = 24;
export const REFUND_GAS = 30_000_000_000_000n;

const DECIMAL = /^\d+(\.\d{1,24})?$/;

export function formatNear(yocto: bigint): string {
  return formatUnits(yocto, NEAR_DECIMALS);
}

const SHOWN_PLACES = 5;

/**
 * A stake left over after storage is charged can carry twenty digits of yocto, which reads as
 * noise in a sentence about a payout. Amounts the user signs stay exact; amounts shown after the
 * fact are rounded to five places and marked "about" when rounding changed them.
 */
export function roundedAmount(value: bigint, decimals: number, unit: string): string {
  const scale = 10n ** BigInt(decimals - SHOWN_PLACES);
  const rounded = ((value + scale / 2n) / scale) * scale;
  const text = `${formatUnits(rounded, decimals)} ${unit}`;
  return rounded === value ? text : `about ${text}`;
}

export function parseNear(text: string): bigint | null {
  const raw = text.trim();
  return DECIMAL.test(raw) ? parseUnits(raw, NEAR_DECIMALS) : null;
}

const CONTRACT_ERRORS: readonly (readonly [RegExp, string])[] = [
  [/stake too low/i, "The stake is below the minimum the dispute contract accepts."],
  [/attach a stake above/i, "The deposit does not cover the oracle deposit and storage. Reload the page to read the current amounts."],
  [/counterparty must differ/i, "The counterparty must be someone other than you."],
  [/question too long/i, "The question is longer than the contracts accept."],
  [/question must not be empty/i, "Write the question the models should answer."],
  [/too early/i, "The refund opens after the dispute deadline; try again later."],
  [/already settled/i, "This dispute is already settled."],
  [/unknown dispute/i, "There is no NEAR dispute with this number."],
  [/closed the window|user rejected|rejected/i, "You closed the wallet without signing."],
  [/not injected|not installed|extension/i, "This wallet's browser extension is not installed here. Install it, or pick another wallet."],
  [/popup window blocked/i, "The browser blocked the wallet window. Allow pop-ups for this site and try again."],
  [/not enough balance|NotEnoughBalance|LackBalanceForState/i, "Not enough testnet NEAR for the deposit and gas. Get test NEAR from a faucet and try again."],
];

export function describeNearError(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [pattern, message] of CONTRACT_ERRORS) if (pattern.test(text)) return message;
  return "The NEAR transaction failed. Check your wallet for details.";
}
