import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SelectorWallet, WalletOption } from "./selector.js";
import { WalletPicker } from "./WalletPicker.js";
import { NearWalletContext, type NearWallet, type NearWalletStatus } from "./wallet.js";

const SESSION_KEYS = ["near-wallet-selector:selectedWalletId", "signedAccountId"];

function hadSession(): boolean {
  try {
    return SESSION_KEYS.some((k) => window.localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}

/**
 * The NEAR wallet code is about as large as the rest of the dashboard, so it loads only when a
 * page needs it: the NEAR form, a NEAR refund, the connect button, or a session from an earlier
 * visit. Tests provide their own wallet through the context, and an existing provider is kept so
 * the real selector never starts under them.
 */
function SelectorProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<SelectorWallet | null>(null);
  const [status, setStatus] = useState<NearWalletStatus>("idle");
  const [accountId, setAccountId] = useState<string | null>(null);
  const loading = useRef<Promise<SelectorWallet> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const [picker, setPicker] = useState<{ options: readonly WalletOption[]; resolve: (id: string | null) => void; reject: (err: unknown) => void } | null>(null);

  function choose(s: SelectorWallet): Promise<string | null> {
    return new Promise((resolve, reject) => setPicker({ options: s.wallets(), resolve, reject }));
  }

  function load(): Promise<SelectorWallet> {
    if (!loading.current) {
      setStatus("loading");
      loading.current = import("./selector.js")
        .then((m) => m.createSelectorWallet())
        .then((s) => {
          setSelector(s);
          setAccountId(s.accountId());
          unsubscribe.current = s.subscribe(setAccountId);
          setStatus("ready");
          return s;
        })
        .catch((err: unknown) => {
          loading.current = null;
          setStatus("unavailable");
          throw err;
        });
    }
    return loading.current;
  }

  useEffect(() => {
    if (hadSession()) void load().catch(() => undefined);
    return () => unsubscribe.current?.();
  }, []);

  const value = useMemo<NearWallet>(
    () => ({
      status,
      accountId,
      prepare: () => void load().catch(() => undefined),
      connect: async () => {
        const s = await load();
        const id = await choose(s);
        if (id === null) return;
        setAccountId(s.accountId());
      },
      disconnect: async () => {
        await selector?.disconnect();
        setAccountId(null);
      },
      call: async (c) => (await load()).call(c),
    }),
    [selector, status, accountId],
  );

  /**
   * The picker closes before the wallet opens, so the wallet's own overlay is not covered by a
   * modal dialog; a refusal or error goes back to whoever asked to connect and is shown there.
   */
  async function pick(id: string) {
    const pending = picker;
    setPicker(null);
    try {
      const s = await load();
      await s.connect(id);
      pending?.resolve(id);
    } catch (err) {
      pending?.reject(err);
    }
  }

  function cancel() {
    picker?.resolve(null);
    setPicker(null);
  }

  return (
    <NearWalletContext.Provider value={value}>
      {children}
      <WalletPicker open={picker !== null} options={picker?.options ?? []} onPick={pick} onCancel={cancel} />
    </NearWalletContext.Provider>
  );
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const existing = useContext(NearWalletContext);
  return existing ? <>{children}</> : <SelectorProvider>{children}</SelectorProvider>;
}
