import { keccak256, stringToBytes } from "viem";
import { NEAR_CURSOR, type InvalidNearRequest, type Repository } from "./db.js";
import type { Log } from "./pipeline.js";
import type { PollResult } from "./scanner.js";
import type { NearRequestInfo, NearRequestsPort } from "./types.js";

const MAX_CATCH_UP_ROUNDS = 1000;

export interface NearScannerSettings {
  readonly chain: string;
  readonly startId: number;
  readonly pageSize: number;
}

export interface NearScannerDeps {
  readonly repo: Repository;
  readonly near: NearRequestsPort;
  readonly log: Log;
  readonly settings: NearScannerSettings;
}

export class NearScanner {
  readonly #d: NearScannerDeps;

  constructor(deps: NearScannerDeps) {
    this.#d = deps;
  }

  async head(): Promise<bigint> {
    return BigInt(await this.#d.near.lastNearRequestId());
  }

  scanned(): bigint {
    return this.#d.repo.getCursor(NEAR_CURSOR) ?? BigInt(this.#d.settings.startId - 1);
  }

  /**
   * Request ids on the NEAR contract are dense and never deleted, so the cursor is simply the
   * last id recorded. A page from another chain or out of order means the relayer points at the
   * wrong contract, which stops the scan instead of filling the database with foreign requests.
   */
  async poll(): Promise<PollResult | null> {
    const { repo, near, settings, log } = this.#d;
    const from = Number(this.scanned()) + 1;
    const page = await near.nearRequests(from, settings.pageSize);
    if (page.length === 0) return null;
    if (page[0]?.requestId !== from) throw new Error(`near_requests started at id ${page[0]?.requestId}, relayer expects ${from}`);
    let previous = from - 1;
    for (const r of page) {
      if (r.chain !== settings.chain) throw new Error(`near_requests returned chain ${r.chain}, relayer expects ${settings.chain}`);
      if (r.requestId <= previous) throw new Error(`near_requests returned id ${r.requestId} after ${previous}`);
      previous = r.requestId;
    }
    const checked = page.map((request) => ({ request, ok: this.#consistent(request) }));
    const requests = checked.filter((c) => c.ok).map((c) => c.request);
    const invalid: InvalidNearRequest[] = checked.filter((c) => !c.ok).map((c) => ({ request: c.request, reason: "question hash does not match the stored question" }));
    const conflicts = repo.recordNearRequests(requests, previous, invalid);
    if (conflicts.length > 0) log.error({ ids: conflicts, alert: true }, "NEAR request ids reappeared with another question; kept the stored question");
    if (requests.length > 0) log.info({ from, to: previous, ids: requests.map((r) => r.requestId) }, "new NEAR requests");
    return { from: BigInt(from), to: BigInt(previous), found: requests.length };
  }

  async catchUp(): Promise<number> {
    let rounds = 0;
    while (rounds < MAX_CATCH_UP_ROUNDS && (await this.poll()) !== null) rounds++;
    return rounds;
  }

  #consistent(r: NearRequestInfo): boolean {
    const ok = keccak256(stringToBytes(r.question)) === r.questionHash.toLowerCase();
    if (!ok) this.#d.log.error({ requestId: r.requestId, alert: true }, "NEAR request question hash mismatch, recorded as rejected");
    return ok;
  }
}
