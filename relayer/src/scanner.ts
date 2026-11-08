import { keccak256, stringToBytes } from "viem";
import type { Repository } from "./db.js";
import type { Log } from "./pipeline.js";
import type { AskedEvent, BaseChainPort } from "./types.js";

const MAX_CATCH_UP_ROUNDS = 1000;

export interface ScannerSettings {
  readonly startBlock: bigint;
  readonly confirmations: number;
  readonly logBlockRange: bigint;
}

export interface ScannerDeps {
  readonly repo: Repository;
  readonly base: BaseChainPort;
  readonly log: Log;
  readonly settings: ScannerSettings;
}

export interface PollResult {
  readonly from: bigint;
  readonly to: bigint;
  readonly found: number;
}

export class Scanner {
  readonly #d: ScannerDeps;

  constructor(deps: ScannerDeps) {
    this.#d = deps;
  }

  async #safeHead(): Promise<bigint> {
    return (await this.#d.base.headBlock()) - BigInt(this.#d.settings.confirmations - 1);
  }

  async poll(target?: bigint): Promise<PollResult | null> {
    const { repo, base, settings } = this.#d;
    const safeHead = target ?? (await this.#safeHead());
    const cursor = repo.getCursor("base");
    const from = cursor === null ? settings.startBlock : cursor + 1n;
    if (from > safeHead) return null;
    const rangeEnd = from + settings.logBlockRange - 1n;
    const to = rangeEnd < safeHead ? rangeEnd : safeHead;
    const all = await base.askedEvents(from, to);
    const checked = all.map((event) => ({ event, ok: this.#consistent(event) }));
    const events = checked.filter((c) => c.ok).map((c) => c.event);
    const invalid = checked.filter((c) => !c.ok).map((c) => ({ event: c.event, reason: "question hash does not match the emitted question" }));
    const conflicts = repo.recordAsked(events, to, invalid);
    if (conflicts.length > 0) this.#d.log.error({ ids: conflicts, alert: true }, "request ids reappeared with another question; possible reorg, kept the stored question");
    if (events.length > 0) this.#d.log.info({ from, to, ids: events.map((e) => e.id.toString()) }, "new requests");
    return { from, to, found: events.length };
  }

  /**
   * Base Sepolia produces a block every 200 ms, faster than one getLogs round trip, so
   * polling up to the live head never ends. Catch-up stops at the safe head seen at the start.
   */
  async catchUp(): Promise<number> {
    const target = await this.#safeHead();
    let rounds = 0;
    while (rounds < MAX_CATCH_UP_ROUNDS && (await this.poll(target)) !== null) rounds++;
    return rounds;
  }

  #consistent(e: AskedEvent): boolean {
    const ok = keccak256(stringToBytes(e.question)) === e.questionHash;
    if (!ok) this.#d.log.error({ requestId: e.id.toString(), txHash: e.txHash, alert: true }, "Asked event question hash mismatch, recorded as rejected");
    return ok;
  }
}
