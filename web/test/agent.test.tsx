import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { NEAR_COURT_CONTRACT, NEAR_ORACLE_CONTRACT } from "../src/deployment.js";
import { agentCases, outcomeFor, reputationLine, reputationOf, type CourtCase, type CourtCaseView } from "../src/lib/court.js";
import { CASES_PAGE, MAX_CASE_PAGES, readAllCases } from "../src/near/court-hooks.js";
import { NearRpcProvider, type NearRpc } from "../src/near/rpc.js";
import { NearWalletContext } from "../src/near/wallet.js";
import { AgentLookup } from "../src/pages/AgentLookup.js";
import { AgentPage } from "../src/pages/AgentPage.js";
import { CasePage } from "../src/pages/CasePage.js";
import { fakeNearRpc, fakeNearWallet } from "./near-fakes.js";

const SELLER = "psephex-agent-seller.testnet";
const BUYER = "psephex-agent-buyer.testnet";

function aCase(over: Partial<CourtCase>): CourtCase {
  return {
    claimant: "alice.testnet",
    counterparty: "bob.testnet",
    amount: "100000000000000000000000",
    oracle_reserve: "1",
    oracle_paid: "1",
    claim: "c",
    evidence: "e",
    response: "r",
    stage: "settled",
    opened_ns: "1",
    respond_by_ns: "1",
    asked_ns: "1",
    request_id: 1,
    answer_by_ns: "1",
    verdict: "YES",
    appeal_by_ns: "1",
    appeal_bond: "0",
    appellant: null,
    arbiter: null,
    arbitrate_by_ns: null,
    winner: "alice.testnet",
    ...over,
  };
}

function view(id: number, over: Partial<CourtCase>): CourtCaseView {
  return { case_id: id, ...aCase(over) };
}

const MCP_SCENARIO = [
  aCase({ winner: "bob.testnet", verdict: "NO" }),
  aCase({ winner: "alice.testnet", response: null }),
  aCase({ stage: "decided", winner: null, appellant: "bob.testnet" }),
  aCase({ stage: "refunded", winner: null }),
  aCase({ claimant: "x.testnet", counterparty: "y.testnet" }),
];

const SELLER_CASES: CourtCaseView[] = [
  view(1, { claimant: BUYER, counterparty: SELLER, winner: BUYER, response: null, claim: "Short by 40 rows" }),
  view(2, { claimant: BUYER, counterparty: SELLER, winner: SELLER, verdict: "NO", claim: "Logo the buyer calls ugly" }),
  view(3, { claimant: "someone.testnet", counterparty: "other.testnet", claim: "Not about the seller" }),
  view(4, { claimant: SELLER, counterparty: BUYER, stage: "awaiting_response", response: null, winner: null, verdict: null, claim: "Paid twice for one dataset" }),
];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string, node: ReactNode, rpc: NearRpc) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NearRpcProvider value={rpc}>
        <NearWalletContext.Provider value={fakeNearWallet()}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/app/agent/:account" element={node} />
              <Route path="/app/case/:id" element={node} />
              <Route path="*" element={node} />
            </Routes>
            <Where />
          </MemoryRouter>
        </NearWalletContext.Provider>
      </NearRpcProvider>
    </QueryClientProvider>,
  );
}

function pagedRpc(all: readonly CourtCaseView[]) {
  const rpc = fakeNearRpc({});
  rpc.view.mockImplementation(async (contract: string, method: string, args: { from_id: number; limit: number }) => {
    if (contract !== NEAR_COURT_CONTRACT || method !== "cases") throw new Error(`no fake for ${contract}.${method}`);
    return all.filter((c) => c.case_id >= args.from_id && c.case_id < args.from_id + args.limit);
  });
  return rpc;
}

function statValue(region: HTMLElement, label: string): string | null | undefined {
  return within(region).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

describe("agent reputation", () => {
  it("counts wins, losses, appeals and silence exactly like the MCP reputationOf", () => {
    const rep = reputationOf("bob.testnet", MCP_SCENARIO);
    expect(rep).toEqual({ account: "bob.testnet", cases: 4, open: 1, won: 1, lost: 1, refunded: 1, appeals_filed: 1, named_as_counterparty: 4, did_not_respond: 1, win_rate: 0.5 });
    expect(reputationLine(rep)).toBe("Won 1 of 2 settled cases; did not answer 1 case");
  });

  it("has no win rate before a case settles and counts only the account's own cases", () => {
    const rep = reputationOf("carol.testnet", MCP_SCENARIO);
    expect(rep).toMatchObject({ cases: 0, win_rate: null });
    expect(reputationLine(rep)).toBe("No cases yet");
    const open = reputationOf("bob.testnet", [aCase({ stage: "awaiting_response", response: null, winner: null })]);
    expect(open).toMatchObject({ cases: 1, open: 1, did_not_respond: 0, win_rate: null });
    expect(reputationLine(open)).toBe("No settled cases yet; 1 open");
    expect(reputationOf("alice.testnet", MCP_SCENARIO).win_rate).toBe(0.5);
    expect(reputationOf("alice.testnet", [aCase({}), aCase({}), aCase({ winner: "bob.testnet" })]).win_rate).toBe(0.67);
  });

  it("names the outcome for the account and sorts its cases newest first", () => {
    expect(outcomeFor(SELLER_CASES[0]!, SELLER)).toBe("lost");
    expect(outcomeFor(SELLER_CASES[1]!, SELLER)).toBe("won");
    expect(outcomeFor(SELLER_CASES[3]!, SELLER)).toBe("open");
    expect(outcomeFor(aCase({ stage: "refunded" }), "bob.testnet")).toBe("refunded");
    expect(agentCases(SELLER, SELLER_CASES).map((c) => c.case_id)).toEqual([4, 2, 1]);
  });
});

describe("loading every case", () => {
  it("pages cases(from_id, 50) until a short page", async () => {
    const all = Array.from({ length: CASES_PAGE + 3 }, (_, i) => view(i + 1, {}));
    const rpc = pagedRpc(all);
    expect(await readAllCases(rpc)).toHaveLength(CASES_PAGE + 3);
    expect(rpc.view.mock.calls.map((c) => c[2])).toEqual([
      { from_id: 1, limit: CASES_PAGE },
      { from_id: CASES_PAGE + 1, limit: CASES_PAGE },
    ]);
  });

  it("stops after 40 full pages", async () => {
    const rpc = fakeNearRpc({ [`${NEAR_COURT_CONTRACT}.cases`]: Array.from({ length: CASES_PAGE }, (_, i) => view(i + 1, {})) });
    expect(await readAllCases(rpc)).toHaveLength(CASES_PAGE * MAX_CASE_PAGES);
    expect(rpc.view).toHaveBeenCalledTimes(MAX_CASE_PAGES);
  });
});

describe("agent page", () => {
  it("shows the verdict line, the record strip and the account's cases newest first", async () => {
    renderAt(`/app/agent/${SELLER}`, <AgentPage />, pagedRpc(SELLER_CASES));
    expect(screen.getByRole("heading", { level: 1, name: SELLER })).toBeInTheDocument();
    expect(await screen.findByText("Won 1 of 2 settled cases; did not answer 1 case.")).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: "Court record" });
    expect(statValue(strip, "Win rate")).toBe("50%");
    expect(statValue(strip, "Cases")).toBe("3");
    expect(statValue(strip, "Open")).toBe("1");
    expect(statValue(strip, "Did not respond")).toBe("1");
    expect(statValue(strip, "Named as counterparty")).toBe("2");
    const list = screen.getByRole("list", { name: `Cases of ${SELLER}` });
    const caseLinks = within(list).getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/app/case/"));
    expect(caseLinks.map((a) => a.getAttribute("href"))).toEqual(["/app/case/4", "/app/case/2", "/app/case/1"]);
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Open")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Won")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Lost")).toBeInTheDocument();
    expect(screen.queryByText("Not about the seller")).toBeNull();
  });

  it("says so when the account has no cases", async () => {
    renderAt("/app/agent/fresh-agent.testnet", <AgentPage />, pagedRpc(SELLER_CASES));
    expect(await screen.findByText("No cases yet. An agent with no record has not been tested in this court.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Court record" })).toBeNull();
  });

  it("shows the not-found page for an account id NEAR would refuse", () => {
    const rpc = fakeNearRpc({});
    renderAt("/app/agent/Not..An_Account!", <AgentPage />, rpc);
    expect(screen.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeInTheDocument();
    expect(rpc.view).not.toHaveBeenCalled();
  });

  it("says when the court cannot be read", async () => {
    renderAt(`/app/agent/${SELLER}`, <AgentPage />, fakeNearRpc({}));
    expect(await screen.findByText(/Could not read the court contract/)).toBeInTheDocument();
  });
});

describe("links to agent records", () => {
  it("links both parties on the case page to their records", async () => {
    const c = SELLER_CASES[1]!;
    const rpc = fakeNearRpc({
      [`${NEAR_COURT_CONTRACT}.get_case`]: c,
      [`${NEAR_COURT_CONTRACT}.config`]: { owner: "o.testnet", oracle: NEAR_ORACLE_CONTRACT, arbiter: "psephex.testnet", min_stake: "1", appeal_bond: "1", response_window_sec: 1, appeal_window_sec: 1, answer_timeout_sec: 1, max_field_bytes: 400, last_case_id: 4 },
      [`${NEAR_COURT_CONTRACT}.question_for`]: "q",
    });
    renderAt("/app/case/2", <CasePage />, rpc);
    await screen.findByRole("heading", { level: 1, name: "Logo the buyer calls ugly" });
    for (const account of [BUYER, SELLER]) {
      const links = screen.getAllByRole("link", { name: account });
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) expect(a).toHaveAttribute("href", `/app/agent/${account}`);
    }
    await userEvent.click(screen.getAllByRole("link", { name: SELLER })[0]!);
    expect(screen.getByTestId("where")).toHaveTextContent(`/app/agent/${SELLER}`);
  });

  it("opens an agent record from the Check an agent box and refuses a bad account", async () => {
    renderAt("/app", <AgentLookup />, fakeNearRpc({}));
    const box = screen.getByRole("textbox", { name: "Check an agent" });
    await userEvent.type(box, "not an account{Enter}");
    expect(screen.getByText(/Enter a NEAR account/)).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/app");
    await userEvent.clear(box);
    await userEvent.type(box, `  ${SELLER.toUpperCase()} `);
    await userEvent.click(screen.getByRole("button", { name: /Show record/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/app/agent/${SELLER}`));
  });
});
