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

const VERSION = /^v?\d+(\.\d+)*$/i;

/**
 * Provider model ids such as "Qwen/Qwen3.6-35B-A3B-FP8" are too long for a ballot label and were cut
 * off mid-word, so the label keeps the family and version and the full id stays in the tooltip.
 */
export function modelLabel(model: string): string {
  const [family = model, next] = (model.split("/").at(-1) ?? model).split("-");
  const label = next !== undefined && VERSION.test(next) ? `${family} ${next}` : family;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
