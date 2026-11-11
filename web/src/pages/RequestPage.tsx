import { ArrowUpRight } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router";
import type { RequestDetail } from "../api.js";
import { Ballots } from "../components/Ballots.js";
import { ChainBadge } from "../components/ChainBadge.js";
import { Commands, toolsUsed } from "../components/Commands.js";
import { Steps } from "../components/Steps.js";
import { Badge } from "../components/ui/badge.js";
import { explorer, NEAR_COURT_CONTRACT, NEAR_DISPUTE_CONTRACT } from "../deployment.js";
import { evmChain, type EvmChainConfig } from "../evm-chains.js";
import { useCase, useChainQuestionHash, useSettlementWinner } from "../chain-hooks.js";
import { usePageTitle, useRequestDetail, useVerifyPlan } from "../hooks.js";
import { OVERVIEW_TITLE, requestName, statusLabel } from "../lib/status.js";
import { ballots, canRefund, deriveProgress, questionMatchesChain, type CaseInfo, type StepKey } from "../lib/steps.js";
import { isCourtRequest, requestHeadline } from "../lib/court.js";
import { displayText } from "../lib/text.js";
import { useCaseByRequest } from "../near/court-hooks.js";
import { useNearAsker, useNearCase, useNearQuestionHash } from "../near/hooks.js";
import { EXPLORER_NAME, isSource, SOURCE_NAME, SOURCE_SHORT, type EvmSource, type Source } from "../sources.js";
import { outcomeText } from "./outcome.js";
import { EvmRefundButton, NearRefundButton } from "./RefundButtons.js";

const ID = /^[1-9]\d{0,14}$/;
const CLOCK_MS = 5_000;

function toolList(tools: readonly string[]): ReactNode {
  return tools.map((tool, i) => (
    <Fragment key={tool}>
      {i === 0 ? "" : i === tools.length - 1 ? " and " : ", "}
      <code className="font-mono text-sm">{tool}</code>
    </Fragment>
  ));
}

export function LegacyRequestRedirect() {
  const raw = useParams().id ?? "";
  return <Navigate to={`/app/r/base/${encodeURIComponent(raw)}`} replace />;
}

function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-bronze-text">
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </a>
  );
}

export function stepLinks(detail: RequestDetail | null): Partial<Record<StepKey, ReactNode>> {
  if (!detail) return {};
  const source = detail.source;
  const nearOk = detail.near.find((t) => t.ok === true);
  const nearLink = nearOk ? <ExternalLink href={explorer.tx("near", nearOk.txHash)}>NEAR transaction on Nearblocks</ExternalLink> : null;
  if (source === "near") {
    return { asked: <ExternalLink href={explorer.tx("near", detail.askedTx)}>Ask transaction on Nearblocks</ExternalLink>, stored: nearLink };
  }
  const site = EXPLORER_NAME[source];
  const deliveredOk = detail.base.find((t) => t.status === "success");
  return {
    asked: <ExternalLink href={explorer.tx(source, detail.askedTx)}>{`Ask transaction on ${site}`}</ExternalLink>,
    near: nearLink,
    delivered: deliveredOk ? <ExternalLink href={explorer.tx(source, deliveredOk.txHash)}>{`Answer transaction on ${site}`}</ExternalLink> : null,
  };
}

function useNowSeconds(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

interface ChainState {
  readonly caseInfo: CaseInfo | null;
  readonly caseLoading: boolean;
  readonly missing: boolean;
  readonly chainHash: string | undefined;
  readonly winner: string | null;
  readonly settledLink: string | null;
  readonly refund: ReactNode;
  readonly courtCase?: number | null;
}

function RequestView({ source, id, detail, apiError, chain, now }: { source: Source; id: number; detail: RequestDetail | null; apiError: boolean; chain: ChainState; now: bigint }) {
  const terminal = detail !== null && (detail.status === "confirmed" || detail.status === "failed" || detail.status === "rejected");
  const verify = useVerifyPlan(source, id, terminal);
  const chainName = SOURCE_SHORT[source];
  const progress = deriveProgress({ detail, caseInfo: chain.caseInfo, winner: chain.winner, source });
  const matches = detail ? questionMatchesChain(detail.question, chain.chainHash) : null;
  const plan = verify.data && verify.data.requestId === id && chain.chainHash && verify.data.questionHash.toLowerCase() === chain.chainHash.toLowerCase() ? verify.data : null;
  const notFound = !chain.caseLoading && chain.missing && detail === null;
  const title = detail && matches !== false ? requestHeadline(detail) : notFound ? "No request with this number yet" : requestName(source, id);
  const fullQuestion = detail && matches !== false && isCourtRequest(detail) ? detail.question.split("\n") : null;
  const stopped = detail !== null && (detail.status === "failed" || detail.status === "rejected");

  return (
    <article className="flex min-w-0 flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <span>
            <Link to="/app" className="underline underline-offset-2 hover:text-bronze-text">
              {OVERVIEW_TITLE}
            </Link>{" "}
            / #{id}
          </span>
          <ChainBadge source={source} />
          {detail && <Badge variant="outline">{statusLabel(detail.status, source)}</Badge>}
        </div>
        <h1 className="m-0 max-w-[34ch] font-display text-2xl leading-tight font-bold break-words sm:text-3xl">{title}</h1>
        {chain.courtCase && (
          <p className="m-0 text-sm">
            The court asked this question for{" "}
            <Link to={`/app/case/${chain.courtCase}`} className="underline underline-offset-2 hover:text-bronze-text">
              case #{chain.courtCase}
            </Link>
            .
          </p>
        )}
        {notFound && <p className="m-0 text-muted">If you just opened it, wait a few seconds for {SOURCE_NAME[source]} to include the transaction.</p>}
        {fullQuestion && (
          <div aria-label="The question the models got" role="group" className="flex flex-col gap-1 rounded-lg border border-line bg-paper p-3 font-mono text-xs [overflow-wrap:anywhere]">
            {fullQuestion.map((line, i) => (
              <p key={i} className="m-0">
                {displayText(line)}
              </p>
            ))}
          </div>
        )}
        {matches === true && <p className="m-0 text-sm text-muted">{fullQuestion ? "This question" : "This text"} matches the question hash stored on {chainName}.</p>}
        {matches === false && (
          <p role="alert" className="m-0 text-sm text-no">
            The API returned a question that does not match the hash stored on {chainName}, so it is not shown.
          </p>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
        <section aria-labelledby="votes-heading" className="flex flex-col gap-6">
          <h2 id="votes-heading" className="m-0 font-display text-2xl font-semibold">
            The vote
          </h2>
          <Ballots ballots={detail ? ballots(detail) : []} verdict={detail?.answer ?? null} stopped={stopped} />
          <div role="status" className="rounded-xl border border-line border-l-4 border-l-bronze bg-paper p-5">
            {apiError && <p className="m-0 text-no">The Psephex API did not answer. This page retries on its own; the chain data below is still live.</p>}
            {!apiError && (detail !== null || notFound) && <p className="m-0 [overflow-wrap:anywhere]">{outcomeText(progress.outcome, chain.caseInfo, detail, now, source)}</p>}
            {!apiError && detail === null && !notFound && <p className="m-0 text-muted">Loading the request…</p>}
            {progress.outcome === "settled" && chain.settledLink && (
              <a href={chain.settledLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline underline-offset-2 hover:text-bronze-text">
                Dispute contract on {EXPLORER_NAME[source]}
              </a>
            )}
            {canRefund(chain.caseInfo, now) && chain.refund}
          </div>
        </section>

        <section aria-labelledby="path-heading">
          <h2 id="path-heading" className="m-0 mb-6 font-display text-2xl font-semibold">
            The path of this request
          </h2>
          <Steps steps={progress.steps} links={stepLinks(detail)} />
        </section>
      </div>

      {plan && (
        <section aria-labelledby="verify-heading" className="flex min-w-0 flex-col gap-4">
          <h2 id="verify-heading" className="m-0 font-display text-2xl font-semibold">
            Check it yourself
          </h2>
          <p className="m-0 max-w-[65ch] text-muted">
            {source === "near"
              ? "These commands re-run the signature and 2-of-3 check on the NEAR contract and read the stored verdict from its state."
              : plan.available
                ? `These commands re-run the signature and 2-of-3 check on the NEAR contract and read the answer from ${chainName}.`
                : `The model signatures cannot be re-checked here; these commands confirm the question and the result on ${chainName}.`}{" "}
            They need {toolList(toolsUsed(plan))}, and trust nothing but the chains.
          </p>
          <Commands plan={plan} />
        </section>
      )}
    </article>
  );
}

function EvmRequest({ cfg, id, now }: { cfg: EvmChainConfig; id: number; now: bigint }) {
  const caseInfo = useCase(cfg, id, true);
  const detail = useRequestDetail(cfg.source, id, true);
  const d = detail.data ?? null;
  const chainHash = useChainQuestionHash(cfg, id, true);
  const winner = useSettlementWinner(cfg, d?.base.find((t) => t.status === "success")?.txHash, id);
  const chain: ChainState = {
    caseInfo: caseInfo.data,
    caseLoading: caseInfo.isLoading,
    missing: caseInfo.data !== null && /^0x0{40}$/i.test(caseInfo.data.claimant),
    chainHash,
    winner,
    settledLink: explorer.address(cfg.source, cfg.dispute),
    refund: <EvmRefundButton cfg={cfg} id={id} onDone={() => void caseInfo.refetch()} />,
  };
  return <RequestView source={cfg.source} id={id} detail={d} apiError={detail.isError} chain={chain} now={now} />;
}

function NearRequest({ id, now }: { id: number; now: bigint }) {
  const nearCase = useNearCase(id, true);
  const detail = useRequestDetail("near", id, true);
  const chainHash = useNearQuestionHash(id, true);
  const fromCourt = useNearAsker(id, true) === NEAR_COURT_CONTRACT;
  const courtCase = useCaseByRequest(id, fromCourt);
  const chain: ChainState = {
    caseInfo: nearCase.data,
    caseLoading: nearCase.isLoading,
    missing: !nearCase.isLoading && nearCase.data === null,
    chainHash,
    winner: nearCase.winner,
    settledLink: explorer.address("near", NEAR_DISPUTE_CONTRACT),
    refund: <NearRefundButton id={id} onDone={() => void nearCase.refetch()} />,
    courtCase: fromCourt ? (courtCase.data ?? null) : null,
  };
  return <RequestView source="near" id={id} detail={detail.data ?? null} apiError={detail.isError} chain={chain} now={now} />;
}

export function RequestPage() {
  const params = useParams();
  const rawSource = params.source ?? "base";
  const raw = params.id ?? "";
  const source: Source | null = isSource(rawSource) ? rawSource : null;
  const valid = source !== null && ID.test(raw);
  const id = valid ? Number(raw) : 0;
  const now = useNowSeconds();
  usePageTitle(valid ? `${requestName(source, id)} - Psephex` : "Not found - Psephex", valid ? `${requestName(source, id)} on Psephex: the model votes, the path through ${source === "near" ? "NEAR" : `${SOURCE_NAME[source]} and NEAR`}, and commands to check it on chain.` : undefined);

  if (!valid) {
    return (
      <p>
        There is no request with this number. <Link to="/app">See the recent requests</Link>.
      </p>
    );
  }
  if (source === "near") return <NearRequest key={id} id={id} now={now} />;
  const cfg = evmChain(source as EvmSource);
  if (!cfg) return <p>{SOURCE_NAME[source]} is not configured in this build, so its requests cannot be read here.</p>;
  return <EvmRequest key={`${source}-${id}`} cfg={cfg} id={id} now={now} />;
}
