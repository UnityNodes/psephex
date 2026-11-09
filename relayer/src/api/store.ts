import Database from "better-sqlite3";
import {
  SCHEMA_VERSION,
  toBase,
  toModel,
  toNear,
  toRequest,
  type BaseDbRow,
  type BaseTxRow,
  type ModelDbRow,
  type NearDbRow,
  type NearTxRow,
  type RequestDbRow,
} from "../db.js";
import type { ModelAnswerRow, RequestRow, RequestStatus } from "../types.js";

export interface ListQuery {
  readonly limit: number;
  readonly before?: number;
  readonly status?: RequestStatus;
}

export interface RequestPage {
  readonly items: readonly RequestRow[];
  readonly nextCursor: number | null;
}

function counts(rows: readonly { key: string; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

export class ReadStore {
  readonly #db: Database.Database;

  private constructor(db: Database.Database) {
    this.#db = db;
  }

  /**
   * The relayer owns the schema and migrates it on start. The API opens the file read-only and
   * refuses any other schema version, so a newer layout is never misread as missing data.
   */
  static open(path: string): ReadStore {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 5000");
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    if (row.v !== SCHEMA_VERSION) {
      db.close();
      throw new Error(`relayer database has schema version ${row.v ?? 0}, the API reads version ${SCHEMA_VERSION}`);
    }
    return new ReadStore(db);
  }

  get readonly(): boolean {
    return this.#db.readonly;
  }

  close(): void {
    if (this.#db.open) this.#db.close();
  }

  listRequests(q: ListQuery): RequestPage {
    const where = [q.before === undefined ? null : "id < @before", q.status === undefined ? null : "status = @status"].filter((w) => w !== null);
    const sql = `SELECT * FROM requests ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT @take`;
    const rows = this.#db.prepare(sql).all({ before: q.before ?? null, status: q.status ?? null, take: q.limit + 1 }) as RequestDbRow[];
    const items = rows.slice(0, q.limit).map(toRequest);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > q.limit && last ? last.id : null };
  }

  request(id: number): RequestRow | undefined {
    const row = this.#db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestDbRow | undefined;
    return row ? toRequest(row) : undefined;
  }

  modelAnswers(id: number): ModelAnswerRow[] {
    return (this.#db.prepare("SELECT * FROM model_answers WHERE request_id = ? ORDER BY model").all(id) as ModelDbRow[]).map(toModel);
  }

  nearTxs(id: number): NearTxRow[] {
    return (this.#db.prepare("SELECT * FROM near_txs WHERE request_id = ? ORDER BY id").all(id) as NearDbRow[]).map(toNear);
  }

  baseTxs(id: number): BaseTxRow[] {
    return (this.#db.prepare("SELECT * FROM base_txs WHERE request_id = ? ORDER BY id").all(id) as BaseDbRow[]).map(toBase);
  }

  statusCounts(): Record<string, number> {
    return counts(this.#db.prepare("SELECT status AS key, COUNT(*) AS n FROM requests GROUP BY status ORDER BY status").all() as { key: string; n: number }[]);
  }

  answerCounts(): Record<string, number> {
    const sql = "SELECT answer AS key, COUNT(*) AS n FROM requests WHERE status = 'confirmed' AND answer IS NOT NULL GROUP BY answer ORDER BY answer";
    return counts(this.#db.prepare(sql).all() as { key: string; n: number }[]);
  }

  avgConfirmMs(): number | null {
    const row = this.#db.prepare("SELECT AVG(updated_at - created_at) AS ms FROM requests WHERE status = 'confirmed'").get() as { ms: number | null };
    return row.ms;
  }

  cursor(): bigint | null {
    const row = this.#db.prepare("SELECT last_block FROM cursor WHERE chain = 'base'").get() as { last_block: string } | undefined;
    return row ? BigInt(row.last_block) : null;
  }

  modelCallsOn(day: string): number {
    const row = this.#db.prepare("SELECT model_calls FROM budget WHERE day = ?").get(day) as { model_calls: number } | undefined;
    return row?.model_calls ?? 0;
  }
}
