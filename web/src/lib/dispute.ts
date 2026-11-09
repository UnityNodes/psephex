export { displayText } from "./text.js";
import { BaseError, ContractFunctionRevertedError, formatEther, getAddress, isAddress, parseEther, UserRejectedRequestError, zeroAddress, type Address } from "viem";

export interface DisputeInput {
  readonly question: string;
  readonly counterparty: string;
  readonly stakeEth: string;
}

export interface DisputeLimits {
  readonly maxQuestionBytes: number;
  readonly minStakeWei: bigint;
}

export interface ValidDispute {
  readonly question: string;
  readonly counterparty: Address;
  readonly stakeWei: bigint;
}

export type DisputeErrors = Partial<Record<"question" | "counterparty" | "stake", string>>;

export type Validation = { readonly ok: true; readonly value: ValidDispute } | { readonly ok: false; readonly errors: DisputeErrors };

export interface Example {
  readonly label: string;
  readonly expected: "YES" | "NO" | "UNKNOWN";
  readonly question: string;
  readonly evidence: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    label: "Logo delivered as specified",
    expected: "YES",
    question: "Contract: deliver a logo as a PNG file of at least 512x512 pixels. Evidence: the claimant delivered logo.png, 1024x1024 pixels, PNG format. Was the contract fulfilled?",
    evidence: "All three models answered YES in 10 of 10 checks",
  },
  {
    label: "Translation late and short",
    expected: "NO",
    question: "Contract: deliver 10 translated pages by 2026-11-01. Evidence: the claimant delivered 6 pages on 2026-11-03. Was the contract fulfilled?",
    evidence: "All three models answered NO in 10 of 10 checks",
  },
  {
    label: "A matter of taste",
    expected: "UNKNOWN",
    question: "The task was: write a good logo. The claimant delivered a blue logo. The counterparty says it is ugly. Was the task completed?",
    evidence: "Two models answered UNKNOWN and one YES in 10 of 10 checks",
  },
];

const DECIMAL = /^\d+(\.\d{1,18})?$/;

const CONTRACT_ERRORS: Readonly<Record<string, string>> = {
  InsufficientFee: "The payment does not cover the oracle fee. Reload the page to read the current fee.",
  FeeAboveMax: "The oracle fee went up after the page loaded. Reload the page and try again.",
  StakeTooLow: "The stake is below the minimum the dispute contract accepts.",
  NoStake: "Add a stake on top of the oracle fee.",
  QuestionTooLong: "The question is longer than the contracts accept.",
  ZeroAddress: "Enter a real counterparty address.",
  TooEarly: "The refund opens after the dispute deadline; try again later.",
  AlreadySettled: "This dispute is already settled.",
  UnknownDispute: "There is no dispute with this number.",
};

export function questionBytes(question: string): number {
  return new TextEncoder().encode(question).length;
}

export function validateDispute(input: DisputeInput, limits: DisputeLimits, claimant: Address | undefined): Validation {
  const errors: DisputeErrors = {};
  const question = input.question.trim();
  const bytes = questionBytes(question);
  if (question.length === 0) errors.question = "Write the question the models should answer.";
  else if (bytes > limits.maxQuestionBytes) errors.question = `The question is ${bytes} bytes; the limit is ${limits.maxQuestionBytes}.`;

  const rawCounterparty = input.counterparty.trim();
  const counterpartyOk = isAddress(rawCounterparty) && getAddress(rawCounterparty) !== zeroAddress;
  if (!counterpartyOk) errors.counterparty = "Enter the counterparty's 0x address.";
  else if (claimant && getAddress(rawCounterparty) === getAddress(claimant)) errors.counterparty = "The counterparty must be someone other than you.";

  const rawStake = input.stakeEth.trim();
  const stakeWei = DECIMAL.test(rawStake) ? parseEther(rawStake) : null;
  if (stakeWei === null) errors.stake = "Enter the stake in ETH, for example 0.001.";
  else if (stakeWei < limits.minStakeWei) errors.stake = `The minimum stake is ${formatEther(limits.minStakeWei)} ETH.`;

  if (Object.keys(errors).length > 0 || stakeWei === null) return { ok: false, errors };
  return { ok: true, value: { question, counterparty: getAddress(rawCounterparty), stakeWei } };
}

export function describeTxError(err: unknown, chainName = "Base Sepolia"): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
    }
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return "You rejected the transaction in your wallet.";
  }
  const text = err instanceof Error ? err.message : "";
  if (/insufficient funds/i.test(text)) return `Not enough ${chainName} ETH for the stake, fee and gas. Get test ETH from a faucet and try again.`;
  return "The transaction failed. Check your wallet for details.";
}
