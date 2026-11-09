import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api.js";
import { evidence } from "./fixtures.js";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("api client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses real responses captured from the stage 5 API", async () => {
    const files: Record<string, unknown> = {
      "/requests/7": evidence("request-7.json"),
      "/requests/5": evidence("request-5.json"),
      "/requests/7/verify": evidence("verify-7.json"),
      "/requests?limit=20": evidence("requests.json"),
      "/models": evidence("models.json"),
      "/stats": evidence("stats.json"),
    };
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(files[url.replace("https://api.test", "")]), { status: 200 }));
    const api = createApi("https://api.test", fetch as unknown as typeof globalThis.fetch);
    const seven = await api.request(7);
    expect(seven).toMatchObject({ id: 7, answer: "NO", status: "confirmed" });
    expect(seven?.models).toHaveLength(3);
    expect(seven?.votes).toHaveLength(3);
    expect((await api.request(5))?.status).toBe("failed");
    expect((await api.verify(7)).steps.length).toBeGreaterThan(4);
    expect((await api.requests({ limit: 20 })).items.map((r) => r.id)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect((await api.models())[0]?.attestation?.url).toMatch(/^https:\/\/cloud-api\.near\.ai\//);
    expect((await api.stats()).answers).toEqual({ YES: 3, NO: 1, UNKNOWN: 1 });
  });

  it("returns null for a request the relayer has not seen yet", async () => {
    const api = createApi("https://api.test", respond(404, { error: { code: "not_found", message: "request 9 not found" } }) as unknown as typeof fetch);
    expect(await api.request(9)).toBeNull();
  });

  it("builds list queries with cursor and status", async () => {
    const fetch = respond(200, { data: [], meta: { limit: 5, nextCursor: null } });
    const api = createApi("https://api.test/", fetch as unknown as typeof globalThis.fetch);
    await api.requests({ limit: 5, cursor: 12, status: "confirmed" });
    expect(fetch).toHaveBeenCalledWith("https://api.test/requests?limit=5&cursor=12&status=confirmed", expect.anything());
  });

  it("raises the API error code and message", async () => {
    const api = createApi("https://api.test", respond(429, { error: { code: "rate_limited", message: "too many requests, slow down" } }) as unknown as typeof fetch);
    await expect(api.stats()).rejects.toEqual(new ApiError(429, "rate_limited", "too many requests, slow down"));
  });

  it("rejects a response that does not match the schema", async () => {
    const api = createApi("https://api.test", respond(200, { data: { total: "seven" } }) as unknown as typeof fetch);
    await expect(api.stats()).rejects.toThrow(/unexpected response/);
  });
});
