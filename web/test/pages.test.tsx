import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, multicall3Abi, numberToHex, parseEther, stringToBytes, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { createConfig, custom, WagmiProvider } from "wagmi";
import { mock } from "wagmi/connectors";
import { describe, expect, it, vi } from "vitest";
import { aiOracleAbi, disputeAbi } from "../src/abi.js";
import { createApi, type Api } from "../src/api.js";
import { Wallet } from "../src/components/Wallet.js";
import type { wagmiConfig } from "../src/wagmi.js";
import { AIORACLE_ADDRESS, DISPUTE_ADDRESS } from "../src/deployment.js";
import { ApiProvider } from "../src/hooks.js";
import { DisputeForm } from "../src/pages/DisputeForm.js";
import { RequestPage } from "../src/pages/RequestPage.js";
import { App } from "../src/App.js";
import { ThemeProvider } from "../src/components/theme-provider.js";
import { NearWalletContext } from "../src/near/wallet.js";
import { CLAIMANT, COUNTERPARTY, evidence } from "./fixtures.js";
import { fakeNearWallet } from "./near-fakes.js";

interface ChainCase {
  readonly escalated: boolean;
  readonly settled: boolean;
  readonly deadline: bigint;
  readonly winner?: Address;
}

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

function questionHash(id: number): Hex {
  try {
    const d = (evidence(`request-${id}.json`) as { data: { question: string } }).data;
    return keccak256(stringToBytes(d.question));
  } catch {
    return ZERO_HASH;
  }
}

function receiptFor(cases: Readonly<Record<number, ChainCase>>, hash: Hex): unknown {
  const entry = Object.entries(cases).find(([id]) => {
    try {
      const d = (evidence(`request-${id}.json`) as { data: { base: { txHash: string }[] } }).data;
      return d.base.some((t) => t.txHash.toLowerCase() === hash.toLowerCase());
    } catch {
      return false;
    }
  });
  const winner = entry?.[1].winner;
  const logs = entry && winner
    ? [
        {
          address: DISPUTE_ADDRESS,
          topics: encodeEventTopics({ abi: disputeAbi, eventName: "Settled", args: { id: BigInt(entry[0]), winner } }),
          data: encodeAbiParameters([{ type: "uint256" }], [parseEther("0.001")]),
          blockHash: `0x${"11".repeat(32)}`,
          blockNumber: "0x1",
          transactionHash: hash,
          transactionIndex: "0x0",
          logIndex: "0x0",
          removed: false,
        },
      ]
    : [];
  return {
    blockHash: `0x${"11".repeat(32)}`,
    blockNumber: "0x1",
    contractAddress: null,
    cumulativeGasUsed: "0x1",
    effectiveGasPrice: "0x1",
    from: "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F",
    gasUsed: "0x1",
    logs,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    to: AIORACLE_ADDRESS,
    transactionHash: hash,
    transactionIndex: "0x0",
    type: "0x2",
  };
}

function answerCall(cases: Readonly<Record<number, ChainCase>>, to: Address, data: Hex, hashes: Readonly<Record<number, Hex>> = {}): Hex {
  if (to.toLowerCase() === AIORACLE_ADDRESS.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: aiOracleAbi, data });
    if (functionName === "getRequest") {
      const id = Number((args as readonly [bigint])[0]);
      return encodeFunctionResult({ abi: aiOracleAbi, functionName: "getRequest", result: { requester: DISPUTE_ADDRESS, questionHash: hashes[id] ?? questionHash(id), fulfilled: true } });
    }
    const value = functionName === "fee" ? parseEther("0.0001") : 2000n;
    return encodeFunctionResult({ abi: aiOracleAbi, functionName: functionName as "fee", result: value });
  }
  if (to.toLowerCase() !== DISPUTE_ADDRESS.toLowerCase()) throw new Error(`unexpected call to ${to}`);
  const decoded = decodeFunctionData({ abi: disputeAbi, data });
  if (decoded.functionName === "minStake") return encodeFunctionResult({ abi: disputeAbi, functionName: "minStake", result: parseEther("0.001") });
  const id = Number((decoded.args as readonly [bigint])[0]);
  const c = cases[id];
  const zero = "0x0000000000000000000000000000000000000000" as Address;
  const result = c
    ? { claimant: CLAIMANT as Address, counterparty: COUNTERPARTY as Address, amount: parseEther("0.001"), deadline: c.deadline, escalated: c.escalated, settled: c.settled }
    : { claimant: zero, counterparty: zero, amount: 0n, deadline: 0n, escalated: false, settled: false };
  return encodeFunctionResult({ abi: disputeAbi, functionName: "getCase", result });
}

function chainRpc(cases: Readonly<Record<number, ChainCase>>, hashes: Readonly<Record<number, Hex>> = {}) {
  return async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    if (method === "eth_chainId") return numberToHex(baseSepolia.id);
    if (method === "eth_blockNumber") return "0x1";
    if (method === "eth_getBalance") return numberToHex(parseEther("1"));
    if (method === "eth_getTransactionReceipt") return receiptFor(cases, (params as [Hex])[0]);
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const [call] = params as [{ to: Address; data: Hex }];
    if (call.to.toLowerCase() !== baseSepolia.contracts.multicall3.address.toLowerCase()) return answerCall(cases, call.to, call.data, hashes);
    const { args } = decodeFunctionData({ abi: multicall3Abi, data: call.data });
    const calls = (args as readonly [readonly { target: Address; callData: Hex }[]])[0];
    const results = calls.map((c) => ({ success: true, returnData: answerCall(cases, c.target, c.callData, hashes) }));
    return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
  };
}

function api(): Api {
  const files: Record<string, unknown> = {
    "/requests/base/7": evidence("request-7.json"),
    "/requests/base/7/verify": evidence("verify-7.json"),
    "/requests/base/5": evidence("request-5.json"),
    "/requests/base/5/verify": evidence("verify-5.json"),
  };
  const fetchImpl = vi.fn(async (url: string) => {
    const body = files[url.replace("https://api.test", "")];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response(JSON.stringify({ error: { code: "not_found", message: "x" } }), { status: 404 });
  });
  return createApi("https://api.test", fetchImpl as unknown as typeof fetch);
}

function setup(node: ReactNode, path: string, cases: Readonly<Record<number, ChainCase>> = {}, hashes: Readonly<Record<number, Hex>> = {}) {
  const config = createConfig({
    chains: [baseSepolia],
    connectors: [mock({ accounts: [CLAIMANT as Address] })],
    transports: { [baseSepolia.id]: custom({ request: chainRpc(cases, hashes) }) },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
    <WagmiProvider config={config as unknown as typeof wagmiConfig}>
      <NearWalletContext.Provider value={fakeNearWallet()}>
      <QueryClientProvider client={client}>
        <ApiProvider value={api()}>
          <MemoryRouter initialEntries={[path]}>
            {node === APP ? (
              <App />
            ) : (
              <Routes>
                <Route path="/app/r/:source/:id" element={node} />
                <Route path="/app" element={node} />
              </Routes>
            )}
          </MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>
      </NearWalletContext.Provider>
    </WagmiProvider>
    </ThemeProvider>,
  );
}

const FAR_FUTURE = 10n ** 12n;
const APP = <App />;

describe("App", () => {
  it("opens the landing at the root and the dashboard under /app", async () => {
    const landing = setup(APP, "/");
    expect(await landing.findByRole("heading", { level: 1, name: /A judge for deals between AI agents/ })).toBeInTheDocument();
    landing.unmount();
    const dashboard = setup(APP, "/app");
    expect(await dashboard.findByRole("heading", { level: 1, name: "Disputes" })).toBeInTheDocument();
    expect(dashboard.getByRole("region", { name: "Live numbers" })).toBeInTheDocument();
    expect(dashboard.getAllByRole("link", { name: /New dispute/ })[0]).toHaveAttribute("href", "/app/new");
    expect(dashboard.getByRole("link", { name: /oracle\.psephex\.testnet on Nearblocks/ })).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens the new dispute form in a dialog and closes it back to the list", async () => {
    setup(APP, "/app/new");
    const dialog = await screen.findByRole("dialog", { name: "Open a dispute" });
    expect(within(dialog).getByLabelText("Claim")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your evidence")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Disputes" })).toBeInTheDocument();
  });

  it("redirects a legacy /app/r/:id link to the Base dispute", async () => {
    setup(APP, "/app/r/7", { 7: { escalated: false, settled: true, deadline: FAR_FUTURE } });
    const sheet = await screen.findByRole("dialog", { name: "Dispute #7" });
    expect(await within(sheet).findByRole("heading", { level: 1, name: /Is water made of carbon/ })).toBeInTheDocument();
    expect(within(sheet).getByText("Base Sepolia")).toBeInTheDocument();
    expect(within(sheet).getByText("Question recorded on Base")).toBeInTheDocument();
  });

  it("routes to a dispute and to an unknown page", async () => {
    setup(APP, "/app/r/base/7", { 7: { escalated: false, settled: true, deadline: FAR_FUTURE } });
    const sheet = await screen.findByRole("dialog", { name: "Dispute #7" });
    expect(await within(sheet).findByRole("heading", { name: "The path of this dispute" })).toBeInTheDocument();
    const other = setup(APP, "/app/nope");
    expect(await other.findByText(/This page does not exist/)).toBeInTheDocument();
  });
});

describe("RequestPage", () => {
  it("shows a settled NO dispute with votes, the full path and the commands", async () => {
    setup(<RequestPage />, "/app/r/base/7", { 7: { escalated: false, settled: true, deadline: FAR_FUTURE, winner: COUNTERPARTY as Address } });
    expect(await screen.findByRole("heading", { level: 1, name: /Is water made of carbon/ })).toBeInTheDocument();
    expect(await screen.findByText(/NO\. 0\.001 ETH went to the counterparty 0xBc94…4799/)).toBeInTheDocument();
    expect(screen.getAllByText("(done)")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Answer transaction on Basescan" })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/sepolia\.basescan\.org\/tx\/0x8223/));
    expect(await screen.findByRole("heading", { name: "Check it yourself" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Refund/ })).toBeNull();
    expect(screen.getByText("This text matches the question hash stored on Base.")).toBeInTheDocument();
  });

  it("offers the refund once a stopped dispute passes its deadline", async () => {
    setup(<RequestPage />, "/app/r/base/5", { 5: { escalated: false, settled: false, deadline: 1n } });
    expect(await screen.findByText(/The oracle stopped on this dispute: stuck in answering/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Refund the stake to the claimant" })).toBeInTheDocument();
    expect(screen.getByText("(stopped)")).toBeInTheDocument();
  });

  it("hides a question that does not match the hash stored on Base", async () => {
    setup(<RequestPage />, "/app/r/base/5", { 5: { escalated: false, settled: false, deadline: FAR_FUTURE } }, { 5: keccak256(stringToBytes("a different question")) });
    expect(await screen.findByText(/does not match the hash stored on Base/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dispute #5");
    expect(screen.queryByRole("heading", { name: "Check it yourself" })).toBeNull();
  });

  it("says when the dispute does not exist yet", async () => {
    setup(<RequestPage />, "/app/r/base/42");
    expect(await screen.findByRole("heading", { level: 1, name: "No dispute with this number yet" })).toBeInTheDocument();
  });

  it("rejects a malformed id", () => {
    setup(<RequestPage />, "/app/r/base/abc");
    expect(screen.getByText(/There is no dispute with this number/)).toBeInTheDocument();
  });
});

describe("Wallet and DisputeForm", () => {
  it("connects and shows the account", async () => {
    setup(<Wallet />, "/app");
    await userEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByText("0x8760…D4AF")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("fills an example, totals the cost and explains invalid fields", async () => {
    const user = userEvent.setup();
    setup(
      <>
        <Wallet />
        <DisputeForm />
      </>,
      "/app",
    );
    expect(screen.getByRole("radio", { name: /NEAR testnet/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Base Sepolia/ }));
    await user.click(screen.getAllByRole("button", { name: "Connect wallet" })[0] as HTMLElement);
    await user.click(await screen.findByRole("button", { name: /Translation late and short/ }));
    expect((screen.getByLabelText("Question with the evidence") as HTMLTextAreaElement).value).toContain("10 translated pages");
    expect(await screen.findByText(/You pay/)).toHaveTextContent("0.0011 ETH");
    await user.type(screen.getByLabelText("Counterparty address"), CLAIMANT);
    await user.clear(screen.getByLabelText("Your stake in ETH"));
    await user.type(screen.getByLabelText("Your stake in ETH"), "0.0001");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open dispute" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Open dispute" }));
    expect(await screen.findByText("The counterparty must be someone other than you.")).toBeInTheDocument();
    expect(screen.getByText("The minimum stake is 0.001 ETH.")).toBeInTheDocument();
    expect(screen.getByLabelText("Counterparty address")).toHaveAttribute("aria-invalid", "true");
  });
});
