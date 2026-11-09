import type { ReactNode } from "react";
import { AIORACLE_ADDRESS, DISPUTE_ADDRESS, explorer, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS, REPO_URL, VIDEO_URL } from "../deployment.js";

function FooterLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block py-2 underline underline-offset-2 hover:text-bronze">
        {children}
      </a>
    </li>
  );
}

export function SiteFooter() {
  return (
    <footer className="flex flex-col gap-1 border-t border-line py-8 text-sm">
      <p className="m-0 text-muted">Testnet only: Base Sepolia and NEAR testnet.</p>
      <ul className="m-0 flex list-none flex-wrap gap-x-6 p-0">
        <FooterLink href={explorer.baseAddress(AIORACLE_ADDRESS)}>AiOracle on Basescan</FooterLink>
        <FooterLink href={explorer.baseAddress(DISPUTE_ADDRESS)}>Dispute on Basescan</FooterLink>
        <FooterLink href={explorer.nearAccount(NEAR_ORACLE_CONTRACT)}>{`${NEAR_ORACLE_CONTRACT} on Nearblocks`}</FooterLink>
        <FooterLink href={explorer.baseAddress(ORACLE_EVM_ADDRESS)}>Oracle address on Basescan</FooterLink>
        <FooterLink href={REPO_URL}>Source code</FooterLink>
        <FooterLink href={VIDEO_URL}>Demo video</FooterLink>
      </ul>
    </footer>
  );
}
