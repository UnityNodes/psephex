import { NavLink, Route, Routes } from "react-router";
import { SiteHeader } from "./components/SiteHeader.js";
import { Wallet } from "./components/Wallet.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { usePageTitle } from "./hooks.js";
import { DisputeForm } from "./pages/DisputeForm.js";
import { Landing } from "./pages/Landing.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { RecentDisputes } from "./pages/RecentDisputes.js";
import { RequestPage } from "./pages/RequestPage.js";

const NAV = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center border-b-2 transition-colors duration-150 ${isActive ? "border-bronze font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`;

function Dashboard() {
  usePageTitle("Open a dispute - Psephex");
  return (
    <div className="grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section aria-labelledby="open-heading" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 id="open-heading" className="m-0 max-w-[18ch] font-display text-4xl leading-[1.02] font-semibold sm:text-5xl">
            Put a yes-or-no dispute to three AI models
          </h1>
          <p className="m-0 max-w-[60ch] text-base text-muted sm:text-lg">
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
  usePageTitle("Not found - Psephex");
  return (
    <div className="flex flex-col gap-3 py-10">
      <h1 className="m-0 font-display text-4xl font-semibold">This page does not exist</h1>
      <p className="m-0 text-muted">
        <NavLink to="/app" className="underline underline-offset-2 hover:text-bronze-text">
          Open a dispute
        </NavLink>{" "}
        or go back to the{" "}
        <NavLink to="/" className="underline underline-offset-2 hover:text-bronze-text">
          start page
        </NavLink>
        .
      </p>
    </div>
  );
}

function Shell() {
  return (
    <div className="basalt-glow min-h-dvh">
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <SiteHeader end={<Wallet />}>
        <nav aria-label="Main" className="flex gap-5 text-sm">
          <NavLink to="/app" end className={NAV}>
            Disputes
          </NavLink>
          <NavLink to="/app/models" className={NAV}>
            Models
          </NavLink>
          <a href="/#how" className="inline-flex min-h-11 items-center border-b-2 border-transparent text-muted transition-colors duration-150 hover:text-ink">
            How it works
          </a>
        </nav>
      </SiteHeader>
      <main className="flex-1 pt-6 pb-16">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/r/:id" element={<RequestPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <SiteFooter />
    </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<Shell />} />
      <Route
        path="*"
        element={
          <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
            <NotFound />
            <SiteFooter />
          </div>
        }
      />
    </Routes>
  );
}
