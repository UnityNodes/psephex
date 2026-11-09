import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NearAccount, shortAccount } from "../src/components/NearAccount.js";
import { NearWalletProvider } from "../src/near/NearWalletProvider.js";
import { NearWalletContext } from "../src/near/wallet.js";
import { fakeNearWallet } from "./near-fakes.js";

const selector = vi.hoisted(() => {
  let account: string | null = null;
  const listeners = new Set<(a: string | null) => void>();
  let failNext = false;
  return {
    failOnce: () => {
      failNext = true;
    },
    wallets: () => [
      { id: "sender", name: "Sender", iconUrl: null, kind: "injected", available: false, downloadUrl: "https://sender.org" },
      { id: "my-near-wallet", name: "MyNearWallet", iconUrl: null, kind: "browser", available: true, downloadUrl: null },
      { id: "meteor-wallet", name: "Meteor Wallet", iconUrl: null, kind: "browser", available: true, downloadUrl: null },
    ],
    accountId: () => account,
    subscribe: (l: (a: string | null) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    connect: async (id: string) => {
      if (failNext) {
        failNext = false;
        throw new Error("User closed the window");
      }
      account = id === "meteor-wallet" ? "alice.testnet" : "bob.testnet";
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
    const dialog = await screen.findByRole("dialog", { name: "Connect a NEAR wallet" });
    const names = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
    expect(names[0]).toContain("MyNearWallet");
    expect(names[2]).toContain("Sender");
    expect(within(dialog).getByRole("link", { name: /Install/ })).toHaveAttribute("href", "https://sender.org");
    await userEvent.click(within(dialog).getByRole("button", { name: /Meteor Wallet/ }));
    expect(await screen.findByText("alice.testnet")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByRole("button", { name: "Connect NEAR wallet" })).toBeInTheDocument();
  });

  it("closes the picker before the wallet opens, shows a refusal next to the button, and cancels cleanly", async () => {
    render(
      <NearWalletProvider>
        <NearAccount />
      </NearWalletProvider>,
    );
    const connect = await screen.findByRole("button", { name: "Connect NEAR wallet" });
    await waitFor(() => expect(connect).toBeEnabled());
    selector.failOnce();
    await userEvent.click(connect);
    const dialog = await screen.findByRole("dialog", { name: "Connect a NEAR wallet" });
    await userEvent.click(within(dialog).getByRole("button", { name: /MyNearWallet/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You closed the wallet without signing.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect NEAR wallet" }));
    await screen.findByRole("dialog", { name: "Connect a NEAR wallet" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Connect NEAR wallet" })).toBeEnabled();
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
