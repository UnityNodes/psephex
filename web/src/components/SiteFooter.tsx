import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { AIORACLE_ADDRESS, ARBITRUM_AI_ORACLE, ARBITRUM_DISPUTE, DISPUTE_ADDRESS, explorer, NEAR_COURT_CONTRACT, NEAR_DISPUTE_CONTRACT, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS, REPO_URL, VIDEO_URL, DOCS_URL } from "../deployment.js";

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

export function SiteFooter() {
  return (
    <footer className="flex flex-col gap-2 border-t border-line py-8 text-sm">
      <p className="m-0 text-ink">Testnet only: NEAR testnet, Base Sepolia and Arbitrum Sepolia.</p>
      <ChainLinks />
    </footer>
  );
}
