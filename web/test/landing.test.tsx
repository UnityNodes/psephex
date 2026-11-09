import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createApi, type Api } from "../src/api.js";
import { optionalHttpsUrl } from "../src/deployment.js";
import { ApiProvider } from "../src/hooks.js";
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
  "/requests/7": evidence("request-7.json"),
};

function renderLanding(files: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ApiProvider value={api(files)}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Landing />
        </MemoryRouter>
      </QueryClientProvider>
    </ApiProvider>,
  );
}

describe("Landing", () => {
  it("states what Psephex does and sends people to the dashboard", () => {
    renderLanding(LIVE);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/three AI models/i);
    const cta = screen.getByRole("link", { name: "Try it on Base Sepolia" });
    expect(cta).toHaveAttribute("href", "/app");
  });

  it("explains the five steps in order", () => {
    renderLanding(LIVE);
    const steps = within(screen.getByRole("list", { name: "How a question is answered" })).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("h3")?.textContent)).toEqual([
      "Base records the question",
      "Three models answer in TEEs",
      "NEAR checks two of three",
      "NEAR MPC signs for Base",
      "Base pays out",
    ]);
  });

  it("is honest about what a verdict does not prove", () => {
    renderLanding(LIVE);
    const limits = screen.getByRole("region", { name: "What a verdict does not prove" });
    expect(limits).toHaveTextContent(/9 is a prime number/);
    expect(within(limits).getByRole("link", { name: "dispute #2" })).toHaveAttribute("href", "/app/r/2");
    expect(limits).toHaveTextContent(/one provider/);
    expect(screen.getByRole("region", { name: "What a verdict proves" })).toHaveTextContent(/80 of 80/);
  });

  it("shows live numbers and the latest verdict from the API", async () => {
    renderLanding(LIVE);
    const numbers = await screen.findByRole("region", { name: "Live on Base Sepolia" });
    expect(await within(numbers).findByText(/7 disputes/)).toBeInTheDocument();
    expect(numbers).toHaveTextContent(/5 answered on Base/);
    expect(numbers).toHaveTextContent(/3 YES, 1 NO and 1 UNKNOWN/);
    const latest = await screen.findByRole("region", { name: "Latest verdict" });
    expect(await within(latest).findByText(/Is water made of carbon/)).toBeInTheDocument();
    expect(latest).toHaveTextContent(/3 of 3 signed answers say NO/);
    expect(within(latest).getByRole("link", { name: "See how dispute #7 was decided" })).toHaveAttribute("href", "/app/r/7");
  });

  it("still reads when the API is down", async () => {
    renderLanding({});
    expect(await screen.findByText(/Live numbers are unavailable right now/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try it on Base Sepolia" })).toBeInTheDocument();
  });

  it("shows the tested Solidity client and links the deployed contracts", () => {
    renderLanding(LIVE);
    const dev = screen.getByRole("region", { name: "Use it from your contract" });
    expect(dev).toHaveTextContent("function onAnswer(uint256 id, uint8 answer) external");
    expect(dev).toHaveTextContent("contract YesNoClient is IAiOracleClient");
    for (const name of ["AiOracle on Basescan", "Dispute on Basescan", "oracle.psephex.testnet on Nearblocks", "Oracle address on Basescan"]) {
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
