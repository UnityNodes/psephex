import { Buffer } from "buffer";
import { actionCreators, setupWalletSelector, type InjectedWallet, type WalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { NEAR_RPC_URL } from "../deployment.js";
import type { NearCall } from "./wallet.js";

/**
 * MyNearWallet serialises transactions with Node's global Buffer, which browsers do not have, so
 * signing threw a ReferenceError. The polyfill is installed only here, in the chunk that loads
 * with the NEAR wallet, and never replaces a Buffer that already exists.
 */
function ensureBuffer(): void {
  const scope = globalThis as { Buffer?: unknown };
  if (scope.Buffer === undefined) scope.Buffer = Buffer;
}

export interface SelectorWallet {
  readonly accountId: () => string | null;
  readonly subscribe: (listener: (accountId: string | null) => void) => () => void;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly call: (call: NearCall) => Promise<string>;
}

function activeAccount(selector: WalletSelector): string | null {
  const accounts = selector.store.getState().accounts;
  return accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null;
}

export async function createSelectorWallet(): Promise<SelectorWallet> {
  ensureBuffer();
  const selector = await setupWalletSelector({
    network: { networkId: "testnet", nodeUrl: NEAR_RPC_URL, helperUrl: "", explorerUrl: "https://testnet.nearblocks.io", indexerUrl: "" },
    modules: [setupMyNearWallet()],
  });
  return {
    accountId: () => activeAccount(selector),
    subscribe: (listener) => {
      const sub = selector.store.observable.subscribe(() => listener(activeAccount(selector)));
      return () => sub.unsubscribe();
    },
    connect: async () => {
      const wallet = await selector.wallet<InjectedWallet>("my-near-wallet");
      await wallet.signIn({});
    },
    disconnect: async () => {
      const wallet = await selector.wallet();
      await wallet.signOut();
    },
    call: async (c) => {
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: c.receiverId,
        actions: [actionCreators.functionCall(c.methodName, { ...c.args }, c.gas, c.deposit)],
      });
      if (!outcome) throw new Error("the wallet returned no transaction");
      return outcome.transaction_outcome.id;
    },
  };
}
