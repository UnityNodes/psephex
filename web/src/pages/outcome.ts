import type { RequestDetail } from "../api.js";
import { shortAccount } from "../components/NearAccount.js";
import { shortAddress } from "../components/Wallet.js";
import { roundedAmount } from "../lib/near-dispute.js";
import type { CaseInfo, Outcome } from "../lib/steps.js";
import { EXPLORER_NAME, SOURCE_SHORT, type Source } from "../sources.js";

function party(source: Source, who: string): string {
  return source === "near" ? shortAccount(who) : shortAddress(who);
}

export function outcomeText(outcome: Outcome, caseInfo: CaseInfo | null, detail: RequestDetail | null, now: bigint, source: Source = "base"): string {
  const stake = caseInfo ? (source === "near" ? roundedAmount(caseInfo.amount, 24, "NEAR") : roundedAmount(caseInfo.amount, 18, "ETH")) : "The stake";
  switch (outcome) {
    case "claimant":
      return `YES. ${stake} went back to the claimant ${caseInfo ? party(source, caseInfo.claimant) : ""}.`;
    case "counterparty":
      return `NO. ${stake} went to the counterparty ${caseInfo ? party(source, caseInfo.counterparty) : ""}.`;
    case "escalated":
      return `UNKNOWN. The models could not decide, so the claimant can take back ${stake} now.`;
    case "refunded":
      if (detail && (detail.status === "failed" || detail.status === "rejected")) return `The relayer stopped this dispute (${detail.reason ?? detail.status}), and the stake of ${stake} was refunded to the claimant.`;
      if (detail?.answer === "UNKNOWN") return `UNKNOWN, so the claimant took back ${stake}.`;
      return `${stake} went back to the claimant.`;
    case "settled":
      return `The dispute is settled on ${SOURCE_SHORT[source]}. The dispute contract on ${EXPLORER_NAME[source]} shows where the stake went.`;
    case "failed": {
      const wait = caseInfo && now < caseInfo.deadline ? ` The refund opens in about ${Math.ceil(Number(caseInfo.deadline - now) / 60)} min.` : " The refund is open.";
      return `The oracle stopped on this dispute: ${detail?.reason ?? "no reason recorded"}.${wait}`;
    }
    default:
      if (!caseInfo && detail?.answer && source === "near") return `${detail.answer}. The verdict is stored in the oracle contract on NEAR.`;
      return "Waiting for the answer. This page updates on its own.";
  }
}
