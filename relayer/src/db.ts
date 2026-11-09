import Database from "better-sqlite3";
import type { AskedEvent, Clock, ModelAnswerRow, ModelReply, ModelSignature, RequestRow, RequestStatus } from "./types.js";

export interface InvalidAsked {
  readonly event: AskedEvent;
  readonly reason: string;
}

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE cursor (chain TEXT PRIMARY KEY, last_block TEXT NOT NULL);
  CREATE TABLE requests (
    id INTEGER PRIMARY KEY,
    requester TEXT NOT NULL,
    origin TEXT,
    question TEXT NOT NULL,
    question_hash TEXT NOT NULL,
    paid_wei TEXT NOT NULL,
    asked_tx TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    retries INTEGER NOT NULL DEFAULT 0,
    answer TEXT,
    votes_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX requests_status ON requests(status);
  CREATE INDEX requests_origin ON requests(origin, created_at);
  CREATE TABLE model_answers (
    request_id INTEGER NOT NULL REFERENCES requests(id),
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    request_body TEXT NOT NULL,
    response_body TEXT,
    chat_id TEXT,
    signature_hex TEXT,
    signed_text TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    PRIMARY KEY (request_id, model)
  );
  CREATE TABLE near_txs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    tx_hash TEXT NOT NULL UNIQUE,
    nonce INTEGER NOT NULL,
    max_fee TEXT NOT NULL,
    max_priority_fee TEXT NOT NULL,
    signed_tx_b64 TEXT NOT NULL,
    ok INTEGER,
    unsigned_tx TEXT,
    signature_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE base_txs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    tx_hash TEXT NOT NULL UNIQUE,
    signed_tx TEXT NOT NULL,
    status TEXT NOT NULL,
    gas_used TEXT,
    events_json TEXT,
    sent_at INTEGER NOT NULL
  );
  CREATE TABLE budget (day TEXT PRIMARY KEY, model_calls INTEGER NOT NULL);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface RequestPatch {
  readonly status?: RequestStatus;
  readonly reason?: string | null;
  readonly retries?: number;
  readonly answer?: string | null;
  readonly votesJson?: string | null;
  readonly origin?: string | null;
}

export interface NewNearTx {
  readonly requestId: number;
  readonly txHash: string;
  readonly nonce: number;
  readonly maxFee: string;
  readonly maxPriorityFee: string;
  readonly signedTxBase64: string;
}

export interface NearTxRow extends NewNearTx {
  readonly ok: boolean | null;
  readonly unsignedTx: string | null;
  readonly signatureJson: string | null;
  readonly createdAt: number;
}

export interface NewBaseTx {
  readonly requestId: number;
  readonly txHash: string;
  readonly signedTx: string;
}

export interface BaseTxRow extends NewBaseTx {
  readonly status: string;
  readonly gasUsed: string | null;
  readonly eventsJson: string | null;
  readonly sentAt: number;
}

export interface RequestDbRow {
  id: number;
  requester: string;
  origin: string | null;
  question: string;
  question_hash: string;
  paid_wei: string;
  asked_tx: string;
  status: RequestStatus;
  reason: string | null;
  retries: number;
  answer: string | null;
  votes_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface ModelDbRow {
  request_id: number;
  model: string;
  provider: string;
  request_body: string;
  response_body: string | null;
  chat_id: string | null;
  signature_hex: string | null;
  signed_text: string | null;
  attempts: number;
  latency_ms: number | null;
}

export interface NearDbRow {
  request_id: number;
  tx_hash: string;
  nonce: number;
  max_fee: string;
  max_priority_fee: string;
  signed_tx_b64: string;
  ok: number | null;
  unsigned_tx: string | null;
  signature_json: string | null;
  created_at: number;
}

export interface BaseDbRow {
  request_id: number;
  tx_hash: string;
  signed_tx: string;
  status: string;
  gas_used: string | null;
  events_json: string | null;
  sent_at: number;
}

export const TERMINAL = "('confirmed','rejected','failed')";

const PATCH_COLUMNS: Readonly<Record<keyof RequestPatch, string>> = {
  status: "status",
  reason: "reason",
  retries: "retries",
  answer: "answer",
  votesJson: "votes_json",
  origin: "origin",
};

export function toRequest(r: RequestDbRow): RequestRow {
  return {
    id: r.id,
    requester: r.requester,
    origin: r.origin,
    question: r.question,
    questionHash: r.question_hash,
    paidWei: r.paid_wei,
    askedTx: r.asked_tx,
    status: r.status,
    reason: r.reason,
    retries: r.retries,
    answer: r.answer,
    votesJson: r.votes_json,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toModel(r: ModelDbRow): ModelAnswerRow {
  return {
    requestId: r.request_id,
    model: r.model,
    provider: r.provider,
    requestBody: r.request_body,
    responseBody: r.response_body,
    chatId: r.chat_id,
    signatureHex: r.signature_hex,
    signedText: r.signed_text,
    attempts: r.attempts,
    latencyMs: r.latency_ms,
  };
}

export function toNear(r: NearDbRow): NearTxRow {
  return {
    requestId: r.request_id,
    txHash: r.tx_hash,
    nonce: r.nonce,
    maxFee: r.max_fee,
    maxPriorityFee: r.max_priority_fee,
    signedTxBase64: r.signed_tx_b64,
    ok: r.ok === null ? null : r.ok === 1,
    unsignedTx: r.unsigned_tx,
    signatureJson: r.signature_json,
    createdAt: r.created_at,
  };
}

export function toBase(r: BaseDbRow): BaseTxRow {
  return {
    requestId: r.request_id,
    txHash: r.tx_hash,
    signedTx: r.signed_tx,
    status: r.status,
    gasUsed: r.gas_used,
    eventsJson: r.events_json,
    sentAt: r.sent_at,
  };
}

export class Repository {
  readonly #db: Database.Database;
  readonly #clock: Clock;

  constructor(db: Database.Database, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  close(): void {
    this.#db.close();
  }

  schemaVersion(): number {
    const row = this.#db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    return row.v ?? 0;
  }

  migrate(): void {
    this.#db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    const current = this.schemaVersion();
    MIGRATIONS.slice(current).forEach((sql, index) => {
      const version = current + index + 1;
      this.#db.transaction(() => {
        this.#db.exec(sql);
        this.#db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, this.#clock.now());
      })();
    });
  }

  getCursor(chain: string): bigint | null {
    const row = this.#db.prepare("SELECT last_block FROM cursor WHERE chain = ?").get(chain) as { last_block: string } | undefined;
    return row ? BigInt(row.last_block) : null;
  }

  recordAsked(events: readonly AskedEvent[], toBlock: bigint, invalid: readonly InvalidAsked[] = []): number[] {
    const insert = this.#db.prepare(
      `INSERT OR IGNORE INTO requests (id, requester, question, question_hash, paid_wei, asked_tx, status, reason, created_at, updated_at)
       VALUES (@id, @requester, @question, @questionHash, @paidWei, @askedTx, @status, @reason, @now, @now)`,
    );
    const existing = this.#db.prepare("SELECT question_hash FROM requests WHERE id = ?");
    const cursor = this.#db.prepare(
      "INSERT INTO cursor (chain, last_block) VALUES ('base', ?) ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block",
    );
    const now = this.#clock.now();
    const conflicts: number[] = [];
    const row = (e: AskedEvent, status: RequestStatus, reason: string | null) => ({
      id: Number(e.id),
      requester: e.requester,
      question: e.question,
      questionHash: e.questionHash,
      paidWei: e.paidWei.toString(),
      askedTx: e.txHash,
      status,
      reason,
      now,
    });
    this.#db.transaction(() => {
      for (const e of events) {
        const prior = existing.get(Number(e.id)) as { question_hash: string } | undefined;
        if (prior && prior.question_hash.toLowerCase() !== e.questionHash.toLowerCase()) conflicts.push(Number(e.id));
        insert.run(row(e, "seen", null));
      }
      for (const { event, reason } of invalid) insert.run(row(event, "rejected", reason));
      cursor.run(toBlock.toString());
    })();
    return conflicts;
  }

  countActiveBefore(id: number): number {
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE id < ? AND status NOT IN ${TERMINAL}`).get(id) as { n: number };
    return row.n;
  }

  countActive(): number {
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM requests WHERE status NOT IN ${TERMINAL}`).get() as { n: number };
    return row.n;
  }

  getRequest(id: number): RequestRow | undefined {
    const row = this.#db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestDbRow | undefined;
    return row ? toRequest(row) : undefined;
  }

  listActive(): RequestRow[] {
    const rows = this.#db.prepare(`SELECT * FROM requests WHERE status NOT IN ${TERMINAL} ORDER BY id`).all() as RequestDbRow[];
    return rows.map(toRequest);
  }

  updateRequest(id: number, patch: RequestPatch, expected?: RequestStatus): boolean {
    const keys = (Object.keys(patch) as (keyof RequestPatch)[]).filter((k) => patch[k] !== undefined);
    const sets = keys.map((k) => `${PATCH_COLUMNS[k]} = @${k}`);
    const params = Object.fromEntries(keys.map((k) => [k, patch[k]]));
    const guard = expected === undefined ? "" : " AND status = @expected";
    const result = this.#db
      .prepare(`UPDATE requests SET ${[...sets, "updated_at = @updatedAt"].join(", ")} WHERE id = @id${guard}`)
      .run({ ...params, updatedAt: this.#clock.now(), id, ...(expected === undefined ? {} : { expected }) });
    return result.changes === 1;
  }

  countOriginBefore(origin: string, id: number, sinceMs: number): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS n FROM requests WHERE origin = ? AND id < ? AND created_at >= ? AND status <> 'rejected'")
      .get(origin, id, sinceMs) as { n: number };
    return row.n;
  }

  beginModelAttempt(requestId: number, model: string, provider: string, requestBody: string): number {
    this.#db
      .prepare(
        `INSERT INTO model_answers (request_id, model, provider, request_body, attempts) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(request_id, model) DO UPDATE SET attempts = attempts + 1`,
      )
      .run(requestId, model, provider, requestBody);
    const row = this.#db.prepare("SELECT attempts FROM model_answers WHERE request_id = ? AND model = ?").get(requestId, model) as { attempts: number };
    return row.attempts;
  }

  releaseModelAttempt(requestId: number, model: string): void {
    this.#db.prepare("UPDATE model_answers SET attempts = attempts - 1 WHERE request_id = ? AND model = ? AND attempts > 0").run(requestId, model);
  }

  saveModelCompletion(requestId: number, model: string, reply: ModelReply): void {
    const result = this.#db
      .prepare("UPDATE model_answers SET response_body = ?, chat_id = ?, latency_ms = ? WHERE request_id = ? AND model = ? AND response_body IS NULL")
      .run(reply.responseBody, reply.chatId, reply.latencyMs, requestId, model);
    if (result.changes !== 1) throw new Error(`completion for request ${requestId} model ${model} is already stored`);
  }

  saveModelSignature(requestId: number, model: string, sig: ModelSignature): void {
    const row = this.#db.prepare("SELECT response_body, signature_hex FROM model_answers WHERE request_id = ? AND model = ?").get(requestId, model) as
      | { response_body: string | null; signature_hex: string | null }
      | undefined;
    if (!row?.response_body) throw new Error(`no completion stored for request ${requestId} model ${model}`);
    if (row.signature_hex) throw new Error(`signature for request ${requestId} model ${model} is already stored`);
    this.#db.prepare("UPDATE model_answers SET signature_hex = ?, signed_text = ? WHERE request_id = ? AND model = ?").run(sig.signatureHex, sig.text, requestId, model);
  }

  getModelAnswers(requestId: number): ModelAnswerRow[] {
    const rows = this.#db.prepare("SELECT * FROM model_answers WHERE request_id = ? ORDER BY model").all(requestId) as ModelDbRow[];
    return rows.map(toModel);
  }

  modelCallsOn(day: string): number {
    const row = this.#db.prepare("SELECT model_calls FROM budget WHERE day = ?").get(day) as { model_calls: number } | undefined;
    return row?.model_calls ?? 0;
  }

  addModelCalls(day: string, count: number): void {
    this.#db
      .prepare("INSERT INTO budget (day, model_calls) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET model_calls = model_calls + excluded.model_calls")
      .run(day, count);
  }

  saveNearTx(tx: NewNearTx): void {
    this.#db
      .prepare(
        `INSERT INTO near_txs (request_id, tx_hash, nonce, max_fee, max_priority_fee, signed_tx_b64, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(tx.requestId, tx.txHash, tx.nonce, tx.maxFee, tx.maxPriorityFee, tx.signedTxBase64, this.#clock.now());
  }

  latestNearTx(requestId: number): NearTxRow | undefined {
    const row = this.#db.prepare("SELECT * FROM near_txs WHERE request_id = ? ORDER BY id DESC LIMIT 1").get(requestId) as NearDbRow | undefined;
    return row ? toNear(row) : undefined;
  }

  markNearResult(txHash: string, ok: boolean, unsignedTx: string | null, signatureJson: string | null): void {
    this.#db.prepare("UPDATE near_txs SET ok = ?, unsigned_tx = ?, signature_json = ? WHERE tx_hash = ?").run(ok ? 1 : 0, unsignedTx, signatureJson, txHash);
  }

  saveBaseTx(tx: NewBaseTx): void {
    this.#db
      .prepare("INSERT OR IGNORE INTO base_txs (request_id, tx_hash, signed_tx, status, sent_at) VALUES (?, ?, ?, 'sent', ?)")
      .run(tx.requestId, tx.txHash, tx.signedTx, this.#clock.now());
  }

  latestBaseTx(requestId: number): BaseTxRow | undefined {
    const row = this.#db.prepare("SELECT * FROM base_txs WHERE request_id = ? ORDER BY id DESC LIMIT 1").get(requestId) as BaseDbRow | undefined;
    return row ? toBase(row) : undefined;
  }

  maxConfirmedNonce(): number | null {
    const row = this.#db
      .prepare(
        `SELECT MAX(n.nonce) AS nonce FROM near_txs n JOIN base_txs b ON b.request_id = n.request_id
         WHERE n.ok = 1 AND b.status IN ('success', 'reverted')`,
      )
      .get() as { nonce: number | null };
    return row.nonce;
  }

  markBaseReceipt(txHash: string, status: string, gasUsed: bigint, eventsJson: string): void {
    this.#db.prepare("UPDATE base_txs SET status = ?, gas_used = ?, events_json = ? WHERE tx_hash = ?").run(status, gasUsed.toString(), eventsJson, txHash);
  }
}

export function openDatabase(path: string, clock: Clock): Repository {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const repo = new Repository(db, clock);
  repo.migrate();
  return repo;
}
