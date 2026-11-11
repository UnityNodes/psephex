import { z } from "zod";

const actionSchema = z.object({ kind: z.string() }).catchall(z.unknown());

const proposalSchema = z.object({
  id: z.number().int().nonnegative(),
  action: actionSchema,
  proposed_at_ns: z.string().regex(/^\d+$/),
  ready_at_ns: z.string().regex(/^\d+$/),
  expires_at_ns: z.string().regex(/^\d+$/),
  ready: z.boolean(),
  expired: z.boolean(),
});

export type OwnerAction = z.infer<typeof actionSchema>;
export type Proposal = z.infer<typeof proposalSchema>;

export interface OwnerChanges {
  readonly delaySeconds: number;
  readonly proposals: readonly Proposal[];
}

export type ProposalState = "waiting" | "ready" | "expired";

export interface ProposalTiming {
  readonly state: ProposalState;
  readonly at: Date;
}

const NANOS_PER_MS = 1_000_000n;

export function ownerChangesFrom(delay: unknown, proposals: unknown): OwnerChanges {
  const seconds = z.string().regex(/^\d+$/).parse(delay);
  return { delaySeconds: Number(seconds), proposals: z.array(proposalSchema).parse(proposals) };
}

function text(action: OwnerAction, key: string): string {
  const value = action[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "?";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatDelay(seconds: number): string {
  if (seconds % 86400 === 0 && seconds >= 3 * 86400) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  if (seconds % 60 === 0) return plural(seconds / 60, "minute");
  return plural(seconds, "second");
}

export function describeAction(action: OwnerAction): string {
  switch (action.kind) {
    case "set_model_key":
      return `Register model ${text(action, "model")} on ${text(action, "provider")} with ${text(action, "scheme")} key ${text(action, "public_key_hex")}`;
    case "remove_model_key":
      return `Remove model ${text(action, "model")}`;
    case "set_chain":
      return `Point chain ${text(action, "name")} (${text(action, "chain_id")}) at ${text(action, "oracle_address")}`;
    case "remove_chain":
      return `Stop answering chain ${text(action, "chain_id")}`;
    case "reset_fulfilled":
      return `Reopen request ${text(action, "request_id")} on ${text(action, "chain")}`;
    case "set_owner_delay": {
      const seconds = Number(text(action, "seconds"));
      return `Change the delay to ${Number.isFinite(seconds) ? formatDelay(seconds) : "?"}`;
    }
    case "set_max_fee_per_gas_cap":
      return `Set the gas price cap to ${text(action, "cap")} wei`;
    case "upgrade":
      return `Replace the oracle code with sha256 ${text(action, "code_sha256")}, then run migrate with ${text(action, "migrate_args")}`;
    default:
      return `Unrecognised change: ${action.kind}`;
  }
}

function nsToDate(ns: string): Date {
  return new Date(Number(BigInt(ns) / NANOS_PER_MS));
}

/**
 * The state comes from the contract's own `ready` and `expired`, read at the latest block, so a
 * visitor with a wrong clock is not told that a change can already apply. The local clock only
 * moves a proposal forward between polls.
 */
export function proposalTiming(p: Pick<Proposal, "ready" | "expired" | "ready_at_ns" | "expires_at_ns">, nowNs: bigint): ProposalTiming {
  if (p.expired || (p.ready && nowNs > BigInt(p.expires_at_ns))) return { state: "expired", at: nsToDate(p.expires_at_ns) };
  if (p.ready) return { state: "ready", at: nsToDate(p.expires_at_ns) };
  return { state: "waiting", at: nsToDate(p.ready_at_ns) };
}
