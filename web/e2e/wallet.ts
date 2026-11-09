import type { Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

interface TxParams {
  readonly to: Hex;
  readonly data?: Hex;
  readonly value?: Hex;
  readonly gas?: Hex;
}

export interface TestWalletOptions {
  readonly privateKey: Hex;
  readonly rpcUrl: string;
  readonly startChainId: number;
  readonly origin: string;
  readonly allowedTo: Address;
  readonly maxValueWei: bigint;
}

/**
 * Stands in for a browser wallet extension: the page sees a plain EIP-1193 provider on
 * window.ethereum, and every request is answered in Node by a fresh key. The dashboard runs its
 * real injected-connector code path, including the network switch a judge's wallet would need.
 * It answers only the main frame of the dashboard under test and signs only capped Dispute calls,
 * so pointing the test at another site cannot spend the test key.
 */
export async function installTestWallet(page: Page, opts: TestWalletOptions): Promise<string> {
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(opts.rpcUrl) });
  const reader = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl) });
  let chainId = opts.startChainId;

  await page.exposeBinding("__psephexWallet", async (source, method: string, params: unknown[]): Promise<unknown> => {
    if (source.frame !== page.mainFrame() || new URL(source.frame.url()).origin !== opts.origin) throw new Error("test wallet only answers the dashboard under test");
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return toHex(chainId);
      case "wallet_switchEthereumChain": {
        const target = Number.parseInt((params[0] as { chainId: string }).chainId, 16);
        if (target !== baseSepolia.id) throw new Error(`test wallet only knows Base Sepolia, asked for ${target}`);
        chainId = target;
        return null;
      }
      case "eth_sendTransaction": {
        if (chainId !== baseSepolia.id) throw new Error("test wallet is not on Base Sepolia");
        const tx = params[0] as TxParams;
        const value = tx.value ? BigInt(tx.value) : 0n;
        if (tx.to.toLowerCase() !== opts.allowedTo.toLowerCase()) throw new Error(`test wallet refuses a transaction to ${tx.to}`);
        if (value > opts.maxValueWei) throw new Error(`test wallet refuses to send ${value} wei`);
        return wallet.sendTransaction({
          to: tx.to,
          ...(tx.data ? { data: tx.data } : {}),
          value,
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        });
      }
      default:
        return reader.request({ method, params } as never);
    }
  });

  await page.addInitScript(() => {
    const listeners: Record<string, ((value: unknown) => void)[]> = {};
    const bridge = (window as unknown as { __psephexWallet: (method: string, params: unknown[]) => Promise<unknown> }).__psephexWallet;
    const emit = (event: string, value: unknown) => (listeners[event] ?? []).forEach((listener) => listener(value));
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        const result = await bridge(method, params ?? []);
        if (method === "wallet_switchEthereumChain") emit("chainChanged", (params?.[0] as { chainId: string }).chainId);
        if (method === "eth_requestAccounts") emit("accountsChanged", result);
        return result;
      },
      on: (event: string, listener: (value: unknown) => void) => {
        (listeners[event] ??= []).push(listener);
      },
      removeListener: (event: string, listener: (value: unknown) => void) => {
        listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
      },
    };
  });
  return account.address;
}
