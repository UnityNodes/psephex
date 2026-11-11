import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createApi, type Api } from "../src/api.js";
import { optionalHttpsUrl } from "../src/deployment.js";
import { ThemeProvider } from "../src/components/theme-provider.js";
import { ApiProvider } from "../src/hooks.js";
import { MCP_TOOL_GROUPS } from "../src/lib/mcp.js";
import { Landing } from "../src/pages/Landing.js";
import { evidence } from "./fixtures.js";

function api(files: Record<string, unknown>): Api {
  const fetchImpl = vi.fn(async (url: string) => {
    const body = files[url.replace("https://api.test", "")];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response(JSON.stringify({ error: { code: "unavailable", message: "down" } }), { status: 503 });
  });
  return createApi("https://api.test", fetchImpl as unknown as typeof fetch);
}

const LIVE = {
  "/stats": evidence("stats.json"),
  "/requests?limit=1&status=confirmed": { data: [(evidence("requests.json") as { data: unknown[] }).data[0]], meta: { limit: 1, nextCursor: 6 } },
  "/requests/base/7": evidence("request-7.json"),
};

function renderLanding(files: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
    <ApiProvider value={api(files)}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </QueryClientProvider>
    </ApiProvider>
    </ThemeProvider>,
  );
}

describe("Landing", () => {
  it("leads with the judge for agent deals and sends people to open a case", () => {
    renderLanding(LIVE);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("A judge for deals between AI agents, running on NEAR.");
    expect(screen.getByText(/An agent that ordered work and an agent that delivered it both put their evidence on the record/)).toHaveTextContent(/either side can appeal to a human arbiter/);
    const cta = screen.getByRole("link", { name: "Open a case on NEAR testnet" });
    expect(cta).toHaveAttribute("href", "/app/new");
  });

  it("explains a case in five steps, from the claim to the payout", () => {
    renderLanding(LIVE);
    const steps = within(screen.getByRole("list", { name: "How a case is decided" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("h3")?.textContent)).toEqual([
      "The buyer agent opens a case",
      "The seller agent answers",
      "Three models read both sides in TEEs",
      "NEAR checks two of three",
      "Either side can appeal, then NEAR pays",
    ]);
  });

  it("is honest about what a verdict does not prove", () => {
    renderLanding(LIVE);
    const limits = screen.getByRole("region", { name: "What a verdict does not prove" });
    expect(limits).toHaveTextContent(/9 is a prime number/);
    expect(within(limits).getByRole("link", { name: "dispute #2" })).toHaveAttribute("href", "/app/r/base/2");
    expect(limits).toHaveTextContent(/one on Phala/);
    expect(limits).toHaveTextContent(/which is why the court has an appeal/);
    expect(limits).toHaveTextContent(/The arbiter is one person today/);
    expect(screen.getByRole("region", { name: "What a verdict proves" })).toHaveTextContent(/80 of 80/);
    expect(screen.getByRole("region", { name: "What a verdict proves" })).toHaveTextContent(/applies only 24 hours later/);
  });

  it("shows live numbers and the latest verdict from the API", async () => {
    renderLanding(LIVE);
    const numbers = await screen.findByRole("region", { name: "Live on testnet" });
    await waitFor(() => expect(numbers).toHaveTextContent(/7 disputes/));
    expect(numbers).toHaveTextContent(/5 answered/);
    expect(numbers).toHaveTextContent(/3 YES, 1 NO and 1 UNKNOWN/);
    const latest = await screen.findByRole("region", { name: "Latest verdict" });
    expect(await within(latest).findByText(/Is water made of carbon/)).toBeInTheDocument();
    expect(latest).toHaveTextContent(/3 of 3 signed answers say NO/);
    expect(within(latest).getByRole("link", { name: "See how dispute #7 was decided" })).toHaveAttribute("href", "/app/r/base/7");
  });

  it("still reads when the API is down", async () => {
    renderLanding({});
    expect(await screen.findByText(/Live numbers are unavailable right now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a case on NEAR testnet" })).toBeInTheDocument();
  });

  it("shows how agents open and answer a case, then how a contract asks the oracle", () => {
    renderLanding(LIVE);
    const dev = screen.getByRole("region", { name: "Use it from your agent or contract" });
    const text = dev.textContent ?? "";
    expect(text).toContain("psephex-court.testnet open_case json-args");
    expect(text).toContain('"oracle_reserve":"<ask_deposit>"');
    expect(text).toContain("psephex-court.testnet respond json-args");
    expect(text.indexOf("open_case json-args")).toBeLessThan(text.indexOf("pub fn on_answer"));
    expect(text).toContain("pub fn on_answer(&mut self, request_id: u64, answer: String)");
    expect(text).toContain("oracle.psephex.testnet ask json-args");
    expect(text).toContain("contract YesNoClient is IAiOracleClient");
    expect(text.indexOf("on_answer")).toBeLessThan(text.indexOf("function onAnswer(uint256 id, uint8 answer) external"));
    for (const name of ["psephex-court.testnet on Nearblocks", "AiOracle on Basescan", "Dispute on Basescan", "oracle.psephex.testnet on Nearblocks", "dispute.psephex.testnet on Nearblocks", "Oracle address on Basescan"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});

describe("optionalHttpsUrl", () => {
  it("returns a link only for https URLs", () => {
    expect(optionalHttpsUrl("https://github.com/x/y")).toBe("https://github.com/x/y");
    expect(optionalHttpsUrl(undefined)).toBeNull();
    expect(optionalHttpsUrl("")).toBeNull();
    expect(optionalHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(optionalHttpsUrl("http://github.com/x")).toBeNull();
  });
});

describe("For agents", () => {
  it("gives the install command for the published MCP package", () => {
    renderLanding(LIVE);
    const section = screen.getByRole("region", { name: "Give your agent a court" });
    expect(within(section).getByText("claude mcp add psephex -- npx -y @unitynodes/psephex-mcp")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Package on npm" })).toHaveAttribute("href", "https://www.npmjs.com/package/@unitynodes/psephex-mcp");
    expect(within(section).getByText("io.github.UnityNodes/psephex")).toBeInTheDocument();
  });

  it("lists exactly the tools the MCP server registers", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../mcp/src/server.ts"), "utf8");
    const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(MCP_TOOL_GROUPS.flatMap((g) => g.tools).sort()).toEqual(registered);
    expect(registered).toHaveLength(13);
  });
});
