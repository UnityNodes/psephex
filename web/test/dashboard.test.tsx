import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createApi, healthSchema, type Api } from "../src/api.js";
import { MetricsStrip } from "../src/app/MetricsStrip.js";
import { baseLagText, relayerState } from "../src/app/NetworkStatus.js";
import { ApiProvider } from "../src/hooks.js";
import { timeAgo, tookSeconds } from "../src/lib/format.js";
import { dataOf, evidence } from "./fixtures.js";

function api(files: Record<string, unknown>): Api {
  const fetchImpl = vi.fn(async (url: string) => {
    const body = files[url.replace("https://api.test", "")];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response(JSON.stringify({ error: { code: "unavailable", message: "down" } }), { status: 503 });
  });
  return createApi("https://api.test", fetchImpl as unknown as typeof fetch);
}

function renderStrip(files: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ApiProvider value={api(files)}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MetricsStrip />
        </MemoryRouter>
      </QueryClientProvider>
    </ApiProvider>,
  );
}

const HEALTH = healthSchema.parse(dataOf("health.json"));

describe("MetricsStrip", () => {
  it("shows totals, the verdict split in words and the relayer state", async () => {
    renderStrip({ "/stats": evidence("stats.json"), "/health": evidence("health.json") });
    const strip = screen.getByRole("region", { name: "Live numbers" });
    expect(await within(strip).findByRole("img", { name: "3 YES, 1 NO and 1 UNKNOWN" })).toBeInTheDocument();
    expect(strip).toHaveTextContent(/5 answered on Base, 2 stopped/);
    expect(strip).toHaveTextContent(/346 s/);
    expect(await within(strip).findByText("Running")).toBeInTheDocument();
    expect(strip).toHaveTextContent(/0 of 300 model calls today/);
  });

  it("says so when the API is down", async () => {
    renderStrip({});
    expect(await screen.findByText(/did not answer/)).toBeInTheDocument();
    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });
});

describe("relayerState", () => {
  it("is running only when both chains are fresh and nothing failed", () => {
    expect(relayerState(HEALTH, false)).toEqual({ tone: "ok", label: "Running" });
    expect(relayerState({ ...HEALTH, base: { ...HEALTH.base, stale: true } }, false).label).toBe("Degraded");
    expect(relayerState({ ...HEALTH, errors: ["near rpc"] }, false).label).toBe("Degraded");
    expect(relayerState(undefined, false).label).toBe("Checking…");
    expect(relayerState(HEALTH, true).label).toBe("API unreachable");
  });
});

describe("baseLagText", () => {
  it("never shows a negative lag", () => {
    expect(baseLagText("-36")).toBe("Base in sync");
    expect(baseLagText("0")).toBe("Base in sync");
    expect(baseLagText("1")).toBe("Base 1 block behind");
    expect(baseLagText("219320")).toBe("Base 219320 blocks behind");
    expect(baseLagText("x")).toBe("Base lag unknown");
  });
});

describe("format", () => {
  it("measures how long a finished request took and skips open ones", () => {
    const base = { createdAt: "2026-11-09T08:00:21.641Z", updatedAt: "2026-11-09T08:00:42.771Z" };
    expect(tookSeconds({ ...base, status: "confirmed" })).toBe(21);
    expect(tookSeconds({ ...base, status: "answering" })).toBeNull();
    expect(tookSeconds({ status: "failed", createdAt: "bad", updatedAt: "bad" })).toBeNull();
  });

  it("writes relative times", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(timeAgo("2026-11-09T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-09T11:55:00Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-11-09T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-07T12:00:00Z", now)).toBe("2 days ago");
    expect(timeAgo("nope", now)).toBe("");
  });
});
