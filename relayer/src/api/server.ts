import { isIP } from "node:net";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Log } from "../pipeline.js";
import { SOURCE_NAMES, type SourceName } from "../sources.js";
import { REQUEST_STATUSES, TERMINAL_STATUSES, type RequestStatus } from "../types.js";
import type { ChainStatus, Sample } from "./chain.js";
import type { ApiConfig, ApiSource } from "./config.js";
import { decodeCursor, listMerged, type SourceStore } from "./listing.js";
import type { ReadStore } from "./store.js";
import { chainsView, modelsView, requestDetail, requestSummary, verifyPlan, type RequestBundle } from "./views.js";

export interface ApiDeps {
  readonly stores: ReadonlyMap<SourceName, ReadStore>;
  readonly chain: ChainStatus;
  readonly config: ApiConfig;
  readonly log: Log;
  readonly now: () => number;
}

const ID_PATTERN = "^[1-9][0-9]{0,14}$";
const LIMIT_PATTERN = "^([1-9]|[1-9][0-9]|100)$";
const CURSOR_PATTERN = "^[A-Za-z0-9_-]{1,200}$";
const LEGACY_SOURCE: SourceName = "base";
const DEFAULT_LIMIT = 20;
const BODY_LIMIT_BYTES = 1024;
const CONNECTION_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const IPV6_GROUPS = 8;
const IPV6_PREFIX_GROUPS = 4;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const ANSWERS = ["YES", "NO", "UNKNOWN"] as const;
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const idParams = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", pattern: ID_PATTERN } },
} as const;

const sourceIdParams = {
  type: "object",
  required: ["source", "id"],
  additionalProperties: false,
  properties: { source: { type: "string", enum: SOURCE_NAMES }, id: { type: "string", pattern: ID_PATTERN } },
} as const;

const listQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: LIMIT_PATTERN },
    cursor: { type: "string", pattern: CURSOR_PATTERN },
    status: { type: "string", enum: REQUEST_STATUSES },
    source: { type: "string", enum: SOURCE_NAMES },
  },
} as const;

interface ListQueryString {
  readonly limit?: string;
  readonly cursor?: string;
  readonly status?: RequestStatus;
  readonly source?: SourceName;
}

type ByStatus = Record<string, number>;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One IPv6 customer usually holds a whole /64, so keying the limit on the full address would
 * give a single client 2^64 separate budgets. IPv6 clients are counted per /64 instead.
 */
export function rateLimitKey(ip: string): string {
  const mapped = IPV4_MAPPED.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(IPV6_GROUPS - left.length - right.length).fill("0"), ...right] : ip.split(":");
  return `${groups.slice(0, IPV6_PREFIX_GROUPS).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

function iso(sample: Sample<unknown>): string | null {
  return sample.ok ? new Date(sample.at).toISOString() : null;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

interface Served {
  readonly source: ApiSource;
  readonly store: ReadStore;
}

function served(deps: ApiDeps): Served[] {
  return deps.config.sources.flatMap((source) => {
    const store = deps.stores.get(source.source);
    return store ? [{ source, store }] : [];
  });
}

function find(deps: ApiDeps, name: SourceName): Served {
  const hit = served(deps).find((s) => s.source.source === name);
  if (!hit) throw new HttpError(404, "not_found", `source ${name} is not served`);
  return hit;
}

function bundle({ store, source }: Served, id: number): RequestBundle {
  const request = store.request(id);
  if (!request) throw new HttpError(404, "not_found", source.source === LEGACY_SOURCE ? `request ${id} not found` : `request ${source.source}/${id} not found`);
  return { request, answers: store.modelAnswers(id), nearTxs: store.nearTxs(id), baseTxs: store.baseTxs(id) };
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function addCounts(into: ByStatus, from: ByStatus): ByStatus {
  return Object.fromEntries([...new Set([...Object.keys(into), ...Object.keys(from)])].sort().map((k) => [k, (into[k] ?? 0) + (from[k] ?? 0)]));
}

function activeCount(byStatus: ByStatus): number {
  return Object.entries(byStatus)
    .filter(([status]) => !TERMINAL_STATUSES.includes(status as RequestStatus))
    .reduce((sum, [, n]) => sum + n, 0);
}

function sourceHealth(src: ApiSource, store: ReadStore, sample: Sample<{ head: bigint; oracleBalanceWei: bigint | null }> | undefined, oracleAddress: string | null) {
  const scanned = store.cursor();
  const head = sample?.ok ? sample.value.head : null;
  const evm = src.kind === "evm" ? { oracleAddress, oracleBalance: sample?.ok && sample.value.oracleBalanceWei !== null ? sample.value.oracleBalanceWei.toString() : null } : {};
  return {
    source: src.source,
    chain: src.chain,
    name: src.name,
    scanned: scanned?.toString() ?? null,
    head: head?.toString() ?? null,
    lag: head !== null && scanned !== null ? (head - scanned).toString() : null,
    ...evm,
    stale: sample?.ok ? sample.stale : null,
    checkedAt: sample ? iso(sample) : null,
  };
}

async function health(deps: ApiDeps) {
  const { chain, config, now } = deps;
  const snap = await chain.snapshot();
  const list = served(deps);
  const byStatus = list.reduce<ByStatus>((acc, s) => addCounts(acc, s.store.statusCounts()), {});
  const sources = list.map((s) => sourceHealth(s.source, s.store, snap.sources[s.source.source], config.oracleEvmAddress));
  const base = sources.find((s) => s.source === LEGACY_SOURCE);
  const day = new Date(now()).toISOString().slice(0, 10);
  const calls = Object.fromEntries(list.map((s) => [s.source.source, s.store.modelCallsOn(day)]));
  const samples = [...list.map((s) => snap.sources[s.source.source]), snap.near];
  const errors = samples.flatMap((s) => (s && !s.ok ? [s.error] : []));
  return {
    status: errors.length === 0 ? "ok" : "degraded",
    queue: { active: activeCount(byStatus), byStatus },
    sources,
    base: base ? { ...base, scannedBlock: base.scanned, headBlock: base.head, lagBlocks: base.lag, oracleBalanceWei: base.oracleBalance ?? null } : null,
    near: {
      contract: config.nearOracleContract,
      relayerAccount: config.nearRelayerAccount,
      relayerBalanceYocto: snap.near.ok ? snap.near.value.relayerBalanceYocto.toString() : null,
      checkedAt: iso(snap.near),
      stale: snap.near.ok ? snap.near.stale : null,
    },
    budget: {
      day,
      modelCalls: Object.values(calls).reduce((sum, n) => sum + n, 0),
      dailyLimit: config.dailyModelBudget * list.length,
      perSourceLimit: config.dailyModelBudget,
      bySource: calls,
    },
    errors,
  };
}

interface StatParts {
  readonly byStatus: ByStatus;
  readonly answers: ByStatus;
  readonly confirmed: number;
  readonly avgMs: number | null;
}

function statParts(store: ReadStore): StatParts {
  const byStatus = store.statusCounts();
  return { byStatus, answers: store.answerCounts(), confirmed: byStatus.confirmed ?? 0, avgMs: store.avgConfirmMs() };
}

function statsView(p: StatParts) {
  const answers = Object.fromEntries(ANSWERS.map((a) => [a, p.answers[a] ?? 0])) as Record<(typeof ANSWERS)[number], number>;
  const answered = ANSWERS.reduce((sum, a) => sum + answers[a], 0);
  return {
    total: Object.values(p.byStatus).reduce((sum, n) => sum + n, 0),
    byStatus: p.byStatus,
    answers,
    answerShare: Object.fromEntries(ANSWERS.map((a) => [a, share(answers[a], answered)])),
    avgSecondsSeenToConfirmed: p.avgMs === null ? null : Math.round(p.avgMs / 1000),
  };
}

function combine(parts: readonly StatParts[]): StatParts {
  const confirmed = parts.reduce((sum, p) => sum + p.confirmed, 0);
  const weighted = parts.reduce((sum, p) => sum + (p.avgMs ?? 0) * p.confirmed, 0);
  return {
    byStatus: parts.reduce<ByStatus>((acc, p) => addCounts(acc, p.byStatus), {}),
    answers: parts.reduce<ByStatus>((acc, p) => addCounts(acc, p.answers), {}),
    confirmed,
    avgMs: confirmed === 0 ? null : weighted / confirmed,
  };
}

function stats(deps: ApiDeps) {
  const parts = served(deps).map((s) => [s.source.source, statParts(s.store)] as const);
  return { ...statsView(combine(parts.map(([, p]) => p))), bySource: Object.fromEntries(parts.map(([source, p]) => [source, statsView(p)])) };
}

function registerSafety(app: FastifyInstance, deps: ApiDeps): void {
  const origin = deps.config.corsOrigin;
  app.addHook("onSend", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.headers(SECURITY_HEADERS);
    if (origin === null) return;
    reply.header("vary", "Origin");
    if (req.headers.origin === origin) reply.header("access-control-allow-origin", origin);
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody("not_found", "no such route")));
  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send(errorBody(err.code, err.message));
    if ("validation" in err && err.validation) return reply.code(400).send(errorBody("bad_request", err.message));
    if (err.statusCode === 429) return reply.code(429).send(errorBody("rate_limited", "too many requests, slow down"));
    deps.log.error({ err: err.message, url: req.url }, "request failed");
    return reply.code(500).send(errorBody("internal", "internal error"));
  });
}

function listRequests(deps: ApiDeps, q: ListQueryString) {
  const limit = q.limit === undefined ? DEFAULT_LIMIT : Number(q.limit);
  const cursor = q.cursor === undefined ? undefined : decodeCursor(q.cursor);
  if (cursor === null) throw new HttpError(400, "bad_request", "cursor is not one this API issued");
  const all = served(deps);
  const picked = q.source === undefined ? all : all.filter((s) => s.source.source === q.source);
  if (picked.length === 0) throw new HttpError(400, "bad_request", `source ${q.source ?? ""} is not served`);
  const stores: SourceStore[] = picked.map((s) => ({ source: s.source.source, store: s.store }));
  const page = listMerged(stores, { limit, ...(q.status === undefined ? {} : { status: q.status }), ...(cursor === undefined ? {} : { cursor }) });
  const bySource = new Map(all.map((s) => [s.source.source, s.source]));
  const data = page.items.map((item) => requestSummary(item.row, bySource.get(item.source) as ApiSource));
  return { data, meta: { limit, nextCursor: page.nextCursor } };
}

async function detail(deps: ApiDeps, target: Served, id: number) {
  const b = bundle(target, id);
  const models = await deps.chain.models();
  return { data: requestDetail({ ...b, models: models.ok ? models.value : null, source: target.source }) };
}

async function verify(deps: ApiDeps, target: Served, id: number) {
  const b = bundle(target, id);
  const models = await deps.chain.models();
  return { data: verifyPlan(b, deps.config, target.source, models.ok ? models.value.map((m) => m.model) : null) };
}

type SourceIdRequest = FastifyRequest<{ Params: { source: SourceName; id: string } }>;
type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { chain, config } = deps;
  app.get("/health", async () => ({ data: await health(deps) }));

  app.get("/chains", async () => {
    const fee = config.sources.some((s) => s.kind === "near") ? await chain.nearFee() : null;
    return { data: chainsView(config.sources, config, fee?.ok ? fee.value : null), ...(fee ? { meta: { checkedAt: iso(fee), stale: fee.ok ? fee.stale : null } } : {}) };
  });

  app.get<{ Querystring: ListQueryString }>("/requests", { schema: { querystring: listQuery } }, async (req) => listRequests(deps, req.query));

  app.get("/requests/:source/:id", { schema: { params: sourceIdParams } }, async (req: SourceIdRequest) => detail(deps, find(deps, req.params.source), Number(req.params.id)));
  app.get("/requests/:source/:id/verify", { schema: { params: sourceIdParams } }, async (req: SourceIdRequest) => verify(deps, find(deps, req.params.source), Number(req.params.id)));
  app.get("/requests/:id", { schema: { params: idParams } }, async (req: IdRequest) => detail(deps, find(deps, LEGACY_SOURCE), Number(req.params.id)));
  app.get("/requests/:id/verify", { schema: { params: idParams } }, async (req: IdRequest) => verify(deps, find(deps, LEGACY_SOURCE), Number(req.params.id)));

  app.get("/models", async () => {
    const models = await chain.models();
    if (!models.ok) throw new HttpError(503, "unavailable", models.error);
    return { data: modelsView(models.value, config), meta: { checkedAt: iso(models), stale: models.stale } };
  });

  app.get("/stats", async () => ({ data: stats(deps) }));
}

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: deps.config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });
  registerSafety(app, deps);
  await app.register(rateLimit, {
    max: deps.config.rateLimitPerMinute,
    timeWindow: "1 minute",
    keyGenerator: (req) => rateLimitKey(req.ip),
    errorResponseBuilder: (_req, ctx) => Object.assign(new Error("too many requests"), { statusCode: ctx.statusCode }),
  });
  registerRoutes(app, deps);
  await app.ready();
  return app;
}
