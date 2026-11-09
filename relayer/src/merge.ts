import Database from "better-sqlite3";
import { existsSync, rmSync } from "node:fs";
import { SCHEMA_VERSION } from "./db.js";
import { ALREADY_FULFILLED } from "./pipeline.js";

export interface MergeInput {
  readonly primary: string;
  readonly secondary: string;
  readonly out: string;
}

export interface MergeReport {
  readonly fromPrimary: readonly number[];
  readonly fromSecondary: readonly number[];
  readonly cursor: string;
  readonly requests: number;
}

type Row = Record<string, unknown>;

const CHILD_TABLES = ["model_answers", "near_txs", "base_txs"] as const;

function openReadOnly(path: string): Database.Database {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  if (row.v !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`${path} has schema version ${row.v ?? 0}, expected ${SCHEMA_VERSION}`);
  }
  return db;
}

function isStub(r: Row): boolean {
  return r.status === "rejected" && r.reason === ALREADY_FULFILLED;
}

function insert(db: Database.Database, table: string, row: Row): void {
  const columns = Object.keys(row).filter((c) => c !== "id" || table === "requests");
  db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`).run(
    Object.fromEntries(columns.map((c) => [c, row[c]])),
  );
}

function copyRequest(db: Database.Database, other: Database.Database, r: Row): void {
  insert(db, "requests", r);
  for (const table of CHILD_TABLES) {
    const rows = other.prepare(`SELECT * FROM ${table} WHERE request_id = ? ORDER BY rowid`).all(r.id) as Row[];
    for (const child of rows) insert(db, table, child);
  }
}

function dropRequest(db: Database.Database, id: unknown): void {
  for (const table of CHILD_TABLES) db.prepare(`DELETE FROM ${table} WHERE request_id = ?`).run(id);
  db.prepare("DELETE FROM requests WHERE id = ?").run(id);
}

function mergeRequests(db: Database.Database, other: Database.Database): number[] {
  const taken: number[] = [];
  for (const r of other.prepare("SELECT * FROM requests ORDER BY id").all() as Row[]) {
    const mine = db.prepare("SELECT * FROM requests WHERE id = ?").get(r.id) as Row | undefined;
    if (mine && String(mine.question_hash).toLowerCase() !== String(r.question_hash).toLowerCase()) {
      throw new Error(`request ${String(r.id)} has another question in the secondary database`);
    }
    if (mine && isStub(r)) continue;
    if (mine && !isStub(mine)) throw new Error(`request ${String(r.id)} is processed in both databases; refusing to pick one`);
    if (mine) dropRequest(db, r.id);
    copyRequest(db, other, r);
    taken.push(Number(r.id));
  }
  return taken;
}

function mergeCounters(db: Database.Database, other: Database.Database): void {
  const add = db.prepare("INSERT INTO budget (day, model_calls) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET model_calls = model_calls + excluded.model_calls");
  for (const b of other.prepare("SELECT day, model_calls FROM budget").all() as { day: string; model_calls: number }[]) add.run(b.day, b.model_calls);
  const theirs = other.prepare("SELECT last_block FROM cursor WHERE chain = 'base'").get() as { last_block: string } | undefined;
  const mine = db.prepare("SELECT last_block FROM cursor WHERE chain = 'base'").get() as { last_block: string } | undefined;
  if (theirs && (!mine || BigInt(theirs.last_block) > BigInt(mine.last_block))) {
    db.prepare("INSERT INTO cursor (chain, last_block) VALUES ('base', ?) ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block").run(theirs.last_block);
  }
}

/**
 * Every relayer run scans from START_BLOCK, so a later run records requests an earlier run already
 * answered as "already fulfilled on Base" stubs with no model answers or transactions. The merge
 * replaces such stubs with the full rows from the other run and refuses anything ambiguous: another
 * question under the same id, or a request processed in both runs.
 */
export function mergeDatabases({ primary, secondary, out }: MergeInput): MergeReport {
  if (existsSync(out)) throw new Error(`${out} already exists; refusing to overwrite it`);
  const base = openReadOnly(primary);
  const other = openReadOnly(secondary);
  try {
    base.prepare("VACUUM INTO ?").run(out);
    const db = new Database(out);
    try {
      const fromSecondary = db.transaction(() => {
        const taken = mergeRequests(db, other);
        mergeCounters(db, other);
        return taken;
      })();
      const ids = (db.prepare("SELECT id FROM requests ORDER BY id").all() as { id: number }[]).map((r) => r.id);
      const cursor = (db.prepare("SELECT last_block FROM cursor WHERE chain = 'base'").get() as { last_block: string } | undefined)?.last_block ?? "";
      return { fromPrimary: ids.filter((id) => !fromSecondary.includes(id)), fromSecondary, cursor, requests: ids.length };
    } finally {
      db.close();
    }
  } catch (err) {
    rmSync(out, { force: true });
    throw err;
  } finally {
    base.close();
    other.close();
  }
}
