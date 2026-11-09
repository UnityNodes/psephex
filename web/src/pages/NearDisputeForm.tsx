import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { NearAccount } from "../components/NearAccount.js";
import { Button } from "../components/ui/button.js";
import { explorer, NEAR_DISPUTE_CONTRACT, NEAR_FAUCET_URL } from "../deployment.js";
import { questionBytes } from "../lib/dispute.js";
import {
  describeNearError,
  formatNear,
  MAX_QUESTION_BYTES,
  nearDepositTotal,
  OPEN_DISPUTE_GAS,
  parseNear,
  requestIdFrom,
  validateNearDispute,
  type NearDisputeErrors,
} from "../lib/near-dispute.js";
import { readNearPrices, useNearDisputeConfig, useNearPrices } from "../near/hooks.js";
import { useNearRpc } from "../near/rpc.js";
import { canConnect, useNearWallet } from "../near/wallet.js";
import { ExamplePicker, FIELD } from "./DisputeFields.js";

type Phase = "idle" | "checking" | "signing" | "confirming" | "error";

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  idle: "Open dispute",
  checking: "Reading the deposit from NEAR…",
  signing: "Confirm in your wallet…",
  confirming: "Waiting for NEAR…",
  error: "Open dispute",
};

export function NearDisputeForm() {
  const navigate = useNavigate();
  const wallet = useNearWallet();
  const rpc = useNearRpc();
  const config = useNearDisputeConfig();
  const [question, setQuestion] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [stakeNear, setStakeNear] = useState("0.1");
  const [errors, setErrors] = useState<NearDisputeErrors>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const prices = useNearPrices(question.trim());

  const accountId = wallet.accountId;
  const busy = phase === "checking" || phase === "signing" || phase === "confirming";
  const bytes = questionBytes(question.trim());
  const stake = parseNear(stakeNear);
  const total = stake !== null && prices.data ? nearDepositTotal({ stake, ...prices.data }) : null;
  const canSubmit = accountId ? config.data !== undefined : canConnect(wallet);
  const { prepare } = wallet;
  useEffect(prepare, [prepare]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId) {
      await wallet.connect().catch((err: unknown) => setMessage(describeNearError(err)));
      return;
    }
    if (!config.data) return;
    const checked = validateNearDispute({ question, counterparty, stakeNear }, config.data, accountId);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setMessage(null);
    try {
      setPhase("checking");
      const fresh = await readNearPrices(rpc, checked.value.question);
      setPhase("signing");
      const hash = await wallet.call({
        receiverId: NEAR_DISPUTE_CONTRACT,
        methodName: "open_dispute",
        args: { question: checked.value.question, counterparty: checked.value.counterparty, oracle_deposit: fresh.askDeposit.toString() },
        gas: OPEN_DISPUTE_GAS,
        deposit: nearDepositTotal({ stake: checked.value.stake, ...fresh }),
      });
      setTxHash(hash);
      setPhase("confirming");
      const result = await rpc.txResult(hash, accountId);
      if (!result.ok) throw new Error(result.error);
      const id = requestIdFrom(result.value);
      if (id === null) {
        setPhase("error");
        setMessage("The oracle did not accept the question, so the dispute contract sent the whole deposit back.");
        return;
      }
      navigate(`/app/r/near/${id}`);
    } catch (err) {
      setPhase("error");
      setMessage(describeNearError(err));
    }
  }

  const txLink = txHash ? explorer.tx("near", txHash) : null;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper/60 px-3 py-2">
        <span className="text-sm text-muted">Wallet on NEAR testnet</span>
        <NearAccount />
      </div>

      <ExamplePicker onPick={setQuestion} />

      <div className="flex flex-col gap-1">
        <label htmlFor="near-question" className="font-medium">
          Question with the evidence
        </label>
        <textarea
          id="near-question"
          name="question"
          rows={5}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={errors.question ? true : undefined}
          aria-describedby="near-question-help"
          placeholder="Contract: … Evidence: … Was the contract fulfilled?"
          className={FIELD}
        />
        <span id="near-question-help" className={`text-xs ${errors.question ? "text-no" : "text-muted"}`}>
          {errors.question ?? `${bytes} of ${MAX_QUESTION_BYTES} bytes. The models answer YES, NO or UNKNOWN.`}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="near-counterparty" className="font-medium">
          Counterparty account
        </label>
        <input
          id="near-counterparty"
          name="counterparty"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          aria-invalid={errors.counterparty ? true : undefined}
          aria-describedby="near-counterparty-help"
          placeholder="bob.testnet"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={`${FIELD} font-mono text-sm`}
        />
        <span id="near-counterparty-help" className={`text-xs ${errors.counterparty ? "text-no" : "text-muted"}`}>
          {errors.counterparty ?? "Gets the stake if the answer is NO."}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="near-stake" className="font-medium">
          Your stake in NEAR
        </label>
        <input
          id="near-stake"
          name="stake"
          inputMode="decimal"
          value={stakeNear}
          onChange={(e) => setStakeNear(e.target.value)}
          aria-invalid={errors.stake ? true : undefined}
          aria-describedby="near-stake-help"
          className={`${FIELD} max-w-48`}
        />
        <span id="near-stake-help" className={`text-xs ${errors.stake ? "text-no" : "text-muted"}`}>
          {errors.stake ??
            (config.data
              ? `At least ${formatNear(config.data.minStake)} NEAR. YES returns it to you, NO sends it to the counterparty, UNKNOWN lets you take it back.`
              : "Reading the limits from NEAR…")}
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {total !== null && prices.data && (
          <p className="m-0 text-sm [overflow-wrap:anywhere]">
            You attach <strong>{formatNear(total)} NEAR</strong>: the stake, the {formatNear(prices.data.askDeposit)} NEAR oracle deposit and up to{" "}
            {formatNear(prices.data.storageDeposit)} NEAR for storing the case. Storage the case does not use is added to your stake. Gas is 100 Tgas.
          </p>
        )}
        {total === null && question.trim().length === 0 && <p className="m-0 text-sm text-muted">Write the question to price the deposit; it grows with the question length.</p>}
        {(config.isError || prices.isError) && <p className="m-0 text-sm text-no">Could not read the dispute contract on NEAR testnet. Reload the page.</p>}
        <Button type="submit" size="lg" disabled={busy || !canSubmit} className="self-start">
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
