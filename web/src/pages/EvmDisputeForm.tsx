import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { formatEther, parseEventLogs } from "viem";
import { useBalance, useConfig, useConnect, useConnection, useConnectors, useWriteContract } from "wagmi";
import { readContract, simulateContract, waitForTransactionReceipt } from "wagmi/actions";
import { aiOracleAbi, disputeAbi } from "../abi.js";
import { Button } from "../components/ui/button.js";
import { Wallet } from "../components/Wallet.js";
import { explorer } from "../deployment.js";
import type { EvmChainConfig } from "../evm-chains.js";
import { useDisputeLimits } from "../chain-hooks.js";
import { describeTxError, questionBytes, validateDispute, type DisputeErrors } from "../lib/dispute.js";
import { EXPLORER_NAME, SOURCE_NAME, SOURCE_SHORT } from "../sources.js";
import { ExamplePicker, FIELD } from "./DisputeFields.js";

type Phase = "idle" | "checking" | "signing" | "confirming" | "error";

function phaseLabel(phase: Phase, chain: string): string {
  if (phase === "checking") return "Checking with the contract…";
  if (phase === "signing") return "Confirm in your wallet…";
  if (phase === "confirming") return `Waiting for ${chain}…`;
  return "Open dispute";
}

export function EvmDisputeForm({ cfg }: { cfg: EvmChainConfig }) {
  const config = useConfig();
  const navigate = useNavigate();
  const { address, chainId, status } = useConnection();
  const { limits, error: limitsError, refetch: refetchLimits } = useDisputeLimits(cfg);
  const balance = useBalance({ address, chainId: cfg.chain.id, query: { enabled: address !== undefined } });
  const name = SOURCE_NAME[cfg.source];
  const short = SOURCE_SHORT[cfg.source];
  const write = useWriteContract();
  const connect = useConnect();
  const connectors = useConnectors();
  const [question, setQuestion] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [stakeEth, setStakeEth] = useState("0.001");
  const [errors, setErrors] = useState<DisputeErrors>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const ready = status === "connected" && chainId === cfg.chain.id && limits !== null;
  const busy = phase === "checking" || phase === "signing" || phase === "confirming";
  const bytes = questionBytes(question.trim());
  const preview = limits ? validateDispute({ question: "x", counterparty: cfg.dispute, stakeEth }, limits, undefined) : null;
  const total = limits && preview?.ok ? limits.fee + preview.value.stakeWei : null;
  const lowBalance = total !== null && balance.data !== undefined && balance.data.value < total;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address) {
      if (limits) {
        const preview = validateDispute({ question, counterparty, stakeEth }, limits, undefined);
        setErrors(preview.ok ? {} : preview.errors);
      }
      const connector = connectors[0];
      if (connector) connect.mutate({ connector });
      return;
    }
    if (!limits) return;
    const checked = validateDispute({ question, counterparty, stakeEth }, limits, address);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setMessage(null);
    try {
      setPhase("checking");
      const currentFee = await readContract(config, { address: cfg.aiOracle, abi: aiOracleAbi, functionName: "fee", chainId: cfg.chain.id });
      if (currentFee !== limits.fee) {
        await refetchLimits();
        setPhase("error");
        setMessage(`The oracle fee changed to ${formatEther(currentFee)} ETH. Check the new total and open the dispute again.`);
        return;
      }
      const { request } = await simulateContract(config, {
        address: cfg.dispute,
        abi: disputeAbi,
        functionName: "openDispute",
        args: [checked.value.question, checked.value.counterparty, limits.fee],
        value: limits.fee + checked.value.stakeWei,
        account: address,
        chainId: cfg.chain.id,
      });
      setPhase("signing");
      const hash = await write.mutateAsync(request);
      setTxHash(hash);
      setPhase("confirming");
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: cfg.chain.id });
      const own = receipt.logs.filter((l) => l.address.toLowerCase() === cfg.dispute.toLowerCase());
      const opened = parseEventLogs({ abi: disputeAbi, eventName: "DisputeOpened", logs: own }).find((e) => e.args.claimant.toLowerCase() === address.toLowerCase());
      if (receipt.status !== "success" || !opened) throw new Error("the dispute transaction reverted");
      navigate(`/app/r/${cfg.source}/${opened.args.id.toString()}`);
    } catch (err) {
      setPhase("error");
      setMessage(describeTxError(err, name));
    }
  }

  const txLink = txHash ? explorer.tx(cfg.source, txHash) : null;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-paper/60 px-3 py-2">
        <span className="text-sm text-muted">Wallet on {name}</span>
        <Wallet chain={cfg.chain} />
      </div>

      <ExamplePicker onPick={setQuestion} />

      <div className="flex flex-col gap-1">
        <label htmlFor="question" className="font-medium">
          Question with the evidence
        </label>
        <textarea
          id="question"
          name="question"
          rows={5}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={errors.question ? true : undefined}
          aria-describedby="question-help"
          placeholder="Contract: … Evidence: … Was the contract fulfilled?"
          className={FIELD}
        />
        <span id="question-help" className={`text-xs ${errors.question ? "text-no" : "text-muted"}`}>
          {errors.question ?? `${bytes} of ${limits?.maxQuestionBytes ?? 2000} bytes. The models answer YES, NO or UNKNOWN.`}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="counterparty" className="font-medium">
          Counterparty address
        </label>
        <input
          id="counterparty"
          name="counterparty"
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          aria-invalid={errors.counterparty ? true : undefined}
          aria-describedby="counterparty-help"
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className={`${FIELD} font-mono text-sm`}
        />
        <span id="counterparty-help" className={`text-xs ${errors.counterparty ? "text-no" : "text-muted"}`}>
          {errors.counterparty ?? "Gets the stake if the answer is NO."}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="stake" className="font-medium">
          Your stake in ETH
        </label>
        <input
          id="stake"
          name="stake"
          inputMode="decimal"
          value={stakeEth}
          onChange={(e) => setStakeEth(e.target.value)}
          aria-invalid={errors.stake ? true : undefined}
          aria-describedby="stake-help"
          className={`${FIELD} max-w-48`}
        />
        <span id="stake-help" className={`text-xs ${errors.stake ? "text-no" : "text-muted"}`}>
          {errors.stake ?? (limits ? `At least ${formatEther(limits.minStakeWei)} ETH. YES returns it to you, NO sends it to the counterparty, UNKNOWN lets you take it back.` : `Reading the limits from ${short}…`)}
        </span>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {limits && total !== null && (
          <p className="m-0 text-sm">
            You pay <strong>{formatEther(total)} ETH</strong>: the stake plus the {formatEther(limits.fee)} ETH oracle fee, and gas.
          </p>
        )}
        {lowBalance && (
          <p className="m-0 text-sm text-no">
            Your wallet has {formatEther(balance.data?.value ?? 0n)} ETH on {name}.{" "}
            <a href={cfg.faucetUrl} target="_blank" rel="noopener noreferrer" className="underline">
              Get test ETH from a faucet
            </a>
            .
          </p>
        )}
        {limitsError && <p className="m-0 text-sm text-no">Could not read the dispute limits from {short}. Reload the page.</p>}
        <Button type="submit" size="lg" disabled={busy || (status === "connected" && !ready)} className="self-start">
          {status === "connected" ? phaseLabel(phase, short) : "Connect wallet to open"}
        </Button>
        {!ready && !busy && <p className="m-0 text-xs text-muted">Connect a wallet on {name} to open a dispute.</p>}
        <p className="m-0 text-xs text-muted">
          Need test ETH?{" "}
          <a href={cfg.faucetUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-bronze-text">
            {name} faucets
          </a>
        </p>
        {txLink && (
          <a href={txLink} target="_blank" rel="noopener noreferrer" className="text-sm underline">
            View the transaction on {EXPLORER_NAME[cfg.source]}
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
