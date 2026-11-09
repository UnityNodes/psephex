import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { NearAccount } from "../components/NearAccount.js";
import { Button } from "../components/ui/button.js";
import { explorer, NEAR_COURT_CONTRACT, NEAR_FAUCET_URL } from "../deployment.js";
import { CASE_EXAMPLES, caseDepositTotal, caseIdFrom, DEFAULT_MAX_FIELD_BYTES, describeCourtError, OPEN_CASE_GAS, oneLine, quotedBytes, validateCase, type CaseErrors } from "../lib/court.js";
import { formatNear, parseNear } from "../lib/near-dispute.js";
import { readCasePrices, readCourtConfig, useCasePrices, useCourtConfig } from "../near/court-hooks.js";
import { useNearRpc } from "../near/rpc.js";
import { canConnect, useNearWallet } from "../near/wallet.js";
import { FIELD } from "./DisputeFields.js";

type Phase = "idle" | "checking" | "signing" | "confirming" | "error";

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  idle: "Open the case",
  checking: "Reading the deposit from NEAR…",
  signing: "Confirm in your wallet…",
  confirming: "Waiting for NEAR…",
  error: "Open the case",
};

export function ByteHelp({ id, text, max, error, hint }: { id: string; text: string; max: number; error: string | undefined; hint: string }) {
  const trimmed = text.trim();
  const bytes = trimmed ? quotedBytes(trimmed) : 0;
  const over = bytes > max;
  return (
    <span id={id} className={`text-xs ${error || over ? "text-no" : "text-muted"}`}>
      {error ?? `${bytes} of ${max} bytes as the court quotes it (one line; quotes and backslashes count twice). ${hint}`}
    </span>
  );
}

function CaseExamples({ onPick }: { onPick: (claim: string, evidence: string) => void }) {
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">Start from an example</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {CASE_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.claim, ex.evidence)}
            className="flex min-h-11 flex-col rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-left transition-colors duration-150 hover:border-bronze hover:bg-paper"
          >
            <span className="block text-sm font-medium">{ex.label}</span>
            <span className="line-clamp-2 block text-xs text-muted">{ex.claim}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function CaseForm() {
  const navigate = useNavigate();
  const wallet = useNearWallet();
  const rpc = useNearRpc();
  const config = useCourtConfig();
  const [claim, setClaim] = useState("");
  const [evidence, setEvidence] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [stakeNear, setStakeNear] = useState("0.1");
  const [errors, setErrors] = useState<CaseErrors>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const prices = useCasePrices(config.data?.oracle, claim.trim(), evidence.trim());

  const accountId = wallet.accountId;
  const maxBytes = config.data?.maxFieldBytes ?? DEFAULT_MAX_FIELD_BYTES;
  const busy = phase === "checking" || phase === "signing" || phase === "confirming";
  const stake = parseNear(stakeNear);
  const total = stake !== null && prices.data ? caseDepositTotal({ stake, ...prices.data }) : null;
  const canSubmit = accountId ? config.data !== undefined : canConnect(wallet);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) {
      await wallet.connect().catch((err: unknown) => setMessage(describeCourtError(err)));
      return;
    }
    if (!config.data) return;
    const checked = validateCase({ claim, evidence, counterparty, stakeNear }, config.data, accountId);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setMessage(null);
    try {
      setPhase("checking");
      if (!(await rpc.accountExists(checked.value.counterparty))) {
        setPhase("idle");
        setErrors({ counterparty: `${checked.value.counterparty} does not exist on NEAR testnet. Check the spelling.` });
        return;
      }
      const freshConfig = await readCourtConfig(rpc);
      const fresh = await readCasePrices(rpc, freshConfig.oracle, checked.value.claim, checked.value.evidence);
      const freshTotal = caseDepositTotal({ stake: checked.value.stake, ...fresh });
      if (total !== null && freshTotal !== total) {
        setPhase("idle");
        setMessage(`The deposit changed to ${formatNear(freshTotal)} NEAR while you were typing. Check it and open the case again.`);
        await prices.refetch();
        return;
      }
      setPhase("signing");
      const hash = await wallet.call({
        receiverId: NEAR_COURT_CONTRACT,
        methodName: "open_case",
        args: { claim: checked.value.claim, evidence: checked.value.evidence, counterparty: checked.value.counterparty, oracle_reserve: fresh.oracleReserve.toString() },
        gas: OPEN_CASE_GAS,
        deposit: freshTotal,
      });
      setTxHash(hash);
      setPhase("confirming");
      const result = await rpc.txResult(hash, accountId);
      if (!result.ok) throw new Error(result.error);
      const id = caseIdFrom(result.value);
      if (id === null) throw new Error("the court did not return a case id");
      navigate(`/app/case/${id}`);
    } catch (err) {
      setPhase("error");
      setMessage(describeCourtError(err));
    }
  }

  const txLink = txHash ? explorer.tx("near", txHash) : null;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper/60 px-3 py-2">
        <span className="text-sm text-muted">Wallet on NEAR testnet</span>
        <NearAccount />
      </div>

      <p className="m-0 text-sm text-muted">
        You open a case on {NEAR_COURT_CONTRACT}. The counterparty answers with its own evidence, the court writes one question from both sides, three TEE models decide, and either side can appeal to a human arbiter.
      </p>

      <CaseExamples
        onPick={(c, e) => {
          setClaim(oneLine(c));
          setEvidence(oneLine(e));
        }}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="case-claim" className="font-medium">
          Claim
        </label>
        <textarea
          id="case-claim"
          name="claim"
          rows={2}
          value={claim}
          onChange={(e) => setClaim(oneLine(e.target.value))}
          aria-invalid={errors.claim ? true : undefined}
          aria-describedby="case-claim-help"
          placeholder="The seller agent delivered 60 of the 100 rows I paid for."
          className={FIELD}
        />
        <ByteHelp id="case-claim-help" text={claim} max={maxBytes} error={errors.claim} hint="YES means the models found the claim true." />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="case-evidence" className="font-medium">
          Your evidence
        </label>
        <textarea
          id="case-evidence"
          name="evidence"
          rows={4}
          value={evidence}
          onChange={(e) => setEvidence(oneLine(e.target.value))}
          aria-invalid={errors.evidence ? true : undefined}
          aria-describedby="case-evidence-help"
          placeholder="Order: … Delivered: …"
          className={FIELD}
        />
        <ByteHelp id="case-evidence-help" text={evidence} max={maxBytes} error={errors.evidence} hint="The models see only this text and the counterparty's response." />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="case-counterparty" className="font-medium">
          Counterparty account
        </label>
        <input
          id="case-counterparty"
          name="counterparty"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          aria-invalid={errors.counterparty ? true : undefined}
          aria-describedby="case-counterparty-help"
          placeholder="seller-agent.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`${FIELD} font-mono text-sm`}
        />
        <span id="case-counterparty-help" className={`text-xs ${errors.counterparty ? "text-no" : "text-muted"}`}>
          {errors.counterparty ??
            (config.data ? `Can respond within ${config.data.responseWindowSec} s, and gets the stake if the verdict is NO.` : "Can respond within the response window, and gets the stake if the verdict is NO.")}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="case-stake" className="font-medium">
          Stake in NEAR
        </label>
        <input
          id="case-stake"
          name="stake"
          inputMode="decimal"
          value={stakeNear}
          onChange={(e) => setStakeNear(e.target.value)}
          aria-invalid={errors.stake ? true : undefined}
          aria-describedby="case-stake-help"
          className={`${FIELD} max-w-48`}
        />
        <span id="case-stake-help" className={`text-xs ${errors.stake ? "text-no" : "text-muted"}`}>
          {errors.stake ??
            (config.data ? `At least ${formatNear(config.data.minStake)} NEAR. YES or UNKNOWN returns it to you, NO sends it to the counterparty.` : "Reading the limits from NEAR…")}
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {total !== null && prices.data && (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-sm [overflow-wrap:anywhere]">
              You attach <strong>{formatNear(total)} NEAR</strong>: the stake, a {formatNear(prices.data.oracleReserve)} NEAR oracle reserve and {formatNear(prices.data.storageDeposit)} NEAR for storing the case. Gas is 100 Tgas.
            </p>
            <p className="m-0 text-xs text-muted">The reserve covers the oracle price of the longest possible question because the response is not written yet; the part the oracle does not charge comes back to you when the case goes to the oracle.</p>
          </div>
        )}
        {total === null && (claim.trim().length === 0 || evidence.trim().length === 0) && <p className="m-0 text-sm text-muted">Write the claim and the evidence to price the deposit.</p>}
        {(config.isError || prices.isError) && <p className="m-0 text-sm text-no">Could not read the court contract on NEAR testnet. Reload the page.</p>}
        <Button type="submit" size="lg" disabled={busy || !canSubmit} onPointerEnter={wallet.prepare} onFocus={wallet.prepare} className="self-start">
          {accountId ? PHASE_LABEL[phase] : "Connect NEAR to open"}
        </Button>
        <p className="m-0 text-xs text-muted">
          Need test NEAR?{" "}
          <a href={NEAR_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-bronze-text">
            NEAR testnet faucet
          </a>
        </p>
        {txLink && (
          <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-sm underline">
            View the transaction on Nearblocks
          </a>
        )}
        {message && (
          <p role="alert" className="m-0 text-sm text-no">
            {message}
          </p>
        )}
      </div>
    </form>
  );
}
