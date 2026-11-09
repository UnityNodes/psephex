import type { RequestStatus } from "../api.js";
import { SOURCE_SHORT, type Source } from "../sources.js";

export function statusLabel(status: RequestStatus, source: Source): string {
  const chain = SOURCE_SHORT[source];
  switch (status) {
    case "seen":
      return "Seen by the relayer";
    case "answering":
      return "Models answering";
    case "verified":
      return "Checked on NEAR";
    case "near_sent":
      return source === "near" ? "Storing on NEAR" : "Signing on NEAR";
    case "near_signed":
      return "Signed by MPC";
    case "base_sent":
      return `Sending to ${chain}`;
    case "confirmed":
      return `Answered on ${chain}`;
    case "rejected":
      return "Rejected";
    case "failed":
      return "Stopped";
  }
}
