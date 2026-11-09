import { useContext, type ReactNode } from "react";
import { Route, Routes } from "react-router";
import { WagmiContext, WagmiProvider } from "wagmi";
import { NotFound } from "../components/NotFound.js";
import { ModelsPage } from "../pages/ModelsPage.js";
import { wagmiConfig } from "../wagmi.js";
import { AppShell } from "./AppShell.js";
import { Overview } from "./Overview.js";

/**
 * The wallet stack loads only with the dashboard so the landing stays light. Tests wrap the app in
 * their own WagmiProvider with a mock chain; providing the real config again here would replace it,
 * so an existing provider is kept.
 */
function WithChain({ children }: { children: ReactNode }) {
  const existing = useContext(WagmiContext);
  return existing ? <>{children}</> : <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

export default function Dashboard() {
  return (
    <WithChain>
      <AppShell>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/new" element={<Overview overlay="new" />} />
          <Route path="/r/:id" element={<Overview overlay="detail" />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </WithChain>
  );
}
