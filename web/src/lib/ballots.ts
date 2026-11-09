import type { Answer, RequestDetail } from "../api.js";

export interface Ballot {
  readonly model: string;
  readonly vote: Answer | null;
  readonly signed: boolean;
}

export function ballots(detail: RequestDetail): Ballot[] {
  const votes = new Map((detail.votes ?? []).map((v) => [v.model, v.answer]));
  return detail.models.map((m) => ({ model: m.model, vote: m.signatureHex !== null ? (votes.get(m.model) ?? null) : null, signed: m.signatureHex !== null }));
}
