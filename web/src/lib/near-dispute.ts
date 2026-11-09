import { formatUnits, parseUnits } from "viem";
import { isNearAccount } from "../deployment.js";
import { questionBytes } from "./dispute.js";

export const NEAR_DECIMALS = 24;
export const OPEN_DISPUTE_GAS = 100_000_000_000_000n;
export const REFUND_GAS = 30_000_000_000_000n;
export const MAX_QUESTION_BYTES = 2000;

const DECIMAL = /^\d+(\.\d{1,24})?$/;

export interface NearDisputeConfig {
  readonly minStake: bigint;
  readonly timeoutSec: number;
}

export interface NearDeposit {
  readonly stake: bigint;
  readonly askDeposit: bigint;
  readonly storageDeposit: bigint;
}

export interface NearDisputeInput {
  readonly question: string;
  readonly counterparty: string;
  readonly stakeNear: string;
}

export interface ValidNearDispute {
  readonly question: string;
  readonly counterparty: string;
  readonly stake: bigint;
}

export type NearDisputeErrors = Partial<Record<"question" | "counterparty" | "stake", string>>;
export type NearValidation = { readonly ok: true; readonly value: ValidNearDispute } | { readonly ok: false; readonly errors: NearDisputeErrors };

export function formatNear(yocto: bigint): string {
  return formatUnits(yocto, NEAR_DECIMALS);
}

export function parseNear(text: string): bigint | null {
  const raw = text.trim();
  return DECIMAL.test(raw) ? parseUnits(raw, NEAR_DECIMALS) : null;
}

/**
 * The dispute contract keeps everything above the oracle deposit and the storage of the case as
 * the stake, so the wallet must attach all three. A smaller deposit fails on chain after the user
 * has already signed.
 */
export function nearDepositTotal(d: NearDeposit): bigint {
  return d.stake + d.askDeposit + d.storageDeposit;
}

export function validateNearDispute(input: NearDisputeInput, config: NearDisputeConfig, claimant: string | null): NearValidation {
  const errors: NearDisputeErrors = {};
  const question = input.question.trim();
  const bytes = questionBytes(question);
  if (question.length === 0) errors.question = "Write the question the models should answer.";
  else if (bytes > MAX_QUESTION_BYTES) errors.question = `The question is ${bytes} bytes; the limit is ${MAX_QUESTION_BYTES}.`;

  const counterparty = input.counterparty.trim().toLowerCase();
  if (!isNearAccount(counterparty)) errors.counterparty = "Enter the counterparty's NEAR account, for example bob.testnet.";
  else if (claimant !== null && counterparty === claimant) errors.counterparty = "The counterparty must be someone other than you.";

  const stake = parseNear(input.stakeNear);
  if (stake === null) errors.stake = "Enter the stake in NEAR, for example 0.1.";
  else if (stake < config.minStake) errors.stake = `The minimum stake is ${formatNear(config.minStake)} NEAR.`;

  if (Object.keys(errors).length > 0 || stake === null) return { ok: false, errors };
  return { ok: true, value: { question, counterparty, stake } };
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

export function requestIdFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
