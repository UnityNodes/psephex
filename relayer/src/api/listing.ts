import { isSourceName, sourceRank, type SourceName } from "../sources.js";
import type { RequestRow, RequestStatus } from "../types.js";
import type { ListBound, ReadStore } from "./store.js";

export interface SourceStore {
  readonly source: SourceName;
  readonly store: ReadStore;
}

export interface SourcedRow {
  readonly source: SourceName;
  readonly row: RequestRow;
}

export interface PageCursor {
  readonly createdAt: number;
  readonly source: SourceName;
  readonly id: number;
}

export interface MergedQuery {
  readonly limit: number;
  readonly status?: RequestStatus;
  readonly cursor?: PageCursor;
}

export interface MergedPage {
  readonly items: readonly SourcedRow[];
  readonly nextCursor: string | null;
}

const NOTHING_BELOW = 0;

export function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.source, c.id]), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): PageCursor | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [createdAt, source, id] = value as unknown[];
  if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) return null;
  if (typeof source !== "string" || !isSourceName(source)) return null;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  return { createdAt, source, id };
}

/**
 * Sources are merged in one order, newest first by (createdAt, source rank, id). For a store
 * the cursor is turned into an exclusive (created_at, id) bound: a source ranked below the
 * cursor's source still owes its rows from the cursor's millisecond, one ranked above does not.
 */
function boundFor(source: SourceName, c: PageCursor): ListBound {
  const rank = sourceRank(source);
  const cursorRank = sourceRank(c.source);
  if (rank === cursorRank) return { createdAt: c.createdAt, id: c.id };
  return { createdAt: c.createdAt, id: rank < cursorRank ? Number.MAX_SAFE_INTEGER : NOTHING_BELOW };
}

function newerFirst(a: SourcedRow, b: SourcedRow): number {
  return b.row.createdAt - a.row.createdAt || sourceRank(b.source) - sourceRank(a.source) || b.row.id - a.row.id;
}

export function listMerged(stores: readonly SourceStore[], q: MergedQuery): MergedPage {
  const take = q.limit + 1;
  const rows = stores.flatMap(({ source, store }) =>
    store
      .listRequests({ limit: take, ...(q.status === undefined ? {} : { status: q.status }), ...(q.cursor === undefined ? {} : { before: boundFor(source, q.cursor) }) })
      .map((row) => ({ source, row })),
  );
  const sorted = [...rows].sort(newerFirst);
  const items = sorted.slice(0, q.limit);
  const last = items.at(-1);
  const more = sorted.length > q.limit && last !== undefined;
  return { items, nextCursor: more ? encodeCursor({ createdAt: last.row.createdAt, source: last.source, id: last.row.id }) : null };
}
