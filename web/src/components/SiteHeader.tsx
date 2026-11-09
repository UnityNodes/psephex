import type { ReactNode } from "react";
import { Link } from "react-router";
import { ThemeToggle } from "./ThemeToggle.js";

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-7">
      <circle cx="32" cy="32" r="25" fill="var(--bronze)" />
      <rect x="30" y="3" width="4" height="58" rx="2" fill="var(--ink)" />
      <circle cx="32" cy="32" r="8" fill="var(--ink)" />
    </svg>
  );
}

export function SiteHeader({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
        <Link to="/" className="flex min-h-11 items-center gap-2.5 font-display text-2xl font-semibold">
          <Mark />
          Psephex
        </Link>
        {children}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {end}
        <ThemeToggle />
      </div>
    </header>
  );
}
