import { Wallet as WalletIcon } from "lucide-react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN } from "../deployment.js";
import { Button } from "./ui/button.js";

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function connectError(err: Error | null): string | null {
  if (!err) return null;
  if (/provider not found|ProviderNotFound/i.test(`${err.name} ${err.message}`)) return "No browser wallet found. Install MetaMask or Rabby, then reload this page.";
  if (/reject/i.test(err.message)) return "You closed the wallet prompt.";
  return "The wallet did not connect. Open it and try again.";
}

export function Wallet() {
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const connector = connectors[0];

  if (status !== "connected" || !address) {
    const message = connectError(connect.error);
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" disabled={!connector || connect.isPending} onClick={() => connector && connect.mutate({ connector })}>
          <WalletIcon aria-hidden="true" />
          {connect.isPending ? "Connecting…" : "Connect wallet"}
        </Button>
        {message && (
          <p role="alert" className="m-0 max-w-64 text-right text-xs text-no">
            {message}
          </p>
        )}
      </div>
    );
  }

  if (chainId !== CHAIN.id) {
    return (
      <Button type="button" variant="outline" disabled={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: CHAIN.id })}>
        {switchChain.isPending ? "Switching…" : `Switch to ${CHAIN.name}`}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-yes" />
        <span className="font-mono">{shortAddress(address)}</span>
        <span className="sr-only">connected to {CHAIN.name}</span>
      </span>
      <button type="button" onClick={() => disconnect.mutate()} className="min-h-11 text-muted underline-offset-2 hover:text-ink hover:underline">
        Disconnect
      </button>
    </div>
  );
}
