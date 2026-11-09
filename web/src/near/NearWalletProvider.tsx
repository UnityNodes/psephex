import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SelectorWallet } from "./selector.js";
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
        await s.connect();
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

  return <NearWalletContext.Provider value={value}>{children}</NearWalletContext.Provider>;
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const existing = useContext(NearWalletContext);
  return existing ? <>{children}</> : <SelectorProvider>{children}</SelectorProvider>;
}
