import { Navigate, NavLink, Route, Routes } from "react-router";
import { Wallet } from "./components/Wallet.js";
import { AIORACLE_ADDRESS, explorer, NEAR_ORACLE_CONTRACT } from "./deployment.js";
import { DisputeForm } from "./pages/DisputeForm.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { RecentDisputes } from "./pages/RecentDisputes.js";
import { RequestPage } from "./pages/RequestPage.js";

const NAV = ({ isActive }: { isActive: boolean }) => `underline-offset-4 hover:underline ${isActive ? "font-semibold text-ink" : "text-muted"}`;

function Dashboard() {
  return (
    <div className="grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section aria-labelledby="open-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 id="open-heading" className="m-0 font-display text-4xl leading-[1.05] font-semibold sm:text-5xl">
            Put a yes-or-no dispute to three AI models
          </h1>
          <p className="m-0 max-w-[60ch] text-lg text-muted">
            You stake test ETH on Base Sepolia. Three models answer inside TEEs and sign their answers, a NEAR contract checks that two of them agree, and NEAR Chain Signatures send the verdict back to Base, which pays out.
          </p>
        </div>
        <DisputeForm />
      </section>
      <RecentDisputes />
    </div>
  );
}

function NotFound() {
  return (
    <p>
      This page does not exist. <NavLink to="/app">Open a dispute</NavLink>.
    </p>
  );
}

export function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-baseline gap-6">
          <NavLink to="/app" className="font-display text-2xl font-bold tracking-tight">
            Psephex
          </NavLink>
          <nav aria-label="Main" className="flex gap-4 text-sm">
            <NavLink to="/app" end className={NAV}>
              Disputes
            </NavLink>
            <NavLink to="/app/models" className={NAV}>
              Models
            </NavLink>
          </nav>
        </div>
        <Wallet />
      </header>
      <main className="flex-1 pt-6 pb-16">
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/r/:id" element={<RequestPage />} />
          <Route path="/app/models" element={<ModelsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line py-6 text-xs text-muted">
        <span>Testnet only: Base Sepolia and NEAR testnet.</span>
        <a href={explorer.baseAddress(AIORACLE_ADDRESS) ?? undefined} target="_blank" rel="noopener noreferrer" className="underline">
          AiOracle on Basescan
        </a>
        <a href={explorer.nearAccount(NEAR_ORACLE_CONTRACT)} target="_blank" rel="noopener noreferrer" className="underline">
          {NEAR_ORACLE_CONTRACT} on Nearblocks
        </a>
      </footer>
    </div>
  );
}
