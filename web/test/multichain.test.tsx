import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { keccak256, stringToBytes } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createApi, requestDetailSchema, type Api, type RequestDetail } from "../src/api.js";
import { ChainBadge } from "../src/components/ChainBadge.js";
import { explorer, NEAR_COURT_CONTRACT, NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT } from "../src/deployment.js";
import { BASE } from "../src/evm-chains.js";
import { ApiProvider } from "../src/hooks.js";
import { describeNearError, formatNear, roundedAmount, parseNear } from "../src/lib/near-dispute.js";
import { statusLabel } from "../src/lib/status.js";
import { deriveProgress, stepOrder } from "../src/lib/steps.js";
import { caseInfoFrom, checkNearPrices, type NearCase } from "../src/near/hooks.js";
import { createNearRpc, NearRpcProvider, parseTxStatus, type NearRpc } from "../src/near/rpc.js";
import { NearWalletContext, type NearWallet } from "../src/near/wallet.js";
import { DisputeForm } from "../src/pages/DisputeForm.js";
import { RequestPage, stepLinks } from "../src/pages/RequestPage.js";
import { dataOf, evidence } from "./fixtures.js";
import { fakeNearRpc, fakeNearWallet } from "./near-fakes.js";

const NEAR_TX = "8kQ5dRw2kCzJYZ3XUjbYRLVhP8nHkDqzxBGh9qGJxR1q";
const YOCTO = 10n ** 24n;
const MIN_STAKE = YOCTO / 10n;
const ASK = 5n * 10n ** 21n;
const STORAGE = 7n * 10n ** 21n;

function nearDetail(over: Partial<RequestDetail> = {}): RequestDetail {
  const d = requestDetailSchema.parse(dataOf("request-7.json"));
  return {
    ...d,
    id: 4,
    source: "near",
    chain: "near:testnet",
    requester: NEAR_DISPUTE_CONTRACT,
    origin: null,
    askedTx: NEAR_TX,
    base: [],
    near: [{ txHash: "G5gJkHDzeScQKAcQXFpnApqx1H3TuqYeLeYxLSaQ5sLZ", nonce: 1, ok: true, createdAt: d.createdAt }],
    ...over,
  };
}

function nearCase(over: Partial<NearCase> = {}): NearCase {
  return {
    claimant: "alice.testnet",
    counterparty: "bob.testnet",
    amount: (YOCTO / 5n).toString(),
    oracle_deposit: ASK.toString(),
    deadline_ns: "4000000000000000000",
    question: "q",
    escalated: false,
    settled: false,
    winner: null,
    ...over,
  };
}

function apiWith(files: Readonly<Record<string, unknown>>): Api {
  const fetchImpl = vi.fn(async (url: string) => {
    const body = files[url.replace("https://api.test", "")];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404 });
  });
  return createApi("https://api.test", fetchImpl as unknown as typeof fetch);
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderNear(node: ReactNode, { path, wallet, rpc, api = apiWith({}) }: { path: string; wallet: NearWallet; rpc: NearRpc; api?: Api }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ApiProvider value={api}>
      <QueryClientProvider client={client}>
        <NearRpcProvider value={rpc}>
          <NearWalletContext.Provider value={wallet}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
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
  [`${NEAR_COURT_CONTRACT}.config`]: { oracle: NEAR_ORACLE_CONTRACT, arbiter: "psephex.testnet", min_stake: MIN_STAKE.toString(), appeal_bond: MIN_STAKE.toString(), response_window_sec: 120, appeal_window_sec: 120, answer_timeout_sec: 900, arbitration_window_sec: 3600, max_field_bytes: 400, last_case_id: 0 },
  [`${NEAR_ORACLE_CONTRACT}.ask_deposit`]: ASK.toString(),
  [`${NEAR_COURT_CONTRACT}.storage_deposit`]: STORAGE.toString(),
};

describe("chain picker", () => {
  it("defaults to NEAR testnet and hides Arbitrum when its addresses are unset", () => {
    renderNear(<DisputeForm arbitrum={null} />, { path: "/app/new", wallet: fakeNearWallet(), rpc: fakeNearRpc(PRICES) });
    const picker = screen.getByRole("group", { name: "Chain" });
    const radios = within(picker).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["near", "base"]);
    expect(within(picker).getByRole("radio", { name: /NEAR testnet/ })).toBeChecked();
    expect(screen.getByText(/Arbitrum Sepolia is not configured/)).toBeInTheDocument();
    expect(screen.getByLabelText("Counterparty account")).toHaveAttribute("placeholder", "seller-agent.testnet");
  });

  it("offers Arbitrum Sepolia as a third chain once it is configured", () => {
    const arbitrum = { ...BASE, source: "arbitrum" as const };
    renderNear(<DisputeForm arbitrum={arbitrum} />, { path: "/app/new", wallet: fakeNearWallet(), rpc: fakeNearRpc(PRICES) });
    const picker = screen.getByRole("group", { name: "Chain" });
    expect(within(picker).getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(["near", "base", "arbitrum"]);
    expect(within(picker).getByRole("radio", { name: /Arbitrum Sepolia/ })).not.toBeChecked();
    expect(screen.queryByText(/not configured/)).toBeNull();
  });
});

describe("NEAR amounts", () => {
  it("parses and formats NEAR amounts exactly", () => {
    expect(formatNear(MIN_STAKE + ASK + STORAGE)).toBe("0.112");
    expect(parseNear("0.1")).toBe(MIN_STAKE);
    expect(parseNear("1.0000000000000000000000001")).toBeNull();
    expect(parseNear("-1")).toBeNull();
  });

  it("rounds amounts shown after a payout and keeps exact ones exact", () => {
    expect(roundedAmount(21309999999999996000000n, 24, "NEAR")).toBe("about 0.02131 NEAR");
    expect(roundedAmount(10n ** 23n, 24, "NEAR")).toBe("0.1 NEAR");
    expect(roundedAmount(10n ** 15n, 18, "ETH")).toBe("0.001 ETH");
    expect(roundedAmount(1n, 18, "ETH")).toBe("about 0 ETH");
  });

  it("refuses deposits from the RPC outside the contract limits", () => {
    const near = 10n ** 24n;
    expect(checkNearPrices({ askDeposit: near / 100n, storageDeposit: near / 1000n })).toEqual({ askDeposit: near / 100n, storageDeposit: near / 1000n });
    expect(() => checkNearPrices({ askDeposit: 2n * near, storageDeposit: 0n })).toThrow(/oracle deposit outside/);
    expect(() => checkNearPrices({ askDeposit: 0n, storageDeposit: 0n })).toThrow(/oracle deposit outside/);
    expect(() => checkNearPrices({ askDeposit: near / 100n, storageDeposit: near })).toThrow(/storage deposit outside/);
  });

  it("tells an unknown account apart from an RPC failure", async () => {
    const unknown = vi.fn(async () => new Response(JSON.stringify({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } }), { status: 200 }));
    expect(await createNearRpc("https://rpc.test", unknown as unknown as typeof fetch).accountExists("nobody.testnet")).toBe(false);
    const known = vi.fn(async () => new Response(JSON.stringify({ result: { amount: "1" } }), { status: 200 }));
    expect(await createNearRpc("https://rpc.test", known as unknown as typeof fetch).accountExists("bob.testnet")).toBe(true);
    const broken = vi.fn(async () => new Response(JSON.stringify({ error: { name: "INTERNAL_ERROR", message: "boom" } }), { status: 200 }));
    await expect(createNearRpc("https://rpc.test", broken as unknown as typeof fetch).accountExists("bob.testnet")).rejects.toThrow(/boom/);
  });

  it("turns wallet errors into plain messages", () => {
    expect(describeNearError(new Error("Smart contract panicked: stake too low: 1 yoctoNEAR, min 2"))).toMatch(/below the minimum/);
    expect(describeNearError(new Error("User closed the window"))).toMatch(/closed the wallet/);
    expect(describeNearError(new Error("Popup window blocked. Please allow popups for this site."))).toMatch(/blocked the wallet window/);
    expect(describeNearError("something else")).toMatch(/NEAR transaction failed/);
  });
});

describe("NEAR RPC", () => {
  it("encodes view arguments as UTF-8 base64 and decodes the result bytes", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { params: { args_base64: string; method_name: string } };
      const args = new TextDecoder().decode(Uint8Array.from(atob(body.params.args_base64), (c) => c.charCodeAt(0)));
      expect(JSON.parse(args)).toEqual({ question: "Ist das grün?" });
      return new Response(JSON.stringify({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify("123"))) } }), { status: 200 });
    });
    const rpc = createNearRpc("https://rpc.test", fetchImpl as unknown as typeof fetch);
    expect(await rpc.view<string>(NEAR_ORACLE_CONTRACT, "ask_deposit", { question: "Ist das grün?" })).toBe("123");
  });

  it("raises contract errors from a view", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: { error: "wasm execution failed with error: MethodNotFound" } }), { status: 200 }));
    await expect(createNearRpc("https://rpc.test", fetchImpl as unknown as typeof fetch).view("x.testnet", "nope", {})).rejects.toThrow(/MethodNotFound/);
  });

  it("reads the request id from the final transaction status", async () => {
    expect(parseTxStatus({ SuccessValue: btoa("4") })).toEqual({ ok: true, value: 4 });
    expect(parseTxStatus({ SuccessValue: btoa("null") })).toEqual({ ok: true, value: null });
    expect(parseTxStatus({ SuccessValue: "" })).toEqual({ ok: true, value: null });
    expect(parseTxStatus({ Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: stake too low" } } } } })).toEqual({ ok: false, error: "Smart contract panicked: stake too low" });
    expect(parseTxStatus("NotStarted").ok).toBe(false);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: { status: { SuccessValue: btoa("9") } } }), { status: 200 }));
    expect(await createNearRpc("https://rpc.test", fetchImpl as unknown as typeof fetch).txResult(NEAR_TX, "alice.testnet")).toEqual({ ok: true, value: 9 });
  });
});

describe("chain badge and explorer links", () => {
  it("names each chain for screen readers", () => {
    render(
      <>
        <ChainBadge source="near" />
        <ChainBadge source="base" />
        <ChainBadge source="arbitrum" />
      </>,
    );
    for (const name of ["NEAR testnet", "Base Sepolia", "Arbitrum Sepolia"]) expect(screen.getByText(name)).toHaveClass("sr-only");
  });

  it("builds explorer links per chain from well-formed values only", () => {
    const evmTx = `0x${"ab".repeat(32)}`;
    expect(explorer.tx("near", NEAR_TX)).toBe(`https://testnet.nearblocks.io/txns/${NEAR_TX}`);
    expect(explorer.tx("base", evmTx)).toBe(`https://sepolia.basescan.org/tx/${evmTx}`);
    expect(explorer.tx("arbitrum", evmTx)).toBe(`https://sepolia.arbiscan.io/tx/${evmTx}`);
    expect(explorer.tx("near", evmTx)).toBeNull();
    expect(explorer.tx("arbitrum", NEAR_TX)).toBeNull();
    expect(explorer.address("near", "dispute.psephex.testnet")).toBe("https://testnet.nearblocks.io/address/dispute.psephex.testnet");
    expect(explorer.address("near", "../evil")).toBeNull();
    expect(explorer.address("arbitrum", `0x${"12".repeat(20)}`)).toMatch(/^https:\/\/sepolia\.arbiscan\.io\/address\/0x/);
  });

  it("links each step of a NEAR request to Nearblocks", () => {
    render(<>{Object.values(stepLinks(nearDetail()))}</>);
    expect(screen.getByRole("link", { name: "Ask transaction on Nearblocks" })).toHaveAttribute("href", `https://testnet.nearblocks.io/txns/${NEAR_TX}`);
    expect(screen.getByRole("link", { name: "NEAR transaction on Nearblocks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Basescan/ })).toBeNull();
  });

  it("links an Arbitrum request to Arbiscan", () => {
    const d = requestDetailSchema.parse(dataOf("request-7.json"));
    render(<>{Object.values(stepLinks({ ...d, source: "arbitrum", chain: "eip155:421614" }))}</>);
    expect(screen.getByRole("link", { name: "Ask transaction on Arbiscan" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/sepolia\.arbiscan\.io\/tx\//));
    expect(screen.getByRole("link", { name: "Answer transaction on Arbiscan" })).toBeInTheDocument();
  });
});

describe("NEAR path", () => {
  it("asks, answers, checks and stores on NEAR, with no MPC or Base step", () => {
    expect(stepOrder("near")).toEqual(["asked", "models", "near", "stored"]);
    const p = deriveProgress({ detail: nearDetail(), caseInfo: null });
    expect(p.steps.map((s) => s.title)).toEqual(["Question asked on NEAR", "Three models answer in TEEs", "NEAR checks signatures and 2 of 3", "Verdict stored on NEAR"]);
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
    const waiting = deriveProgress({ detail: nearDetail({ status: "verified", near: [] }), caseInfo: null });
    expect(waiting.steps.map((s) => s.state)).toEqual(["done", "done", "done", "active"]);
    expect(statusLabel("confirmed", "near")).toBe("Answered on NEAR");
    expect(statusLabel("confirmed", "arbitrum")).toBe("Answered on Arbitrum");
  });

  it("keeps the five EVM steps named after the chain", () => {
    const d = requestDetailSchema.parse(dataOf("request-7.json"));
    expect(deriveProgress({ detail: { ...d, source: "arbitrum" }, caseInfo: null }).steps.map((s) => s.title)).toEqual([
      "Question recorded on Arbitrum",
      "Three models answer in TEEs",
      "NEAR checks signatures and 2 of 3",
      "NEAR MPC signs the Arbitrum transaction",
      "Answer delivered on Arbitrum",
    ]);
  });
});

describe("NEAR request page", () => {
  const question = nearDetail().question;
  const views = (c: NearCase | null) => ({
    [`${NEAR_DISPUTE_CONTRACT}.get_case`]: c,
    [`${NEAR_ORACLE_CONTRACT}.near_request`]: { question_hash: keccak256(stringToBytes(question)) },
  });
  const api = (d: RequestDetail) => apiWith({ "/requests/near/4": { data: d }, "/requests/near/4/verify": evidence("verify-7.json") });

  it("shows the NEAR verdict, the four steps and the stake paid in NEAR", async () => {
    const rpc = fakeNearRpc(views(nearCase({ settled: true, winner: "bob.testnet" })));
    renderNear(<RequestPage />, { path: "/app/r/near/4", wallet: fakeNearWallet(), rpc, api: api(nearDetail()) });
    expect(await screen.findByRole("heading", { level: 1, name: question })).toBeInTheDocument();
    expect(await screen.findByText("NO. 0.2 NEAR went to the counterparty bob.testnet.")).toBeInTheDocument();
    expect(screen.getAllByText("(done)")).toHaveLength(4);
    expect(screen.getByText("This text matches the question hash stored on NEAR.")).toBeInTheDocument();
    expect(screen.getByText("NEAR testnet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
    expect(rpc.view).toHaveBeenCalledWith(NEAR_DISPUTE_CONTRACT, "get_case", { request_id: 4 });
  });

  it("offers the refund when get_case says escalated and sends it from the NEAR wallet", async () => {
    const wallet = fakeNearWallet({ accountId: "carol.testnet" });
    const rpc = fakeNearRpc(views(nearCase({ escalated: true })), { ok: true, value: null });
    renderNear(<RequestPage />, { path: "/app/r/near/4", wallet, rpc, api: api(nearDetail({ answer: "UNKNOWN" })) });
    expect(await screen.findByText(/UNKNOWN\. The models could not decide, so the claimant can take back 0\.2 NEAR now/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Refund the stake to the claimant" }));
    expect(wallet.call).toHaveBeenCalledWith({ receiverId: NEAR_DISPUTE_CONTRACT, methodName: "refund", args: { request_id: 4 }, gas: 30n * 10n ** 12n, deposit: 0n });
  });

  it("offers the refund after the deadline of an unsettled case and asks to connect", async () => {
    const rpc = fakeNearRpc(views(nearCase({ deadline_ns: "1000000000" })));
    renderNear(<RequestPage />, { path: "/app/r/near/4", wallet: fakeNearWallet(), rpc, api: api(nearDetail({ status: "failed", reason: "stuck in answering", answer: null, votes: null, near: [] })) });
    expect(await screen.findByRole("button", { name: "Refund the stake to the claimant" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect NEAR wallet" })).toBeInTheDocument();
    expect(caseInfoFrom(nearCase({ deadline_ns: "1000000000" })).deadline).toBe(1n);
  });

  it("says when there is no NEAR request with this number yet", async () => {
    renderNear(<RequestPage />, { path: "/app/r/near/42", wallet: fakeNearWallet(), rpc: fakeNearRpc(views(null)) });
    expect(await screen.findByRole("heading", { level: 1, name: "No request with this number yet" })).toBeInTheDocument();
  });

  it("rejects an unknown source", () => {
    renderNear(<RequestPage />, { path: "/app/r/solana/4", wallet: fakeNearWallet(), rpc: fakeNearRpc({}) });
    expect(screen.getByText(/There is no request with this number/)).toBeInTheDocument();
  });
});
