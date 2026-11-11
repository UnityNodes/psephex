import { describe, expect, it } from "vitest";
import { describeAction, formatDelay, ownerChangesFrom, proposalTiming } from "../src/lib/owner.js";

const HOUR_NS = 3_600_000_000_000n;

describe("owner changes", () => {
  it("describes every kind of announced change in words", () => {
    expect(describeAction({ kind: "set_model_key", model: "google/gemma-4", provider: "phala", scheme: "ecdsa", public_key_hex: "ab" })).toBe("Register model google/gemma-4 on phala with ecdsa key ab");
    expect(describeAction({ kind: "remove_model_key", model: "Qwen/Qwen3.8-27B" })).toBe("Remove model Qwen/Qwen3.8-27B");
    expect(describeAction({ kind: "set_chain", chain_id: 421614, name: "Arbitrum Sepolia", oracle_address: "0x792b" })).toBe("Point chain Arbitrum Sepolia (421614) at 0x792b");
    expect(describeAction({ kind: "remove_chain", chain_id: 84532 })).toBe("Stop answering chain 84532");
    expect(describeAction({ kind: "reset_fulfilled", chain: "eip155:84532", request_id: 7 })).toBe("Reopen request 7 on eip155:84532");
    expect(describeAction({ kind: "set_owner_delay", seconds: 172800 })).toBe("Change the delay to 48 hours");
    expect(describeAction({ kind: "set_max_fee_per_gas_cap", cap: "5000000000" })).toBe("Set the gas price cap to 5000000000 wei");
    expect(describeAction({ kind: "upgrade", code_sha256: "0f390e19dabc15810397fa4500588dc10a975716e33fcba3261c48560e8ba4ee", migrate_args: "{}" })).toBe(
      "Replace the oracle code with sha256 0f390e19dabc15810397fa4500588dc10a975716e33fcba3261c48560e8ba4ee, then run migrate with {}",
    );
  });

  it("names an action kind it does not know instead of hiding it", () => {
    expect(describeAction({ kind: "something_new" })).toBe("Unrecognised change: something_new");
  });

  it("formats the delay in hours or days", () => {
    expect(formatDelay(86400)).toBe("24 hours");
    expect(formatDelay(60)).toBe("1 minute");
    expect(formatDelay(3 * 86400)).toBe("3 days");
  });

  it("takes the state from the contract, not from the visitor's clock", () => {
    const p = { ready_at_ns: (10n * HOUR_NS).toString(), expires_at_ns: (20n * HOUR_NS).toString() };
    expect(proposalTiming({ ...p, ready: false, expired: false }, 50n * HOUR_NS)).toEqual({ state: "waiting", at: new Date(36_000_000) });
    expect(proposalTiming({ ...p, ready: true, expired: false }, 1n)).toEqual({ state: "ready", at: new Date(72_000_000) });
    expect(proposalTiming({ ...p, ready: true, expired: true }, 1n)).toEqual({ state: "expired", at: new Date(72_000_000) });
    expect(proposalTiming({ ...p, ready: true, expired: false }, 21n * HOUR_NS)).toEqual({ state: "expired", at: new Date(72_000_000) });
  });

  it("parses the contract views and rejects a shape it cannot read", () => {
    const parsed = ownerChangesFrom("86400", [
      { id: 3, action: { kind: "remove_chain", chain_id: 84532 }, proposed_at_ns: "1", ready_at_ns: "2", expires_at_ns: "3", ready: false, expired: false },
    ]);
    expect(parsed.delaySeconds).toBe(86400);
    expect(parsed.proposals[0]?.id).toBe(3);
    expect(() => ownerChangesFrom("soon", [])).toThrow();
    expect(() => ownerChangesFrom("86400", [{ id: 1 }])).toThrow();
  });
});
