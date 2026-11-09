import { createContext, useContext } from "react";

export interface NearCall {
  readonly receiverId: string;
  readonly methodName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly gas: bigint;
  readonly deposit: bigint;
}

export type NearWalletStatus = "idle" | "loading" | "ready" | "unavailable";

export interface NearWallet {
  readonly status: NearWalletStatus;
  readonly accountId: string | null;
  prepare(): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  call(call: NearCall): Promise<string>;
}

const UNAVAILABLE: NearWallet = {
  status: "unavailable",
  accountId: null,
  prepare: () => undefined,
  connect: () => Promise.reject(new Error("the NEAR wallet is not available")),
  disconnect: () => Promise.resolve(),
  call: () => Promise.reject(new Error("the NEAR wallet is not available")),
};

export const NearWalletContext = createContext<NearWallet | null>(null);

export function canConnect(wallet: NearWallet): boolean {
  return wallet.status === "ready" || wallet.status === "idle";
}

export function useNearWallet(): NearWallet {
  return useContext(NearWalletContext) ?? UNAVAILABLE;
}
