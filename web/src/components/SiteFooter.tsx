import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { AIORACLE_ADDRESS, ARBITRUM_AI_ORACLE, ARBITRUM_DISPUTE, DISPUTE_ADDRESS, explorer, NEAR_COURT_CONTRACT, NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS, REPO_URL, VIDEO_URL, DOCS_URL, API_URL } from "../deployment.js";
import { MCP_NPM_URL } from "../lib/mcp.js";
import { Mark } from "./SiteHeader.js";
import { Button } from "./ui/button.js";

function FooterLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-muted transition-colors duration-150 hover:text-bronze-text">
        {children}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </a>
    </li>
  );
}

export function ChainLinks({ className = "flex flex-wrap gap-x-6" }: { className?: string }) {
  return (
    <ul className={`m-0 list-none p-0 ${className}`}>
        <FooterLink href={explorer.nearAccount(NEAR_COURT_CONTRACT)}>{`${NEAR_COURT_CONTRACT} on Nearblocks`}</FooterLink>
        <FooterLink href={explorer.nearAccount(NEAR_ORACLE_CONTRACT)}>{`${NEAR_ORACLE_CONTRACT} on Nearblocks`}</FooterLink>
        <FooterLink href={explorer.nearAccount(NEAR_DISPUTE_CONTRACT)}>{`${NEAR_DISPUTE_CONTRACT} on Nearblocks`}</FooterLink>
        <FooterLink href={explorer.baseAddress(AIORACLE_ADDRESS)}>AiOracle on Basescan</FooterLink>
        <FooterLink href={explorer.baseAddress(DISPUTE_ADDRESS)}>Dispute on Basescan</FooterLink>
        <FooterLink href={ARBITRUM_AI_ORACLE ? explorer.address("arbitrum", ARBITRUM_AI_ORACLE) : null}>AiOracle on Arbiscan</FooterLink>
        <FooterLink href={ARBITRUM_DISPUTE ? explorer.address("arbitrum", ARBITRUM_DISPUTE) : null}>Dispute on Arbiscan</FooterLink>
        <FooterLink href={explorer.baseAddress(ORACLE_EVM_ADDRESS)}>Oracle address on Basescan</FooterLink>
        <FooterLink href={DOCS_URL}>Documentation</FooterLink>
        <FooterLink href={REPO_URL}>Source code</FooterLink>
        <FooterLink href={VIDEO_URL}>Demo video</FooterLink>
    </ul>
  );
}

interface FooterItem {
  readonly label: string;
  readonly href: string | null;
  readonly hint?: string;
  readonly name?: string;
  readonly internal?: boolean;
}

function FooterColumn({ title, items }: { title: string; items: readonly FooterItem[] }) {
  const shown = items.filter((i) => i.href);
  if (shown.length === 0) return null;
  return (
    <nav aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="m-0 font-display text-sm font-bold text-bronze-hi">{title}</h2>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((i) => (
          <li key={i.label}>
            {i.internal ? (
              <Link to={i.href!} className="inline-flex min-h-10 items-center text-sm text-vault-ink/70 transition-colors duration-150 hover:text-vault-ink">
                {i.label}
              </Link>
            ) : (
              <a href={i.href!} target="_blank" rel="noopener noreferrer" aria-label={i.name ?? (i.hint ? `${i.label} ${i.hint}` : undefined)} className="group inline-flex min-h-10 items-center gap-1 text-sm break-all text-vault-ink/70 transition-colors duration-150 hover:text-vault-ink">
                {i.label}
                <ArrowUpRight className="size-3.5 shrink-0 opacity-60 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  const columns: readonly { title: string; items: readonly FooterItem[] }[] = [
    {
      title: "Use it",
      items: [
        { label: "Dashboard", href: "/app", internal: true },
        { label: "Open a case", href: "/app/new", internal: true },
        { label: "The three models", href: "/app/models", internal: true },
        { label: "Documentation", href: DOCS_URL },
        { label: "Demo video", href: VIDEO_URL },
      ],
    },
    {
      title: "Build on it",
      items: [
        { label: "Agent quickstart", href: DOCS_URL ? `${DOCS_URL}/guide/agents` : null },
        { label: "MCP server on npm", href: MCP_NPM_URL },
        { label: "Read-only API", href: `${API_URL}/health` },
        { label: "Source code", href: REPO_URL },
      ],
    },
    {
      title: "Contracts on NEAR",
      items: [NEAR_COURT_CONTRACT, NEAR_ORACLE_CONTRACT, NEAR_DISPUTE_CONTRACT].map((a) => ({ label: a, href: explorer.nearAccount(a), hint: "on Nearblocks" })),
    },
    {
      title: "Contracts on EVM",
      items: [
        { label: "AiOracle on Base", href: explorer.baseAddress(AIORACLE_ADDRESS), name: "AiOracle on Basescan" },
        { label: "Dispute on Base", href: explorer.baseAddress(DISPUTE_ADDRESS), name: "Dispute on Basescan" },
        { label: "AiOracle on Arbitrum", href: ARBITRUM_AI_ORACLE ? explorer.address("arbitrum", ARBITRUM_AI_ORACLE) : null, name: "AiOracle on Arbiscan" },
        { label: "Dispute on Arbitrum", href: ARBITRUM_DISPUTE ? explorer.address("arbitrum", ARBITRUM_DISPUTE) : null, name: "Dispute on Arbiscan" },
        { label: "MPC oracle address", href: explorer.baseAddress(ORACLE_EVM_ADDRESS), name: "Oracle address on Basescan" },
      ],
    },
  ];
  return (
    <footer className="mb-6 overflow-hidden rounded-3xl border border-vault-line bg-vault text-vault-ink">
      <div className="flex flex-col gap-8 border-b border-vault-line p-6 sm:p-10 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-[46ch] flex-col gap-4">
          <Link to="/" className="flex w-fit items-center gap-2.5 font-display text-2xl font-extrabold text-vault-ink">
            <Mark ink="var(--vault-ink)" />
            Psephex
          </Link>
          <p className="m-0 font-display text-2xl leading-snug font-medium sm:text-3xl">When two agents disagree about a deal, three models decide and NEAR checks the count.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/app/new">Open a case</Link>
          </Button>
          {DOCS_URL && (
            <Button asChild size="lg" variant="outline" className="border-vault-line text-vault-ink hover:text-bronze-hi">
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                Read the docs
              </a>
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-x-8 gap-y-8 p-6 sm:grid-cols-2 sm:p-10 lg:grid-cols-4">
        {columns.map((c) => (
          <FooterColumn key={c.title} title={c.title} items={c.items} />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-vault-line px-6 py-5 text-xs text-vault-ink/60 sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <p className="m-0 flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-yes" />
          Testnet only: NEAR testnet, Base Sepolia and Arbitrum Sepolia. Nothing here holds real funds.
        </p>
        <p className="m-0">Open source under the MIT license.</p>
      </div>
    </footer>
  );
}
