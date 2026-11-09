import { ExternalLink, Wallet as WalletIcon } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog.js";
import type { WalletOption } from "./selector.js";

export function sortWallets(options: readonly WalletOption[]): WalletOption[] {
  return [...options].sort((a, b) => Number(b.available) - Number(a.available));
}

export function WalletPicker({
  open,
  options,
  onPick,
  onCancel,
}: {
  open: boolean;
  options: readonly WalletOption[];
  onPick: (id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function pick(id: string) {
    setPending(id);
    try {
      await onPick(id);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && pending === null && onCancel()}>
      <DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto border-line bg-paper sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a NEAR wallet</DialogTitle>
          <DialogDescription>Pick the wallet you use on NEAR testnet. Extensions you have not installed link to their download page.</DialogDescription>
        </DialogHeader>
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
          {sortWallets(options).map((w) => (
            <li key={w.id}>
              {w.available ? (
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void pick(w.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2 text-left transition-colors duration-150 hover:border-bronze disabled:opacity-60"
                >
                  <WalletLogo option={w} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{w.name}</span>
                  {pending === w.id && <span className="text-xs text-muted">Opening…</span>}
                </button>
              ) : (
                <div className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 opacity-80">
                  <WalletLogo option={w} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{w.name}</span>
                    <span className="block text-xs text-muted">Not installed in this browser</span>
                  </span>
                  {w.downloadUrl && (
                    <a href={w.downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm text-bronze-text underline-offset-2 hover:underline">
                      Install
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function WalletLogo({ option }: { option: WalletOption }) {
  if (option.iconUrl) return <img src={option.iconUrl} alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg object-contain" />;
  return (
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone text-muted">
      <WalletIcon className="size-4" />
    </span>
  );
}
