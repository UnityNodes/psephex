import { z } from "zod";

const answer = z.enum(["YES", "NO", "UNKNOWN"]);
const status = z.enum(["seen", "answering", "verified", "near_sent", "near_signed", "base_sent", "confirmed", "rejected", "failed"]);

export const requestSummarySchema = z.object({
  id: z.number().int().positive(),
  question: z.string(),
  answer: answer.nullable(),
  status,
  reason: z.string().nullable(),
  requester: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const requestDetailSchema = z.object({
  id: z.number().int().positive(),
  requester: z.string(),
  origin: z.string().nullable(),
  question: z.string(),
  questionHash: z.string(),
  paidWei: z.string(),
  askedTx: z.string(),
  status,
  reason: z.string().nullable(),
  answer: answer.nullable(),
  votes: z.array(z.object({ model: z.string(), answer })).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  timeToConfirmMs: z.number().nullable(),
  models: z.array(
    z.object({
      model: z.string(),
      provider: z.string(),
      publicKey: z.string().nullable(),
      requestBody: z.string(),
      responseBody: z.string().nullable(),
      chatId: z.string().nullable(),
      signatureHex: z.string().nullable(),
      signedText: z.string().nullable(),
      attempts: z.number(),
      latencyMs: z.number().nullable(),
    }),
  ),
  near: z.array(z.object({ txHash: z.string(), nonce: z.number(), ok: z.boolean().nullable(), createdAt: z.string() })),
  base: z.array(z.object({ txHash: z.string(), status: z.string(), gasUsed: z.string().nullable(), sentAt: z.string() })),
});

export const verifyPlanSchema = z.object({
  requestId: z.number(),
  available: z.boolean(),
  reason: z.string().nullable(),
  questionHash: z.string(),
  steps: z.array(z.object({ title: z.string(), command: z.string(), expect: z.array(z.string()).optional() })),
});

export const modelSchema = z.object({
  model: z.string(),
  provider: z.string(),
  scheme: z.string(),
  publicKey: z.string(),
  attestation: z.object({ url: z.string().url(), howTo: z.string() }).nullable(),
});

export const statsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  answers: z.object({ YES: z.number(), NO: z.number(), UNKNOWN: z.number() }),
  answerShare: z.object({ YES: z.number(), NO: z.number(), UNKNOWN: z.number() }),
  avgSecondsSeenToConfirmed: z.number().nullable(),
});

const pageMeta = z.object({ limit: z.number(), nextCursor: z.number().nullable() });

export type RequestSummary = z.infer<typeof requestSummarySchema>;
export type RequestDetail = z.infer<typeof requestDetailSchema>;
export type VerifyPlan = z.infer<typeof verifyPlanSchema>;
export type ModelView = z.infer<typeof modelSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type RequestStatus = z.infer<typeof status>;
export type Answer = z.infer<typeof answer>;

export interface RequestPage {
  readonly items: readonly RequestSummary[];
  readonly nextCursor: number | null;
}

export interface ListQuery {
  readonly limit: number;
  readonly cursor?: number;
  readonly status?: RequestStatus;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export interface Api {
  request(id: number): Promise<RequestDetail | null>;
  verify(id: number): Promise<VerifyPlan>;
  requests(q: ListQuery): Promise<RequestPage>;
  models(): Promise<ModelView[]>;
  stats(): Promise<Stats>;
}

export function createApi(baseUrl: string, fetchImpl: typeof fetch = fetch): Api {
  const root = baseUrl.replace(/\/+$/, "");

  async function get<T extends z.ZodType>(path: string, schema: T, allowMissing = false): Promise<z.infer<T> | null> {
    const res = await fetchImpl(`${root}${path}`, { headers: { accept: "application/json" } });
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 404 && allowMissing) return null;
    if (!res.ok) {
      const parsed = errorBody.safeParse(body);
      throw parsed.success ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message) : new ApiError(res.status, "http", `API answered ${res.status}`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new Error(`unexpected response from ${path}`);
    return parsed.data;
  }

  const one = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

  return {
    async request(id) {
      return (await get(`/requests/${id}`, one(requestDetailSchema), true))?.data ?? null;
    },
    async verify(id) {
      return (await get(`/requests/${id}/verify`, one(verifyPlanSchema)))!.data;
    },
    async requests(q) {
      const params = new URLSearchParams({ limit: String(q.limit) });
      if (q.cursor !== undefined) params.set("cursor", String(q.cursor));
      if (q.status !== undefined) params.set("status", q.status);
      const page = (await get(`/requests?${params.toString()}`, z.object({ data: z.array(requestSummarySchema), meta: pageMeta })))!;
      return { items: page.data, nextCursor: page.meta.nextCursor };
    },
    async models() {
      return (await get("/models", one(z.array(modelSchema))))!.data;
    },
    async stats() {
      return (await get("/stats", one(statsSchema)))!.data;
    },
  };
}
