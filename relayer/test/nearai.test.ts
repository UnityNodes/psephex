import { describe, expect, it } from "vitest";
import { NearAiClient, ModelProviderError } from "../src/nearai.js";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(responses: readonly (() => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses[i++];
    if (!next) throw new Error("unexpected fetch");
    return next();
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const RAW = '{"id":"chatcmpl-1","choices":[{"message":{"content":"YES"}}],"usage":{"total_tokens":3}}  ';
const BODY = '{"model":"m","messages":[{"role":"user","content":"q"}],"temperature":0,"seed":42,"max_tokens":8,"stream":false}';

function client(f: typeof fetch, clock = { t: 0 }): NearAiClient {
  return new NearAiClient({
    baseUrl: "https://cloud-api.near.ai",
    apiKey: "secret-key",
    fetch: f,
    timeoutMs: 1000,
    signatureRetries: 3,
    signatureDelayMs: 0,
    now: () => (clock.t += 5),
    sleep: async () => {},
  });
}

describe("NearAiClient.complete", () => {
  it("posts the body unchanged and keeps the raw response bytes", async () => {
    const { fetch, calls } = fakeFetch([() => new Response(RAW, { status: 200 })]);
    const reply = await client(fetch).complete(BODY);
    expect(reply.chatId).toBe("chatcmpl-1");
    expect(reply.responseBody).toBe(RAW);
    expect(reply.latencyMs).toBe(5);
    expect(calls[0]?.url).toBe("https://cloud-api.near.ai/v1/chat/completions");
    expect(calls[0]?.init?.body).toBe(BODY);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    });
  });

  it("fails on a non-200 status without leaking the key", async () => {
    const { fetch } = fakeFetch([() => new Response("overloaded", { status: 503 })]);
    const err = await client(fetch).complete(BODY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelProviderError);
    expect(String(err)).toMatch(/503/);
    expect(String(err)).not.toMatch(/secret-key/);
  });

  it("fails when the response has no id", async () => {
    const { fetch } = fakeFetch([() => new Response('{"choices":[]}', { status: 200 })]);
    await expect(client(fetch).complete(BODY)).rejects.toThrow(/id/);
  });

  it("fails when the response is not JSON", async () => {
    const { fetch } = fakeFetch([() => new Response("<html>", { status: 200 })]);
    await expect(client(fetch).complete(BODY)).rejects.toThrow(/JSON/);
  });

  it("fails when the response is not valid UTF-8", async () => {
    const { fetch } = fakeFetch([() => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200 })]);
    await expect(client(fetch).complete(BODY)).rejects.toThrow(/UTF-8/);
  });
});

describe("NearAiClient error kinds", () => {
  async function kindOf(res: () => Response): Promise<string> {
    const { fetch } = fakeFetch([res]);
    const err = (await client(fetch).complete(BODY).catch((e: unknown) => e)) as ModelProviderError;
    return err.kind;
  }

  it("classifies statuses and malformed replies", async () => {
    expect(await kindOf(() => new Response("x", { status: 503 }))).toBe("transient");
    expect(await kindOf(() => new Response("x", { status: 429 }))).toBe("transient");
    expect(await kindOf(() => new Response("x", { status: 408 }))).toBe("transient");
    expect(await kindOf(() => new Response("x", { status: 401 }))).toBe("auth");
    expect(await kindOf(() => new Response("x", { status: 402 }))).toBe("auth");
    expect(await kindOf(() => new Response("x", { status: 400 }))).toBe("permanent");
    expect(await kindOf(() => new Response("{}", { status: 200 }))).toBe("permanent");
  });

  it("treats a network failure as transient without leaking details", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed https://cloud-api.near.ai/?key=secret");
    }) as typeof fetch;
    const err = (await client(failing).complete(BODY).catch((e: unknown) => e)) as ModelProviderError;
    expect(err.kind).toBe("transient");
    expect(err.message).not.toMatch(/secret/);
  });

  it("rejects an oversized response as permanent", async () => {
    const big = JSON.stringify({ id: "c", pad: "x".repeat(70_000) });
    expect(await kindOf(() => new Response(big, { status: 200 }))).toBe("permanent");
  });
});

describe("NearAiClient.signature", () => {
  const SIG = { text: "m:aa:bb", signature: "0x" + "ab".repeat(64), signing_address: "cd".repeat(32), signing_algo: "ed25519" };

  it("retries while the signature is not ready", async () => {
    const { fetch, calls } = fakeFetch([
      () => new Response("not found", { status: 404 }),
      () => new Response(JSON.stringify({ error_code: "pending" }), { status: 200 }),
      () => new Response(JSON.stringify(SIG), { status: 200 }),
    ]);
    const sig = await client(fetch).signature("chat/1");
    expect(sig).toEqual({ text: "m:aa:bb", signatureHex: "ab".repeat(64), signingAddress: "cd".repeat(32) });
    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe("https://cloud-api.near.ai/v1/signature/chat%2F1?signing_algo=ed25519");
  });

  it("gives up after the configured retries", async () => {
    const { fetch } = fakeFetch([
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
    ]);
    await expect(client(fetch).signature("c")).rejects.toThrow(/not available/);
  });

  it("fails fast on other errors", async () => {
    const { fetch } = fakeFetch([() => new Response("bad key", { status: 401 })]);
    await expect(client(fetch).signature("c")).rejects.toThrow(/401/);
  });

  it("rejects a signature with another algorithm", async () => {
    const { fetch } = fakeFetch([() => new Response(JSON.stringify({ ...SIG, signing_algo: "ecdsa" }), { status: 200 })]);
    await expect(client(fetch).signature("c")).rejects.toThrow(/ed25519/);
  });

  it("rejects a malformed signature", async () => {
    const { fetch } = fakeFetch([() => new Response(JSON.stringify({ ...SIG, signature: "zz" }), { status: 200 })]);
    await expect(client(fetch).signature("c")).rejects.toThrow(/64 bytes/);
  });
});
