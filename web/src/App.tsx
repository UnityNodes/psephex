import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { NotFound } from "./components/NotFound.js";
import { SiteFooter } from "./components/SiteFooter.js";
import { Landing } from "./pages/Landing.js";

const Dashboard = lazy(() => import("./app/Dashboard.js"));

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted" role="status">
      Loading the dashboard…
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/app/*"
        element={
          <Suspense fallback={<Loading />}>
            <Dashboard />
          </Suspense>
        }
      />
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
