import { Buffer } from "buffer";
import { actionCreators, setupWalletSelector, type WalletModuleFactory, type WalletSelector } from "@near-wallet-selector/core";
import { setupBitgetWallet } from "@near-wallet-selector/bitget-wallet";
import { setupCoin98Wallet } from "@near-wallet-selector/coin98-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupMathWallet } from "@near-wallet-selector/math-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupNearMobileWallet } from "@near-wallet-selector/near-mobile-wallet";
import { setupNightly } from "@near-wallet-selector/nightly";
import { setupOKXWallet } from "@near-wallet-selector/okx-wallet";
import { setupSender } from "@near-wallet-selector/sender";
import { setupWelldoneWallet } from "@near-wallet-selector/welldone-wallet";
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

export interface WalletOption {
  readonly id: string;
  readonly name: string;
  readonly iconUrl: string | null;
  readonly kind: string;
  readonly available: boolean;
  readonly downloadUrl: string | null;
}

export interface SelectorWallet {
  readonly wallets: () => readonly WalletOption[];
  readonly accountId: () => string | null;
  readonly subscribe: (listener: (accountId: string | null) => void) => () => void;
  readonly connect: (walletId: string) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly call: (call: NearCall) => Promise<string>;
}

function activeAccount(selector: WalletSelector): string | null {
  const accounts = selector.store.getState().accounts;
  return accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null;
}

const DATA_IMAGE = /^data:image\/(png|svg\+xml|jpeg|webp);base64,/;
const HTTPS = /^https:\/\//;

function iconUrl(url: string | undefined): string | null {
  return url && DATA_IMAGE.test(url) ? url : null;
}

function linkUrl(url: string | undefined): string | null {
  return url && HTTPS.test(url) ? url : null;
}

/**
 * Every wallet module that works without an extra service key is listed, because a person
 * judging the demo brings whatever NEAR wallet they already have. Wallet Connect is left out: it
 * needs a project id from a third-party account. The Ledger module is left out too: it needs its
 * own account and derivation path form, and MyNearWallet and Meteor already sign with a Ledger.
 * Bitte is left out because its testnet wallet host no longer resolves.
 */
function walletModules(): WalletModuleFactory[] {
  return [
    setupMyNearWallet(),
    setupMeteorWallet(),
    setupHotWallet(),
    setupHereWallet(),
    setupIntearWallet(),
    setupSender(),
    setupOKXWallet(),
    setupBitgetWallet(),
    setupNightly(),
    setupCoin98Wallet(),
    setupMathWallet(),
    setupWelldoneWallet(),
    setupNearMobileWallet(),
  ] as WalletModuleFactory[];
}

export async function createSelectorWallet(): Promise<SelectorWallet> {
  ensureBuffer();
  const selector = await setupWalletSelector({
    network: { networkId: "testnet", nodeUrl: NEAR_RPC_URL, helperUrl: "", explorerUrl: "https://testnet.nearblocks.io", indexerUrl: "" },
    modules: walletModules(),
  });
  return {
    wallets: () =>
      selector.store.getState().modules.map((m) => ({
        id: m.id,
        name: m.metadata.name,
        iconUrl: iconUrl(m.metadata.iconUrl),
        kind: m.type,
        available: m.metadata.available,
        downloadUrl: "downloadUrl" in m.metadata ? linkUrl((m.metadata as { downloadUrl?: string }).downloadUrl) : null,
      })),
    accountId: () => activeAccount(selector),
    subscribe: (listener) => {
      const sub = selector.store.observable.subscribe(() => listener(activeAccount(selector)));
      return () => sub.unsubscribe();
    },
    connect: async (walletId) => {
      const wallet = await selector.wallet(walletId);
      await (wallet.signIn as (params: object) => Promise<unknown>)({});
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
