import { Wallet as WalletIcon } from "lucide-react";
import { useState } from "react";
import { describeNearError } from "../lib/near-dispute.js";
import { canConnect, useNearWallet } from "../near/wallet.js";
import { Button } from "./ui/button.js";

const MAX_SHOWN = 22;

export function shortAccount(account: string): string {
  return account.length > MAX_SHOWN ? `${account.slice(0, 10)}…${account.slice(-8)}` : account;
}

export function NearAccount({ align = "end" }: { align?: "start" | "end" }) {
  const wallet = useNearWallet();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (wallet.accountId) {
    return (
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2" title={wallet.accountId}>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-yes" />
          <span className="truncate font-mono">{shortAccount(wallet.accountId)}</span>
          <span className="sr-only">connected to NEAR testnet</span>
        </span>
        <button type="button" onClick={() => void wallet.disconnect()} className="min-h-11 shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline">
          Disconnect
        </button>
      </div>
    );
  }

  async function handleConnect() {
    setBusy(true);
    setMessage(null);
    try {
      await wallet.connect();
    } catch (err) {
      setMessage(describeNearError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      <Button type="button" disabled={!canConnect(wallet) || busy} onPointerEnter={wallet.prepare} onFocus={wallet.prepare} onClick={() => void handleConnect()}>
        <WalletIcon aria-hidden="true" />
        {busy ? "Connecting…" : wallet.status === "loading" ? "Loading NEAR wallet…" : "Connect NEAR wallet"}
      </Button>
      {wallet.status === "unavailable" && <p className="m-0 max-w-64 text-xs text-no">The NEAR wallet could not load. Reload the page.</p>}
      {message && (
        <p role="alert" className={`m-0 max-w-64 text-xs text-no ${align === "end" ? "text-right" : ""}`}>
          {message}
        </p>
      )}
    </div>
  );
}
