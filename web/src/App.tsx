import { NavLink, Route, Routes } from "react-router";
import { AppShell } from "./app/AppShell.js";
import { Overview } from "./app/Overview.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { usePageTitle } from "./hooks.js";
import { Landing } from "./pages/Landing.js";
import { ModelsPage } from "./pages/ModelsPage.js";

function NotFound() {
  usePageTitle("Not found - Psephex");
  return (
    <div className="flex flex-col gap-3 py-10">
      <h1 className="m-0 font-display text-4xl font-extrabold">This page does not exist</h1>
      <p className="m-0 text-muted">
        <NavLink to="/app" className="underline underline-offset-2 hover:text-bronze-text">
          Open the disputes
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

function Dashboard() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/new" element={<Overview overlay="new" />} />
        <Route path="/r/:id" element={<Overview overlay="detail" />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app/*" element={<Dashboard />} />
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
