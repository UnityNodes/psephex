import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { agentPath } from "../components/AgentLink.js";
import { Button } from "../components/ui/button.js";
import { isNearAccount } from "../deployment.js";
import { FIELD } from "./DisputeFields.js";

export function AgentLookup() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const account = value.trim().toLowerCase();
    if (!isNearAccount(account)) {
      setError("Enter a NEAR account, for example seller-agent.testnet.");
      return;
    }
    navigate(agentPath(account));
  };
  return (
    <form role="search" aria-label="Check an agent" onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <label htmlFor="agent-lookup" className="font-display text-lg font-bold">
        Check an agent
      </label>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          id="agent-lookup"
          name="account"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="agent-lookup-help"
          placeholder="seller-agent.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`${FIELD} min-w-0 flex-1 font-mono text-sm`}
        />
        <Button type="submit" size="lg">
          <Search aria-hidden="true" />
          Show record
        </Button>
      </div>
      <span id="agent-lookup-help" className={`text-xs ${error ? "text-no" : "text-muted"}`}>
        {error ?? "Wins, losses, appeals and silence of a NEAR account, read from every court case."}
      </span>
    </form>
  );
}
