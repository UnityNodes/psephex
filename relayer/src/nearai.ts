import type { ModelProviderPort, ModelReply, ModelSignature } from "./types.js";

const COMPLETIONS_PATH = "/v1/chat/completions";
const SIGNATURE_PATH = "/v1/signature/";
const SIGNING_ALGO = "ed25519";
const ERROR_SNIPPET = 300;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type ModelErrorKind = "transient" | "auth" | "permanent";

export class ModelProviderError extends Error {
  override readonly name = "ModelProviderError";
  readonly kind: ModelErrorKind;

  constructor(message: string, kind: ModelErrorKind) {
    super(message);
    this.kind = kind;
  }
}

function kindForStatus(status: number): ModelErrorKind {
  if (status === 401 || status === 402 || status === 403) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  return "permanent";
}

async function guarded(call: () => Promise<Response>, what: string): Promise<Response> {
  try {
    return await call();
  } catch (err) {
    throw new ModelProviderError(`${what} request failed: ${err instanceof Error ? err.name : "error"}`, "transient");
  }
}

export interface NearAiOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
  readonly signatureRetries: number;
  readonly signatureDelayMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(bytes: ArrayBuffer): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new ModelProviderError("model response is not valid UTF-8", "permanent");
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelProviderError(`${what} is not JSON: ${text.slice(0, ERROR_SNIPPET)}`, "permanent");
  }
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

export class NearAiClient implements ModelProviderPort {
  readonly #opts: NearAiOptions;

  constructor(opts: NearAiOptions) {
    this.#opts = opts;
  }

  #headers(extra: Record<string, string>): Record<string, string> {
    return { Accept: "application/json", "x-no-aliasing": "true", Authorization: `Bearer ${this.#opts.apiKey}`, ...extra };
  }

  async complete(requestBody: string): Promise<ModelReply> {
    const started = this.#opts.now();
    const res = await guarded(
      () =>
        this.#opts.fetch(this.#opts.baseUrl + COMPLETIONS_PATH, {
          method: "POST",
          headers: this.#headers({ "Content-Type": "application/json", "Accept-Encoding": "identity" }),
          body: requestBody,
          signal: AbortSignal.timeout(this.#opts.timeoutMs),
        }),
      "completion",
    );
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new ModelProviderError(`completion response is ${bytes.byteLength} bytes, max ${MAX_RESPONSE_BYTES}`, "permanent");
    const responseBody = decodeUtf8(bytes);
    if (res.status !== 200) throw new ModelProviderError(`completion HTTP ${res.status}: ${responseBody.slice(0, ERROR_SNIPPET)}`, kindForStatus(res.status));
    const chatId = field(parseJson(responseBody, "completion response"), "id");
    if (typeof chatId !== "string" || !chatId) throw new ModelProviderError("completion response has no id", "permanent");
    return { chatId, responseBody, latencyMs: this.#opts.now() - started };
  }

  async signature(chatId: string): Promise<ModelSignature> {
    const url = `${this.#opts.baseUrl}${SIGNATURE_PATH}${encodeURIComponent(chatId)}?signing_algo=${SIGNING_ALGO}`;
    for (let attempt = 1; attempt <= this.#opts.signatureRetries; attempt++) {
      const res = await guarded(() => this.#opts.fetch(url, { headers: this.#headers({}), signal: AbortSignal.timeout(this.#opts.timeoutMs) }), "signature");
      const text = await res.text();
      const json = res.ok ? parseJson(text, "signature response") : null;
      if (res.ok && field(json, "signature") !== undefined) return this.#parseSignature(json);
      const notReady = res.status === 404 || (res.ok && field(json, "error_code") !== undefined);
      if (!notReady) throw new ModelProviderError(`signature HTTP ${res.status}: ${text.slice(0, ERROR_SNIPPET)}`, kindForStatus(res.status));
      if (attempt < this.#opts.signatureRetries) await this.#opts.sleep(this.#opts.signatureDelayMs);
    }
    throw new ModelProviderError(`signature for ${chatId} not available after ${this.#opts.signatureRetries} attempts`, "transient");
  }

  #parseSignature(json: unknown): ModelSignature {
    const algo = String(field(json, "signing_algo") ?? "").toLowerCase();
    if (algo !== SIGNING_ALGO) throw new ModelProviderError(`signature algorithm ${algo}, expected ${SIGNING_ALGO}`, "permanent");
    const text = field(json, "text");
    const signature = field(json, "signature");
    const signingAddress = field(json, "signing_address");
    if (typeof text !== "string" || typeof signature !== "string" || typeof signingAddress !== "string") {
      throw new ModelProviderError("signature response is missing text, signature or signing_address", "permanent");
    }
    const signatureHex = strip0x(signature).toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(signatureHex)) throw new ModelProviderError("signature must be 64 bytes of hex", "permanent");
    return { text, signatureHex, signingAddress: strip0x(signingAddress).toLowerCase() };
  }
}
