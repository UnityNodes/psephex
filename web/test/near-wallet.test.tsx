import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NearAccount, shortAccount } from "../src/components/NearAccount.js";
import { NearWalletProvider } from "../src/near/NearWalletProvider.js";
import { NearWalletContext } from "../src/near/wallet.js";
import { fakeNearWallet } from "./near-fakes.js";

const selector = vi.hoisted(() => {
  let account: string | null = null;
  const listeners = new Set<(a: string | null) => void>();
  return {
    accountId: () => account,
    subscribe: (l: (a: string | null) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    connect: async () => {
      account = "alice.testnet";
      listeners.forEach((l) => l(account));
    },
    disconnect: async () => {
      account = null;
    },
    call: async () => "hash",
  };
});

vi.mock("../src/near/selector.js", () => ({ createSelectorWallet: async () => selector }));

describe("NearWalletProvider", () => {
  it("loads the selector lazily, connects and disconnects the account", async () => {
    render(
      <NearWalletProvider>
        <NearAccount />
      </NearWalletProvider>,
    );
    const connect = await screen.findByRole("button", { name: "Connect NEAR wallet" });
    await waitFor(() => expect(connect).toBeEnabled());
    await userEvent.click(connect);
    expect(await screen.findByText("alice.testnet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect NEAR wallet" })).toBeInTheDocument();
  });

  it("keeps a wallet that is already provided", () => {
    render(
      <NearWalletContext.Provider value={fakeNearWallet({ accountId: "bob.testnet" })}>
        <NearWalletProvider>
          <NearAccount />
        </NearWalletProvider>
      </NearWalletContext.Provider>,
    );
    expect(screen.getByText("bob.testnet")).toBeInTheDocument();
  });

  it("explains a failed connection", async () => {
    const wallet = fakeNearWallet({ connect: vi.fn(async () => Promise.reject(new Error("User closed the window"))) });
    render(
      <NearWalletContext.Provider value={wallet}>
        <NearAccount />
      </NearWalletContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect NEAR wallet" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You closed the wallet without signing.");
  });

  it("shortens long implicit accounts and keeps named ones", () => {
    expect(shortAccount("alice.testnet")).toBe("alice.testnet");
    expect(shortAccount("a".repeat(64))).toBe(`${"a".repeat(10)}…${"a".repeat(8)}`);
  });
});
