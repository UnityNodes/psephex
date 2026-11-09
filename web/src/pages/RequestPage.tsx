import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { formatEther } from "viem";
import { useConfig, useConnection, useWriteContract } from "wagmi";
import { simulateContract, waitForTransactionReceipt } from "wagmi/actions";
import { disputeAbi } from "../abi.js";
import type { RequestDetail } from "../api.js";
import { Ballots } from "../components/Ballots.js";
import { Commands } from "../components/Commands.js";
import { Steps } from "../components/Steps.js";
import { shortAddress } from "../components/Wallet.js";
import { CHAIN, DISPUTE_ADDRESS, explorer } from "../deployment.js";
import { useCase, useChainQuestionHash, usePageTitle, useRequestDetail, useSettlementWinner, useVerifyPlan } from "../hooks.js";
import { describeTxError, displayText } from "../lib/dispute.js";
import { ballots, canRefund, deriveProgress, questionMatchesChain, type CaseInfo, type Outcome, type StepKey } from "../lib/steps.js";

const ID = /^[1-9]\d{0,14}$/;
const CLOCK_MS = 5_000;

function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-bronze">
      {children}
    </a>
  );
}

function stepLinks(detail: RequestDetail | null): Partial<Record<StepKey, ReactNode>> {
  if (!detail) return {};
  const nearOk = detail.near.find((t) => t.ok === true);
  const baseOk = detail.base.find((t) => t.status === "success");
  return {
    asked: <ExternalLink href={explorer.baseTx(detail.askedTx)}>Ask transaction on Basescan</ExternalLink>,
    near: nearOk ? <ExternalLink href={explorer.nearTx(nearOk.txHash)}>NEAR transaction on Nearblocks</ExternalLink> : null,
    base: baseOk ? <ExternalLink href={explorer.baseTx(baseOk.txHash)}>Answer transaction on Basescan</ExternalLink> : null,
  };
}

function outcomeText(outcome: Outcome, caseInfo: CaseInfo | null, detail: RequestDetail | null, now: bigint): string {
  const stake = caseInfo ? `${formatEther(caseInfo.amount)} ETH` : "The stake";
  switch (outcome) {
    case "claimant":
      return `YES. ${stake} went back to the claimant ${caseInfo ? shortAddress(caseInfo.claimant) : ""}.`;
    case "counterparty":
      return `NO. ${stake} went to the counterparty ${caseInfo ? shortAddress(caseInfo.counterparty) : ""}.`;
    case "escalated":
      return `UNKNOWN. The models could not decide, so the claimant can take back ${stake} now.`;
    case "refunded":
      if (detail && (detail.status === "failed" || detail.status === "rejected")) return `The relayer stopped this dispute (${detail.reason ?? detail.status}), and the stake of ${stake} was refunded to the claimant.`;
      if (detail?.answer === "UNKNOWN") return `UNKNOWN, so the claimant took back ${stake}.`;
      return `${stake} went back to the claimant.`;
    case "settled":
      return "The dispute is settled on Base. The Dispute contract on Basescan shows where the stake went.";
    case "failed": {
      const wait = caseInfo && now < caseInfo.deadline ? ` The refund opens in about ${Math.ceil(Number(caseInfo.deadline - now) / 60)} min.` : " The refund is open.";
      return `The oracle stopped on this dispute: ${detail?.reason ?? "no reason recorded"}.${wait}`;
    }
    default:
      return "Waiting for the answer. This page updates on its own.";
  }
}

function useNowSeconds(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function RefundButton({ id, onDone }: { id: number; onDone: () => void }) {
  const config = useConfig();
  const { status, chainId, address } = useConnection();
  const write = useWriteContract();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = status === "connected" && chainId === CHAIN.id;

  async function handleRefund() {
    setBusy(true);
    setMessage(null);
    try {
      const { request } = await simulateContract(config, { address: DISPUTE_ADDRESS, abi: disputeAbi, functionName: "refund", args: [BigInt(id)], chainId: CHAIN.id, ...(address ? { account: address } : {}) });
      const hash = await write.mutateAsync(request);
      await waitForTransactionReceipt(config, { hash, chainId: CHAIN.id });
      onDone();
    } catch (err) {
      setMessage(describeTxError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button type="button" disabled={!ready || busy} onClick={() => void handleRefund()} className="self-start rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper hover:bg-bronze disabled:opacity-50">
        {busy ? "Refunding…" : "Refund the stake to the claimant"}
      </button>
      {!ready && <p className="m-0 text-xs text-muted">Connect a wallet on {CHAIN.name}. Anyone can send the refund; the stake always goes to the claimant.</p>}
      {message && (
        <p role="alert" className="m-0 text-sm text-no">
          {message}
        </p>
      )}
    </div>
  );
}

function isMissing(loading: boolean, c: CaseInfo | null, d: RequestDetail | null): boolean {
  return !loading && c !== null && /^0x0{40}$/i.test(c.claimant) && d === null;
}

function notFoundTitle(id: number, c: CaseInfo | null, d: RequestDetail | null): string {
  return isMissing(false, c, d) ? "No dispute with this number yet" : `Dispute #${id}`;
}

export function RequestPage() {
  const raw = useParams().id ?? "";
  const valid = ID.test(raw);
  const id = valid ? Number(raw) : 0;
  const now = useNowSeconds();
  usePageTitle(valid ? `Dispute #${id} - Psephex` : "Not found - Psephex");
  const caseInfo = useCase(id, valid);
  const detail = useRequestDetail(id, valid);
  const d = detail.data ?? null;
  const terminal = d !== null && (d.status === "confirmed" || d.status === "failed" || d.status === "rejected");
  const verify = useVerifyPlan(id, valid && terminal);
  const chainHash = useChainQuestionHash(id, valid);
  const winner = useSettlementWinner(d?.base.find((t) => t.status === "success")?.txHash, id);

  if (!valid) {
    return (
      <p>
        There is no dispute with this number. <Link to="/app">Open a dispute</Link>.
      </p>
    );
  }

  const progress = deriveProgress({ detail: d, caseInfo: caseInfo.data, winner });
  const matches = d ? questionMatchesChain(d.question, chainHash) : null;
  const plan = verify.data && verify.data.requestId === id && chainHash && verify.data.questionHash.toLowerCase() === chainHash.toLowerCase() ? verify.data : null;
  const title = d && matches !== false ? displayText(d.question) : notFoundTitle(id, caseInfo.data, d);
  const notFound = isMissing(caseInfo.isLoading, caseInfo.data, d);

  return (
    <article className="flex min-w-0 flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">
          <Link to="/app" className="underline underline-offset-2">
            Disputes
          </Link>{" "}
          / #{id}
        </p>
        <h1 className="m-0 max-w-[38ch] font-display text-3xl leading-tight font-semibold break-words sm:text-4xl">{title}</h1>
        {notFound && <p className="m-0 text-muted">If you just opened it, wait a few seconds for Base to include the transaction.</p>}
        {matches === true && <p className="m-0 text-sm text-muted">This text matches the question hash stored on Base.</p>}
        {matches === false && (
          <p role="alert" className="m-0 text-sm text-no">
            The API returned a question that does not match the hash stored on Base, so it is not shown.
          </p>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="votes-heading" className="flex flex-col gap-6">
          <h2 id="votes-heading" className="m-0 font-display text-2xl font-semibold">
            The vote
          </h2>
          <Ballots ballots={d ? ballots(d) : []} verdict={d?.answer ?? null} stopped={d !== null && (d.status === "failed" || d.status === "rejected")} />
          <div role="status" className="rounded-md border-l-4 border-bronze bg-paper p-4">
            {detail.isError && <p className="m-0 text-no">The Psephex API did not answer. This page retries on its own; the chain data below is still live.</p>}
            {!detail.isError && (d !== null || notFound) && <p className="m-0 [overflow-wrap:anywhere]">{outcomeText(progress.outcome, caseInfo.data, d, now)}</p>}
            {!detail.isError && d === null && !notFound && <p className="m-0 text-muted">Loading the dispute…</p>}
            {progress.outcome === "settled" && (
              <a href={explorer.baseAddress(DISPUTE_ADDRESS) ?? undefined} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline underline-offset-2 hover:text-bronze">
                Dispute contract on Basescan
              </a>
            )}
            {canRefund(caseInfo.data, now) && <RefundButton id={id} onDone={() => void caseInfo.refetch()} />}
          </div>
        </section>

        <section aria-labelledby="path-heading">
          <h2 id="path-heading" className="m-0 mb-6 font-display text-2xl font-semibold">
            The path of this dispute
          </h2>
          <Steps steps={progress.steps} links={stepLinks(d)} />
        </section>
      </div>

      {plan && (
        <section aria-labelledby="verify-heading" className="flex min-w-0 flex-col gap-4">
          <h2 id="verify-heading" className="m-0 font-display text-2xl font-semibold">
            Check it yourself
          </h2>
          <p className="m-0 max-w-[65ch] text-muted">
            {plan.available
              ? "These commands re-run the signature and 2-of-3 check on the NEAR contract and read the answer from Base."
              : "The model signatures cannot be re-checked here; these commands confirm the question and the result on Base."}{" "}
            They need <code className="font-mono text-sm">near</code>, <code className="font-mono text-sm">cast</code> and <code className="font-mono text-sm">jq</code>, and trust nothing but the two chains.
          </p>
          <Commands plan={plan} />
        </section>
      )}
    </article>
  );
}
