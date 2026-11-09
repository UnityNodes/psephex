import { isIP } from "node:net";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Log } from "../pipeline.js";
import { REQUEST_STATUSES, TERMINAL_STATUSES, type RequestStatus } from "../types.js";
import type { ChainStatus, Sample } from "./chain.js";
import type { ApiConfig } from "./config.js";
import type { ReadStore } from "./store.js";
import { modelsView, requestDetail, requestSummary, verifyPlan, type RequestBundle } from "./views.js";

export interface ApiDeps {
  readonly store: ReadStore;
  readonly chain: ChainStatus;
  readonly config: ApiConfig;
  readonly log: Log;
  readonly now: () => number;
}

const ID_PATTERN = "^[1-9][0-9]{0,14}$";
const LIMIT_PATTERN = "^([1-9]|[1-9][0-9]|100)$";
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

const listQuery = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: LIMIT_PATTERN },
    cursor: { type: "string", pattern: ID_PATTERN },
    status: { type: "string", enum: REQUEST_STATUSES },
  },
} as const;

interface ListQueryString {
  readonly limit?: string;
  readonly cursor?: string;
  readonly status?: RequestStatus;
}

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

function bundle(store: ReadStore, id: number): RequestBundle {
  const request = store.request(id);
  if (!request) throw new HttpError(404, "not_found", `request ${id} not found`);
  return { request, answers: store.modelAnswers(id), nearTxs: store.nearTxs(id), baseTxs: store.baseTxs(id) };
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

async function health(deps: ApiDeps) {
  const { store, chain, config, now } = deps;
  const snap = await chain.snapshot();
  const byStatus = store.statusCounts();
  const active = Object.entries(byStatus)
    .filter(([status]) => !TERMINAL_STATUSES.includes(status as RequestStatus))
    .reduce((sum, [, n]) => sum + n, 0);
  const scanned = store.cursor();
  const head = snap.base.ok ? snap.base.value.head : null;
  const day = new Date(now()).toISOString().slice(0, 10);
  const errors = [snap.base, snap.near].flatMap((s) => (s.ok ? [] : [s.error]));
  return {
    status: errors.length === 0 ? "ok" : "degraded",
    queue: { active, byStatus },
    base: {
      scannedBlock: scanned?.toString() ?? null,
      headBlock: head?.toString() ?? null,
      lagBlocks: head !== null && scanned !== null ? (head - scanned).toString() : null,
      oracleAddress: config.oracleEvmAddress,
      oracleBalanceWei: snap.base.ok ? snap.base.value.oracleBalanceWei.toString() : null,
      checkedAt: iso(snap.base),
      stale: snap.base.ok ? snap.base.stale : null,
    },
    near: {
      contract: config.nearOracleContract,
      relayerAccount: config.nearRelayerAccount,
      relayerBalanceYocto: snap.near.ok ? snap.near.value.relayerBalanceYocto.toString() : null,
      checkedAt: iso(snap.near),
      stale: snap.near.ok ? snap.near.stale : null,
    },
    budget: { day, modelCalls: store.modelCallsOn(day), dailyLimit: config.dailyModelBudget },
    errors,
  };
}

function stats(store: ReadStore) {
  const byStatus = store.statusCounts();
  const counted = store.answerCounts();
  const answers = Object.fromEntries(ANSWERS.map((a) => [a, counted[a] ?? 0])) as Record<(typeof ANSWERS)[number], number>;
  const answered = ANSWERS.reduce((sum, a) => sum + answers[a], 0);
  const avgMs = store.avgConfirmMs();
  return {
    total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
    byStatus,
    answers,
    answerShare: Object.fromEntries(ANSWERS.map((a) => [a, share(answers[a], answered)])),
    avgSecondsSeenToConfirmed: avgMs === null ? null : Math.round(avgMs / 1000),
  };
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

function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { store, chain, config } = deps;
  app.get("/health", async () => ({ data: await health(deps) }));

  app.get<{ Querystring: ListQueryString }>("/requests", { schema: { querystring: listQuery } }, async (req) => {
    const limit = req.query.limit === undefined ? DEFAULT_LIMIT : Number(req.query.limit);
    const page = store.listRequests({
      limit,
      ...(req.query.cursor === undefined ? {} : { before: Number(req.query.cursor) }),
      ...(req.query.status === undefined ? {} : { status: req.query.status }),
    });
    return { data: page.items.map(requestSummary), meta: { limit, nextCursor: page.nextCursor } };
  });

  app.get<{ Params: { id: string } }>("/requests/:id", { schema: { params: idParams } }, async (req) => {
    const b = bundle(store, Number(req.params.id));
    const models = await chain.models();
    return { data: requestDetail({ ...b, models: models.ok ? models.value : null }) };
  });

  app.get<{ Params: { id: string } }>("/requests/:id/verify", { schema: { params: idParams } }, async (req) => {
    const b = bundle(store, Number(req.params.id));
    const models = await chain.models();
    return { data: verifyPlan(b, config, models.ok ? models.value.map((m) => m.model) : null) };
  });

  app.get("/models", async () => {
    const models = await chain.models();
    if (!models.ok) throw new HttpError(503, "unavailable", models.error);
    return { data: modelsView(models.value, config), meta: { checkedAt: iso(models), stale: models.stale } };
  });

  app.get("/stats", async () => ({ data: stats(store) }));
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
