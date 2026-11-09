import { BookOpen, Cpu, Menu, Plus, Scale } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { ChainLinks } from "../components/SiteFooter.js";
import { Mark } from "../components/SiteHeader.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { Button } from "../components/ui/button.js";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "../components/ui/sheet.js";
import { Wallet } from "../components/Wallet.js";
import { NetworkStatus } from "./NetworkStatus.js";

const ITEM = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150 ${isActive ? "bg-raised font-medium text-ink shadow-[inset_2px_0_0_var(--bronze)]" : "text-muted hover:bg-raised/60 hover:text-ink"}`;

function Brand() {
  return (
    <Link to="/" className="flex min-h-11 items-center gap-2.5 px-3 font-display text-xl font-extrabold">
      <Mark />
      Psephex
    </Link>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6">
      <Brand />
      <nav aria-label="Main" className="flex flex-col gap-1">
        <NavLink to="/app" end className={ITEM} onClick={onNavigate}>
          <Scale className="size-4" aria-hidden="true" />
          Disputes
        </NavLink>
        <NavLink to="/app/new" className={ITEM} onClick={onNavigate}>
          <Plus className="size-4" aria-hidden="true" />
          Open a dispute
        </NavLink>
        <NavLink to="/app/models" className={ITEM} onClick={onNavigate}>
          <Cpu className="size-4" aria-hidden="true" />
          Models
        </NavLink>
        <a href="/#how" className={ITEM({ isActive: false })}>
          <BookOpen className="size-4" aria-hidden="true" />
          How it works
        </a>
      </nav>
      <div className="flex flex-col gap-2 px-3 text-xs">
        <p className="m-0 font-medium text-ink">On chain</p>
        <ChainLinks className="flex flex-col" />
      </div>
      <div className="mt-auto flex flex-col gap-3">
        <NetworkStatus />
        <div className="flex items-center justify-between px-1">
          <p className="m-0 text-xs text-muted">Testnet only</p>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Open the menu" className="lg:hidden">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-line bg-paper p-4">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">Pages of the Psephex dashboard</SheetDescription>
        <SidebarBody onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-paper p-4 lg:block">
        <SidebarBody />
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-stone/85 px-4 py-3 backdrop-blur sm:px-8">
          <MobileMenu />
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-extrabold lg:hidden">
            <Mark />
            <span className="sr-only sm:not-sr-only">Psephex</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Wallet />
          </div>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
