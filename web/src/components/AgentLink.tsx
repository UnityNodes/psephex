import { Link } from "react-router";
import { isNearAccount } from "../deployment.js";

export function agentPath(account: string): string {
  return `/app/agent/${account}`;
}

/** A party name comes from the RPC, so anything that is not a plain NEAR account id stays text instead of becoming a route. */
export function AgentLink({ account, className = "" }: { account: string; className?: string }) {
  if (!isNearAccount(account)) return <span className={`font-mono [overflow-wrap:anywhere] ${className}`}>{account}</span>;
  return (
    <Link to={agentPath(account)} className={`font-mono underline decoration-line underline-offset-2 [overflow-wrap:anywhere] hover:text-bronze-text hover:decoration-bronze ${className}`}>
      {account}
    </Link>
  );
}
