import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { keccak256, stringToBytes } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createApi, requestDetailSchema, type Api } from "../src/api.js";
import { NEAR_COURT_CONTRACT, NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT, nearAccountOr } from "../src/deployment.js";
import { ApiProvider } from "../src/hooks.js";
import {
  arbiterCommand,
  ASKING_GAS,
  availableActions,
  caseDepositTotal,
  caseTimeline,
  countdown,
  describeCourtError,
  fieldError,
  OPEN_CASE_GAS,
  oneLine,
  quotedBytes,
  SETTLE_GAS,
  validateCase,
  WORST_CASE_QUESTION,
  type CourtCase,
} from "../src/lib/court.js";
import { NearRpcProvider, type NearRpc } from "../src/near/rpc.js";
import { NearWalletContext, type NearWallet } from "../src/near/wallet.js";
import { CasePage } from "../src/pages/CasePage.js";
import { DisputeForm } from "../src/pages/DisputeForm.js";
import { RecentCases } from "../src/pages/RecentCases.js";
import { RequestPage } from "../src/pages/RequestPage.js";
import { dataOf } from "./fixtures.js";
import { fakeNearRpc, fakeNearWallet } from "./near-fakes.js";

const YOCTO = 10n ** 24n;
const MIN_STAKE = YOCTO / 10n;
const BOND = YOCTO / 2n;
const RESERVE = 21n * 10n ** 21n;
const STORAGE = 23n * 10n ** 21n;
const NOW_NS = BigInt(Date.now()) * 1_000_000n;
const HOUR_NS = 3_600n * 1_000_000_000n;
const FUTURE = (NOW_NS + HOUR_NS).toString();
const PAST = (NOW_NS - HOUR_NS).toString();
const ARBITER = "psephex.testnet";

const CONFIG = {
  owner: "psephex.testnet",
  oracle: NEAR_ORACLE_CONTRACT,
  arbiter: ARBITER,
  min_stake: MIN_STAKE.toString(),
  appeal_bond: (BOND * 2n).toString(),
  response_window_sec: 120,
  appeal_window_sec: 120,
  answer_timeout_sec: 900,
  arbitration_window_sec: 3600,
  max_field_bytes: 400,
  last_case_id: 3,
};

function courtCase(over: Partial<CourtCase> = {}): CourtCase {
  return {
    claimant: "buyer-agent.testnet",
    counterparty: "seller-agent.testnet",
    amount: MIN_STAKE.toString(),
    oracle_reserve: RESERVE.toString(),
    oracle_paid: null,
    claim: "The seller agent delivered 60 of the 100 rows I paid for.",
    evidence: "Order: 100 rows. companies.csv has 60 data rows.",
    response: null,
    stage: "awaiting_response",
    opened_ns: PAST,
    respond_by_ns: FUTURE,
    asked_ns: null,
    request_id: null,
    answer_by_ns: null,
    verdict: null,
    appeal_by_ns: null,
    appeal_bond: "0",
    appellant: null,
    arbiter: null,
    arbitrate_by_ns: null,
    winner: null,
    ...over,
  };
}

const DECIDED = courtCase({ stage: "decided", response: "Only 60 matched the filter.", request_id: 12, asked_ns: PAST, answer_by_ns: PAST, verdict: "YES", appeal_by_ns: FUTURE, appeal_bond: BOND.toString(), oracle_paid: "1" });

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderCourt(node: ReactNode, { path, wallet = fakeNearWallet(), rpc, api }: { path: string; wallet?: NearWallet; rpc: NearRpc; api?: Api }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fallbackApi = createApi("https://api.test", vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404 })) as unknown as typeof fetch);
  return render(
    <ApiProvider value={api ?? fallbackApi}>
      <QueryClientProvider client={client}>
        <NearRpcProvider value={rpc}>
          <NearWalletContext.Provider value={wallet}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/app/case/:id" element={node} />
                <Route path="/app/r/:source/:id" element={node} />
                <Route path="*" element={node} />
              </Routes>
              <Where />
            </MemoryRouter>
          </NearWalletContext.Provider>
        </NearRpcProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
}

const PRICES = {
  [`${NEAR_COURT_CONTRACT}.config`]: CONFIG,
  [`${NEAR_ORACLE_CONTRACT}.ask_deposit`]: RESERVE.toString(),
  [`${NEAR_COURT_CONTRACT}.storage_deposit`]: STORAGE.toString(),
};

function caseViews(c: CourtCase | null) {
  return { [`${NEAR_COURT_CONTRACT}.config`]: CONFIG, [`${NEAR_COURT_CONTRACT}.get_case`]: c, [`${NEAR_COURT_CONTRACT}.question_for`]: "Two parties dispute a deal. Claim by buyer-agent.testnet: \"…\"" };
}

const CTX = { nowNs: NOW_NS, config: { arbiter: ARBITER, appealBond: BOND * 2n, answerTimeoutSec: 900 } };

describe("court deposit", () => {
  it("adds the stake, the worst-case oracle reserve and the storage", () => {
    expect(caseDepositTotal({ stake: MIN_STAKE, oracleReserve: RESERVE, storageDeposit: STORAGE })).toBe(MIN_STAKE + RESERVE + STORAGE);
    expect(new TextEncoder().encode(WORST_CASE_QUESTION).length).toBe(2000);
  });

  it("prices the reserve for a 2000-byte question and opens the case with 100 Tgas", async () => {
    const user = userEvent.setup();
    const wallet = fakeNearWallet({ accountId: "buyer-agent.testnet" });
    const rpc = fakeNearRpc(PRICES, { ok: true, value: 4 });
    renderCourt(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet, rpc });
    await user.click(screen.getByRole("button", { name: /Dataset short by 40 rows/ }));
    await user.type(screen.getByLabelText("Counterparty account"), "seller-agent.testnet");
    expect(await screen.findByText(/You attach/)).toHaveTextContent("You attach 0.144 NEAR: the stake, a 0.021 NEAR oracle reserve and 0.023 NEAR for storing the case.");
    expect(screen.getByText(/comes back to you when the case goes to the oracle/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open the case" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Open the case" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/app/case/4"));
    expect(rpc.view).toHaveBeenCalledWith(NEAR_ORACLE_CONTRACT, "ask_deposit", { question: WORST_CASE_QUESTION });
    expect(wallet.call).toHaveBeenCalledWith({
      receiverId: NEAR_COURT_CONTRACT,
      methodName: "open_case",
      args: { claim: expect.stringContaining("60 rows"), evidence: expect.stringContaining("100 rows"), counterparty: "seller-agent.testnet", oracle_reserve: RESERVE.toString() },
      gas: OPEN_CASE_GAS,
      deposit: MIN_STAKE + RESERVE + STORAGE,
    });
    expect(OPEN_CASE_GAS).toBe(100n * 10n ** 12n);
  });

  it("stops before signing when the counterparty account does not exist", async () => {
    const user = userEvent.setup();
    const wallet = fakeNearWallet({ accountId: "buyer-agent.testnet" });
    renderCourt(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet, rpc: fakeNearRpc(PRICES, { ok: true, value: 4 }, ["buyer-agent.testnet"]) });
    await user.click(screen.getByRole("button", { name: /Translation delivered late/ }));
    await user.type(screen.getByLabelText("Counterparty account"), "se11er.testnet");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open the case" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Open the case" }));
    expect(await screen.findByText(/se11er.testnet does not exist on NEAR testnet/)).toBeInTheDocument();
    expect(wallet.call).not.toHaveBeenCalled();
  });

  it("asks again instead of signing when the deposit changed after it was shown", async () => {
    const user = userEvent.setup();
    const wallet = fakeNearWallet({ accountId: "buyer-agent.testnet" });
    const rpc = fakeNearRpc(PRICES);
    renderCourt(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet, rpc });
    await user.click(screen.getByRole("button", { name: /Logo the buyer calls ugly/ }));
    await user.type(screen.getByLabelText("Counterparty account"), "seller-agent.testnet");
    await screen.findByText(/You attach/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open the case" })).toBeEnabled());
    rpc.view.mockImplementation(async (contract: string, method: string) => (method === "ask_deposit" ? (RESERVE * 2n).toString() : (PRICES as Record<string, unknown>)[`${contract}.${method}`]));
    await user.click(screen.getByRole("button", { name: "Open the case" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/The deposit changed to/);
    expect(wallet.call).not.toHaveBeenCalled();
  });

  it("connects the NEAR wallet first when no account is signed in", async () => {
    const wallet = fakeNearWallet();
    renderCourt(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet, rpc: fakeNearRpc(PRICES) });
    await userEvent.click(screen.getByRole("button", { name: "Connect NEAR to open" }));
    expect(wallet.connect).toHaveBeenCalled();
  });
});

describe("court byte limits", () => {
  it("counts the JSON-quoted form, so quotes and backslashes count twice", () => {
    expect(quotedBytes("abc")).toBe(5);
    expect(quotedBytes("")).toBe(2);
    expect(quotedBytes('a"b')).toBe(6);
    expect(quotedBytes("grün")).toBe(7);
    expect(fieldError("claim", "x".repeat(398), 400)).toBeNull();
    expect(fieldError("claim", "x".repeat(399), 400)).toBe("The claim is 401 bytes; the limit is 400.");
    expect(fieldError("claim", '"'.repeat(199), 400)).toBeNull();
    expect(fieldError("claim", '"'.repeat(200), 400)).toBe("The claim is 402 bytes; the limit is 400.");
  });

  it("refuses control characters and turns typed line breaks into spaces", () => {
    expect(fieldError("evidence", "line one\nline two", 400)).toMatch(/one line/);
    expect(oneLine("a\nb\tc\r\nd")).toBe("a b c d");
    expect(validateCase({ claim: "c", evidence: "e", counterparty: "Seller.testnet", stakeNear: "0.1" }, { minStake: MIN_STAKE, maxFieldBytes: 400 }, "buyer.testnet")).toEqual({
      ok: true,
      value: { claim: "c", evidence: "e", counterparty: "seller.testnet", stake: MIN_STAKE },
    });
    const bad = validateCase({ claim: "", evidence: "x".repeat(500), counterparty: "buyer.testnet", stakeNear: "0.01" }, { minStake: MIN_STAKE, maxFieldBytes: 400 }, "buyer.testnet");
    expect(bad.ok ? null : Object.keys(bad.errors).sort()).toEqual(["claim", "counterparty", "evidence", "stake"]);
  });

  it("shows the byte counter and keeps a pasted line break out of the claim", async () => {
    const user = userEvent.setup();
    renderCourt(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet: fakeNearWallet({ accountId: "buyer-agent.testnet" }), rpc: fakeNearRpc(PRICES) });
    const claim = screen.getByLabelText("Claim") as HTMLTextAreaElement;
    await user.type(claim, 'say "hi"{Enter}x');
    expect(claim.value).toBe('say "hi" x');
    expect(await screen.findByText(/^14 of 400 bytes/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your evidence"), "x".repeat(420));
    expect(screen.getByText(/^422 of 400 bytes/)).toHaveClass("text-no");
  });
});

describe("role-aware actions", () => {
  it("offers Respond only to the counterparty inside the window, and Submit to anyone after it", () => {
    const open = courtCase();
    expect(availableActions(open, 3, { ...CTX, account: "seller-agent.testnet" }).map((a) => a.kind)).toEqual(["respond"]);
    expect(availableActions(open, 3, { ...CTX, account: "stranger.testnet" })).toEqual([]);
    expect(availableActions(open, 3, { ...CTX, account: "buyer-agent.testnet" })).toEqual([]);
    const late = courtCase({ respond_by_ns: PAST });
    expect(availableActions(late, 3, { ...CTX, account: "stranger.testnet" })).toEqual([{ kind: "submit", args: { case_id: 3 }, deposit: 0n, gas: ASKING_GAS }]);
    expect(availableActions(late, 3, { ...CTX, account: null }).map((a) => a.kind)).toEqual(["submit"]);
    expect(ASKING_GAS).toBe(150n * 10n ** 12n);
  });

  it("offers Appeal to a party with the case's own bond, never to a stranger or when the arbiter is a party", () => {
    expect(availableActions(DECIDED, 3, { ...CTX, account: "seller-agent.testnet" })).toEqual([{ kind: "appeal", args: { case_id: 3 }, deposit: BOND, gas: SETTLE_GAS }]);
    expect(availableActions(DECIDED, 3, { ...CTX, account: "stranger.testnet" })).toEqual([]);
    expect(availableActions(DECIDED, 3, { ...CTX, account: "buyer-agent.testnet", config: { ...CTX.config, arbiter: "buyer-agent.testnet" } })).toEqual([]);
  });

  it("offers Finalize to anyone after the appeal window, and after a silent arbiter", () => {
    const closed = { ...DECIDED, appeal_by_ns: PAST };
    expect(availableActions(closed, 3, { ...CTX, account: "stranger.testnet" }).map((a) => a.kind)).toEqual(["finalize"]);
    const appealed = { ...DECIDED, stage: "appealed" as const, appellant: "seller-agent.testnet", arbiter: ARBITER, arbitrate_by_ns: FUTURE };
    expect(availableActions(appealed, 3, { ...CTX, account: "stranger.testnet" })).toEqual([]);
    expect(availableActions({ ...appealed, arbitrate_by_ns: PAST }, 3, { ...CTX, account: null }).map((a) => a.kind)).toEqual(["finalize"]);
  });

  it("offers Refund when the verdict is late and when the question never reached the oracle", () => {
    const waiting = courtCase({ stage: "awaiting_verdict", request_id: 12, asked_ns: PAST, answer_by_ns: FUTURE });
    expect(availableActions(waiting, 3, { ...CTX, account: null })).toEqual([]);
    expect(availableActions({ ...waiting, answer_by_ns: PAST }, 3, { ...CTX, account: null }).map((a) => a.kind)).toEqual(["refund"]);
    const stuck = courtCase({ stage: "asking", asked_ns: (NOW_NS - 901n * 1_000_000_000n).toString() });
    expect(availableActions(stuck, 3, { ...CTX, account: null }).map((a) => a.kind)).toEqual(["refund"]);
    expect(availableActions({ ...stuck, asked_ns: PAST }, 3, { ...CTX, account: null, config: { ...CTX.config, answerTimeoutSec: 7200 } })).toEqual([]);
  });

  it("shows the counterparty a Respond box and sends respond with 150 Tgas", async () => {
    const user = userEvent.setup();
    const wallet = fakeNearWallet({ accountId: "seller-agent.testnet" });
    renderCourt(<CasePage />, { path: "/app/case/3", wallet, rpc: fakeNearRpc(caseViews(courtCase()), { ok: true, value: 12 }) });
    expect(await screen.findByRole("heading", { level: 1, name: /delivered 60 of the 100 rows/ })).toBeInTheDocument();
    expect(screen.getByText("No response yet.")).toBeInTheDocument();
    expect(screen.getByText("You are the counterparty.")).toBeInTheDocument();
    expect(screen.getByText("Response window").nextSibling).toHaveTextContent(/min .* s left/);
    await user.type(screen.getByLabelText("Your response and evidence"), "Only 60 matched.");
    expect(screen.getByText(/respond \{"case_id":3,"response":"Only 60 matched\."\}, deposit 0 NEAR, 150 Tgas/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send the response" }));
    expect(wallet.call).toHaveBeenCalledWith({ receiverId: NEAR_COURT_CONTRACT, methodName: "respond", args: { case_id: 3, response: "Only 60 matched." }, gas: ASKING_GAS, deposit: 0n });
  });

  it("shows a stranger no action inside the window and Submit after it", async () => {
    const stranger = fakeNearWallet({ accountId: "stranger.testnet" });
    const first = renderCourt(<CasePage />, { path: "/app/case/3", wallet: stranger, rpc: fakeNearRpc(caseViews(courtCase())) });
    expect(await screen.findByText("You are not a party to this case.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    first.unmount();
    renderCourt(<CasePage />, { path: "/app/case/3", wallet: stranger, rpc: fakeNearRpc(caseViews(courtCase({ respond_by_ns: PAST }))) });
    await userEvent.click(await screen.findByRole("button", { name: "Send to the oracle without a response" }));
    expect(stranger.call).toHaveBeenCalledWith({ receiverId: NEAR_COURT_CONTRACT, methodName: "submit", args: { case_id: 3 }, gas: ASKING_GAS, deposit: 0n });
  });

  it("lets a party appeal with exactly the bond of the case", async () => {
    const wallet = fakeNearWallet({ accountId: "seller-agent.testnet" });
    renderCourt(<CasePage />, { path: "/app/case/3", wallet, rpc: fakeNearRpc(caseViews(DECIDED)) });
    expect(await screen.findByText(/You attach exactly 0\.5 NEAR as a bond/)).toBeInTheDocument();
    expect(screen.getByText("Only 60 matched the filter.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See how the oracle answered request #12" })).toHaveAttribute("href", "/app/r/near/12");
    await userEvent.click(screen.getByRole("button", { name: "Appeal to the arbiter" }));
    expect(wallet.call).toHaveBeenCalledWith({ receiverId: NEAR_COURT_CONTRACT, methodName: "appeal", args: { case_id: 3 }, gas: SETTLE_GAS, deposit: BOND });
  });

  it("lets anyone finalize after the appeal window", async () => {
    const wallet = fakeNearWallet({ accountId: "stranger.testnet" });
    renderCourt(<CasePage />, { path: "/app/case/3", wallet, rpc: fakeNearRpc(caseViews({ ...DECIDED, appeal_by_ns: PAST })) });
    await userEvent.click(await screen.findByRole("button", { name: "Finalize and pay out" }));
    expect(wallet.call).toHaveBeenCalledWith({ receiverId: NEAR_COURT_CONTRACT, methodName: "finalize", args: { case_id: 3 }, gas: SETTLE_GAS, deposit: 0n });
    expect(screen.queryByRole("button", { name: "Appeal to the arbiter" })).toBeNull();
  });

  it("shows the exact oracle question from question_for", async () => {
    const rpc = fakeNearRpc(caseViews(DECIDED));
    renderCourt(<CasePage />, { path: "/app/case/3", rpc });
    const section = await screen.findByRole("region", { name: "The question the models get" });
    expect(await within(section).findByText(/Two parties dispute a deal/)).toBeInTheDocument();
    expect(rpc.view).toHaveBeenCalledWith(NEAR_COURT_CONTRACT, "question_for", { case_id: 3 });
    expect(rpc.view).toHaveBeenCalledWith(NEAR_COURT_CONTRACT, "get_case", { case_id: 3 });
  });
});

describe("appealed case", () => {
  const appealed: CourtCase = { ...DECIDED, stage: "appealed", appellant: "seller-agent.testnet", arbiter: ARBITER, arbitrate_by_ns: FUTURE };

  it("names the arbiter locked at appeal and shows the exact arbitrate commands", async () => {
    renderCourt(<CasePage />, { path: "/app/case/3", rpc: fakeNearRpc(caseViews(appealed)) });
    const panel = await screen.findByRole("region", { name: "The arbiter" });
    expect(panel).toHaveTextContent(`The arbiter of this appeal is ${ARBITER}`);
    expect(within(panel).getByText(`near contract call-function as-transaction ${NEAR_COURT_CONTRACT} arbitrate json-args '{"case_id":3,"winner":"claimant"}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as ${ARBITER} network-config testnet sign-with-keychain send`)).toBeInTheDocument();
    expect(within(panel).getByText(/"winner":"counterparty"/)).toBeInTheDocument();
    expect(within(panel).getAllByRole("button", { name: "Copy" })).toHaveLength(2);
    expect(screen.getByText("Arbiter must rule").nextSibling).toHaveTextContent(/h .* min left|min .* s left/);
  });

  it("refuses to build a command for an arbiter that is not a NEAR account", () => {
    expect(arbiterCommand(3, "claimant", "x; rm -rf ~")).toBeNull();
    expect(arbiterCommand(0, "claimant", ARBITER)).toBeNull();
  });

  it("walks the timeline through the appeal to the arbiter ruling", () => {
    expect(caseTimeline(appealed, NOW_NS).map((s) => [s.title, s.state])).toEqual([
      ["Opened", "done"],
      ["Response", "done"],
      ["Asked oracle", "done"],
      ["Verdict", "done"],
      ["Appeal window", "done"],
      ["Appealed", "done"],
      ["Arbiter ruling", "active"],
    ]);
    expect(caseTimeline({ ...appealed, stage: "settled", winner: "seller-agent.testnet" }, NOW_NS).at(-1)).toEqual({ key: "arbiter", title: "Arbiter ruling", state: "done", detail: "seller-agent.testnet got the stake" });
    expect(caseTimeline(courtCase({ stage: "refunded" }), NOW_NS).map((s) => s.title)).toEqual(["Opened", "Response", "Asked oracle", "Refunded"]);
    expect(caseTimeline({ ...DECIDED, stage: "settled", winner: "buyer-agent.testnet" }, NOW_NS).map((s) => s.title).at(-1)).toBe("Settled");
  });
});

describe("case list and links", () => {
  it("lists recent cases newest first from cases(from_id, limit)", async () => {
    const page = [1, 2, 3].map((id) => ({ case_id: id, ...courtCase({ claim: `Claim number ${id}` }) }));
    const rpc = fakeNearRpc({ [`${NEAR_COURT_CONTRACT}.config`]: CONFIG, [`${NEAR_COURT_CONTRACT}.cases`]: page });
    renderCourt(<RecentCases />, { path: "/app", rpc });
    const list = await screen.findByRole("list", { name: "Court cases" });
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(3));
    expect(within(list).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/app/case/3", "/app/case/2", "/app/case/1"]);
    expect(rpc.view).toHaveBeenCalledWith(NEAR_COURT_CONTRACT, "cases", { from_id: 1, limit: 10 });
  });

  it("says when there are no cases yet", async () => {
    renderCourt(<RecentCases />, { path: "/app", rpc: fakeNearRpc({ [`${NEAR_COURT_CONTRACT}.config`]: { ...CONFIG, last_case_id: 0 } }) });
    expect(await screen.findByText("No court cases yet. Open the first one.")).toBeInTheDocument();
  });

  it("links a NEAR request asked by the court back to its case", async () => {
    const d = requestDetailSchema.parse(dataOf("request-7.json"));
    const detail = { ...d, id: 12, source: "near" as const, chain: "near:testnet", requester: NEAR_COURT_CONTRACT, base: [] };
    const api = createApi("https://api.test", vi.fn(async (url: string) => (url.endsWith("/requests/near/12") ? new Response(JSON.stringify({ data: detail }), { status: 200 }) : new Response("{}", { status: 404 }))) as unknown as typeof fetch);
    const rpc = fakeNearRpc({
      [`${NEAR_DISPUTE_CONTRACT}.get_case`]: null,
      [`${NEAR_ORACLE_CONTRACT}.near_request`]: { question_hash: keccak256(stringToBytes(d.question)), asker: NEAR_COURT_CONTRACT },
      [`${NEAR_COURT_CONTRACT}.case_by_request`]: 3,
    });
    renderCourt(<RequestPage />, { path: "/app/r/near/12", rpc, api });
    expect(await screen.findByRole("link", { name: "case #3" })).toHaveAttribute("href", "/app/case/3");
    expect(rpc.view).toHaveBeenCalledWith(NEAR_COURT_CONTRACT, "case_by_request", { request_id: 12 });
  });

  it("does not ask the court about requests from other askers", async () => {
    const rpc = fakeNearRpc({ [`${NEAR_DISPUTE_CONTRACT}.get_case`]: null, [`${NEAR_ORACLE_CONTRACT}.near_request`]: { question_hash: "0x00", asker: "someone.testnet" } });
    renderCourt(<RequestPage />, { path: "/app/r/near/12", rpc });
    await waitFor(() => expect(rpc.view).toHaveBeenCalledWith(NEAR_ORACLE_CONTRACT, "near_request", { request_id: 12 }));
    expect(rpc.view).not.toHaveBeenCalledWith(NEAR_COURT_CONTRACT, "case_by_request", expect.anything());
    expect(screen.queryByRole("link", { name: /case #/ })).toBeNull();
  });

  it("says when the case does not exist yet and rejects a malformed id", async () => {
    const first = renderCourt(<CasePage />, { path: "/app/case/99", rpc: fakeNearRpc(caseViews(null)) });
    expect(await screen.findByRole("heading", { level: 1, name: "No case with this number yet" })).toBeInTheDocument();
    first.unmount();
    renderCourt(<CasePage />, { path: "/app/case/abc", rpc: fakeNearRpc({}) });
    expect(screen.getByText(/There is no case with this number/)).toBeInTheDocument();
  });
});

describe("court helpers", () => {
  it("formats countdowns and court errors", () => {
    expect(countdown(NOW_NS + 75n * 1_000_000_000n, NOW_NS)).toBe("1 min 15 s left");
    expect(countdown(NOW_NS + 2n * HOUR_NS, NOW_NS)).toBe("2 h 0 min left");
    expect(countdown(NOW_NS - 1n, NOW_NS)).toBe("ended");
    expect(describeCourtError(new Error("Smart contract panicked: attach exactly the appeal bond of this case"))).toMatch(/equal the appeal bond exactly/);
    expect(describeCourtError(new Error("Smart contract panicked: the arbiter can still rule"))).toMatch(/arbitration window/);
    expect(describeCourtError(new Error("User closed the window"))).toMatch(/closed the wallet/);
  });

  it("accepts only a NEAR account as the court override", () => {
    expect(nearAccountOr(undefined, "psephex-court.testnet")).toBe("psephex-court.testnet");
    expect(nearAccountOr(" court.testnet ", "psephex-court.testnet")).toBe("court.testnet");
    expect(() => nearAccountOr("https://evil", "psephex-court.testnet")).toThrow(/NEAR account/);
  });
});
