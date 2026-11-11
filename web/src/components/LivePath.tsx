import { m, useReducedMotion } from "motion/react";
import { ArrowUpRight, Box, Coins, Cpu, Database, ShieldCheck, Signature } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Answer, RequestDetail } from "../api.js";
import { explorer, NEAR_ORACLE_CONTRACT, ORACLE_EVM_ADDRESS } from "../deployment.js";
import { ballots, modelLabel, type Ballot } from "../lib/ballots.js";
import { requestHeadline } from "../lib/court.js";
import { requestName } from "../lib/status.js";
import { SOURCE_NAME, SOURCE_SHORT } from "../sources.js";
import { BallotDisc } from "./Ballots.js";
import { BorderBeam } from "./ui/border-beam.js";

const EASE = [0.22, 1, 0.36, 1] as const;
const STEP_DELAY = 0.28;
const VERDICT_TEXT: Readonly<Record<Answer, string>> = { YES: "text-yes", NO: "text-no", UNKNOWN: "text-unknown" };

function TxLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted underline-offset-2 hover:text-bronze-text hover:underline">
      {children}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  );
}

function Node({ index, icon, where, title, children }: { index: number; icon: ReactNode; where: string; title: string; children: ReactNode }) {
  const still = useReducedMotion() === true;
  return (
    <m.li
      initial={still ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.15 + index * STEP_DELAY }}
      className="relative flex min-w-0 flex-col gap-3 pl-12 xl:pt-14 xl:pl-0"
    >
      <span className="absolute top-0 left-0 z-10 flex size-9 items-center justify-center rounded-full border border-bronze bg-stone text-bronze-text">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-bronze-text">{where}</span>
        <h3 className="m-0 font-display text-lg leading-tight font-bold">{title}</h3>
      </div>
      <div className="flex min-w-0 flex-col gap-2 text-sm text-muted">{children}</div>
    </m.li>
  );
}

function Track() {
  const still = useReducedMotion() === true;
  const grow = { duration: 1.4, ease: EASE, delay: 0.15 };
  return (
    <>
      <m.span aria-hidden="true" initial={still ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={grow} className="absolute top-4 bottom-4 left-[17px] w-px origin-top bg-gradient-to-b from-bronze via-bronze/60 to-bronze xl:hidden" />
      <m.span aria-hidden="true" initial={still ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={grow} className="absolute top-[17px] right-4 left-4 hidden h-px origin-left bg-gradient-to-r from-bronze via-bronze/60 to-bronze xl:block" />
    </>
  );
}

function Votes({ list }: { list: readonly Ballot[] }) {
  const still = useReducedMotion() === true;
  const slots: readonly (Ballot | null)[] = list.length > 0 ? list : [null, null, null];
  return (
    <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
      {slots.map((b, i) => (
        <m.li
          key={b?.model ?? i}
          initial={still ? false : { opacity: 0, y: -14, rotate: -8 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.15 + STEP_DELAY + 0.25 + i * 0.14 }}
          className="flex min-w-0 flex-col items-center gap-1 text-center"
          title={b?.model}
        >
          <BallotDisc vote={b?.vote ?? null} size={40} drop={false} />
          <span className="text-[11px] leading-tight text-ink">{b ? modelLabel(b.model) : "Waiting"}</span>
          <span className="text-[11px]">{b?.vote ?? "no vote"}</span>
        </m.li>
      ))}
    </ul>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function LivePath({ detail }: { detail: RequestDetail | null }) {
  const still = useReducedMotion() === true;
  const list = detail ? ballots(detail) : [];
  const verdict = detail?.answer ?? null;
  const agree = list.filter((b) => b.vote === verdict && verdict !== null).length;
  const source = detail?.source ?? "near";
  const evm = source !== "near";
  const chain = SOURCE_SHORT[source];
  const nearOk = detail?.near.find((t) => t.ok === true);
  const baseOk = detail?.base.find((t) => t.status === "success");
  const seconds = detail?.timeToConfirmMs != null ? (detail.timeToConfirmMs / 1000).toFixed(1) : null;

  return (
    <section aria-labelledby="latest-heading" className="relative overflow-hidden rounded-3xl border border-line bg-paper p-5 shadow-[0_30px_80px_-50px_rgb(0_0_0/0.7)] sm:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h2 id="latest-heading" className="m-0 flex items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-yes opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-yes" />
          </span>
          Latest verdict
        </h2>
        {detail && (
          <Link to={`/app/r/${detail.source}/${detail.id}`} className="text-sm font-medium text-bronze-text underline underline-offset-4 hover:text-ink">
            See how {requestName(detail.source, detail.id)} was decided
          </Link>
        )}
      </div>
      <ol key={detail ? `${detail.source}-${detail.id}` : "empty"} className={`relative m-0 grid list-none gap-8 p-0 xl:gap-6 ${evm ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
        <Track />
        <Node index={0} icon={<Box className="size-4" aria-hidden="true" />} where={SOURCE_NAME[source]} title="Question asked">
          <p className="m-0 line-clamp-4 text-ink break-words">{detail ? requestHeadline(detail) : "Waiting for the first answered request."}</p>
          {!detail && (
            <p className="m-0">
              <code className="font-mono text-xs text-ink">ask</code> with a NEAR deposit on {NEAR_ORACLE_CONTRACT}.
            </p>
          )}
          {detail && <TxLink href={explorer.tx(source, detail.askedTx)}>Ask transaction</TxLink>}
        </Node>
        <Node index={1} icon={<Cpu className="size-4" aria-hidden="true" />} where="NEAR AI and Phala TEEs" title="Three models vote">
          <Votes list={list} />
        </Node>
        <Node index={2} icon={<ShieldCheck className="size-4" aria-hidden="true" />} where="NEAR contract" title="Two of three agree">
          {verdict ? (
            <>
              <p className={`m-0 font-display text-4xl leading-none font-extrabold xl:text-3xl 2xl:text-4xl ${VERDICT_TEXT[verdict]}`}>{verdict}</p>
              <p className="m-0">
                {agree} of {list.length} signed answers say <strong className={VERDICT_TEXT[verdict]}>{verdict}</strong>; two are enough.
              </p>
            </>
          ) : (
            <p className="m-0">The verdict needs two matching signed answers.</p>
          )}
          {nearOk && <TxLink href={explorer.tx("near", nearOk.txHash)}>NEAR transaction</TxLink>}
        </Node>
        {evm ? (
          <>
            <Node index={3} icon={<Signature className="size-4" aria-hidden="true" />} where="NEAR Chain Signatures" title={`MPC signs for ${chain}`}>
              <p className="m-0">
                Sent from <span className="font-mono text-xs text-ink">{shortAddress(ORACLE_EVM_ADDRESS)}</span>, an address only NEAR MPC can sign for.
              </p>
            </Node>
            <Node index={4} icon={<Coins className="size-4" aria-hidden="true" />} where={SOURCE_NAME[source]} title={`${chain} pays out`}>
              {seconds ? (
                <p className="m-0">
                  Answered on {chain} <span className="font-display text-2xl font-bold text-ink">{seconds} s</span> after the relayer saw it.
                </p>
              ) : (
                <p className="m-0">AiOracle calls the asking contract with the answer.</p>
              )}
              {baseOk && <TxLink href={explorer.tx(source, baseOk.txHash)}>Answer transaction</TxLink>}
            </Node>
          </>
        ) : (
          <Node index={3} icon={<Database className="size-4" aria-hidden="true" />} where="NEAR contract state" title="Verdict stored on NEAR">
            {seconds ? (
              <p className="m-0">
                Stored <span className="font-display text-2xl font-bold text-ink">{seconds} s</span> after the relayer saw the question.
              </p>
            ) : (
              <p className="m-0">
                The verdict stays in the contract, and <code className="font-mono text-xs text-ink">on_answer</code> goes to the asker if it asked for a callback.
              </p>
            )}
          </Node>
        )}
      </ol>
      {!still && <BorderBeam size={120} duration={10} borderWidth={1.5} colorFrom="var(--bronze-hi)" colorTo="var(--bronze-lo)" />}
    </section>
  );
}
