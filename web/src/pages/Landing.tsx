import { useReducedMotion } from "motion/react";
import { Link } from "react-router";
import clientSource from "../../../contracts/base/src/examples/YesNoClient.sol?raw";
import type { Stats } from "../api.js";
import { Ballots } from "../components/Ballots.js";
import { CopyButton } from "../components/Commands.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { SiteHeader } from "../components/SiteHeader.js";
import { Button } from "../components/ui/button.js";
import { BorderBeam } from "../components/ui/border-beam.js";
import { Card } from "../components/ui/card.js";
import { NumberTicker } from "../components/ui/number-ticker.js";
import { AIORACLE_ADDRESS } from "../deployment.js";
import { useLatestVerdict, usePageTitle, useStats } from "../hooks.js";
import { displayText } from "../lib/dispute.js";
import { ballots } from "../lib/steps.js";

const STEPS: readonly { title: string; body: string; where: string }[] = [
  { where: "Base", title: "Base records the question", body: "A contract calls AiOracle.ask with a yes-or-no question and the 0.0001 ETH fee. Base stores the hash of the question." },
  {
    where: "NEAR AI and Phala",
    title: "Three models answer in TEEs",
    body: "The relayer sends the exact request the NEAR contract built to DeepSeek V4.1 and Qwen3.6 on NEAR AI and to Gemma 4 on Phala. Every answer is signed inside a TEE.",
  },
  { where: "NEAR", title: "NEAR checks two of three", body: "oracle.psephex.testnet rebuilds the request, checks every signature against the registered keys and needs two matching answers." },
  { where: "NEAR MPC", title: "NEAR MPC signs for Base", body: "The contract asks NEAR Chain Signatures to sign the Base transaction. Nobody holds the oracle's EVM key." },
  { where: "Base", title: "Base pays out", body: "AiOracle accepts the answer only from that MPC address and only for the matching request and question, then calls your contract." },
];

const PROVES: readonly string[] = [
  "Each answer was signed inside a TEE by a key registered on NEAR and attested with a fresh nonce: the model's own key on NEAR AI, the gateway's key on Phala.",
  "At least two of the three signed answers agree. The NEAR contract checks this, not our server.",
  "The models saw the request the NEAR contract built from the question on Base, with temperature 0 and a fixed seed inside the signed request.",
  "Only the MPC-derived address can deliver the answer, and only for the matching id and question. There is no bridge and no oracle key on a server.",
  "Answers repeat in practice: 80 of 80 repeats matched in our first check, and 90 of 90 for the dashboard examples.",
];

function Count({ n, word }: { n: number; word?: string }) {
  return (
    <>
      <NumberTicker value={n} className="text-ink" />
      {word && ` ${word}${n === 1 ? "" : "s"}`}
    </>
  );
}

function NumbersLine({ stats }: { stats: Stats }) {
  const answered = stats.byStatus.confirmed ?? 0;
  const avg = stats.avgSecondsSeenToConfirmed;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 max-w-[30ch] font-display text-3xl leading-tight font-medium text-muted sm:text-4xl">
        <span className="text-ink">
          <Count n={stats.total} word="dispute" />
        </span>{" "}
        so far,{" "}
        <span className="text-ink">
          <Count n={answered} /> answered on Base
        </span>
        :{" "}
        <span className="text-yes">
          <Count n={stats.answers.YES} /> YES
        </span>
        ,{" "}
        <span className="text-no">
          <Count n={stats.answers.NO} /> NO
        </span>{" "}
        and{" "}
        <span className="text-unknown">
          <Count n={stats.answers.UNKNOWN} /> UNKNOWN
        </span>
        .
      </p>
      {avg !== null && <p className="m-0 max-w-[62ch] text-sm text-muted">On average {avg} s from the relayer seeing a question to its answer on Base, counting the test runs where we killed the relayer on purpose.</p>}
    </div>
  );
}

function LiveNumbers() {
  const stats = useStats();
  return (
    <section aria-labelledby="live-heading" className="flex flex-col gap-4 border-y border-line py-10">
      <h2 id="live-heading" className="m-0 flex items-center gap-2 text-sm font-medium text-bronze-text">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-yes" />
        Live on Base Sepolia
      </h2>
      {stats.data && <NumbersLine stats={stats.data} />}
      {stats.isError && <p className="m-0 text-muted">Live numbers are unavailable right now. The contracts below are still on Basescan.</p>}
      {stats.isPending && <p className="m-0 text-muted">Reading the numbers…</p>}
    </section>
  );
}

function LatestVerdict() {
  const { detail } = useLatestVerdict();
  const still = useReducedMotion() === true;
  const seconds = detail?.timeToConfirmMs != null ? (detail.timeToConfirmMs / 1000).toFixed(1) : null;
  return (
    <Card role="region" aria-labelledby="latest-heading" className="relative gap-5 overflow-hidden rounded-2xl border-line bg-paper p-6 shadow-[0_24px_60px_-36px_rgb(0_0_0/0.55)]">
      <h2 id="latest-heading" className="m-0 text-sm font-medium text-muted">
        Latest verdict
      </h2>
      {detail ? (
        <>
          <p className="m-0 line-clamp-3 font-display text-xl leading-snug font-medium break-words">{displayText(detail.question)}</p>
          <Ballots ballots={ballots(detail)} verdict={detail.answer} compact />
          {seconds && <p className="m-0 text-sm text-muted">Answered on Base {seconds} s after the relayer saw it.</p>}
          <Link to={`/app/r/${detail.id}`} className="self-start text-sm font-medium text-bronze-text underline underline-offset-4 hover:text-ink">
            See how dispute #{detail.id} was decided
          </Link>
        </>
      ) : (
        <Ballots ballots={[]} verdict={null} compact />
      )}
      {!still && <BorderBeam size={90} duration={9} borderWidth={1.5} colorFrom="var(--bronze-hi)" colorTo="var(--bronze-lo)" />}
    </Card>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="flex scroll-mt-6 flex-col gap-10">
      <h2 id="how-heading" className="m-0 font-display text-3xl font-semibold sm:text-4xl">
        How it works
      </h2>
      <ol aria-label="How a question is answered" className="m-0 grid list-none gap-0 p-0 md:grid-cols-5 md:gap-6">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex flex-col gap-2 border-l border-line py-4 pl-5 md:border-t-2 md:border-l-0 md:border-bronze md:py-0 md:pt-5 md:pl-0">
            <span className="font-display text-sm font-medium text-bronze-text">
              {i + 1}. {s.where}
            </span>
            <h3 className="m-0 text-base font-semibold text-ink">{s.title}</h3>
            <p className="m-0 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Limits() {
  return (
    <div className="grid gap-12 md:grid-cols-2 md:gap-16">
      <section aria-labelledby="proves-heading" className="flex flex-col gap-4">
        <h2 id="proves-heading" className="m-0 font-display text-2xl font-semibold">
          What a verdict proves
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 text-[15px] marker:text-yes">
          {PROVES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="limits-heading" className="flex flex-col gap-4">
        <h2 id="limits-heading" className="m-0 font-display text-2xl font-semibold">
          What a verdict does not prove
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 text-[15px] marker:text-no">
          <li>
            That the answer is right. In{" "}
            <Link to="/app/r/2" className="underline underline-offset-2 hover:text-bronze-text">
              dispute #2
            </Link>{" "}
            all three models said 9 is a prime number, and the oracle delivered that.
          </li>
          <li>That asking again is impossible. Temperature 0 and the seed make repeats match in practice, not cryptographically.</li>
          <li>Fully independent operators. Two models run on NEAR AI and one on Phala, and on Phala one attested gateway signs for the model it routes to, so you trust that gateway.</li>
          <li>Knowledge of fresh events. Put the evidence in the question itself.</li>
          <li>A fixed set of models. The owner of the NEAR contract can change it.</li>
        </ul>
      </section>
    </div>
  );
}

function ForDevelopers() {
  return (
    <section id="developers" aria-labelledby="dev-heading" className="grid scroll-mt-6 gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <h2 id="dev-heading" className="m-0 font-display text-3xl font-semibold sm:text-4xl">
          Use it from your contract
        </h2>
        <p className="m-0 text-muted">
          Call <code className="font-mono text-sm">ask</code> with the fee and implement <code className="font-mono text-sm">onAnswer</code>. AiOracle calls it with 0 for UNKNOWN, 1 for YES and 2 for NO, with up to 200,000 gas.
        </p>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">AiOracle</dt>
          <dd className="m-0 font-mono text-xs break-all">{AIORACLE_ADDRESS}</dd>
          <dt className="text-muted">Fee</dt>
          <dd className="m-0">0.0001 ETH per question</dd>
          <dt className="text-muted">Question</dt>
          <dd className="m-0">up to 2000 bytes, answered YES, NO or UNKNOWN</dd>
        </dl>
        <p className="m-0 text-sm text-muted">This is the contract the test suite runs against AiOracle, not a sketch.</p>
      </div>
      <div className="min-w-0 rounded-2xl border border-vault-line bg-vault p-4 text-vault-ink">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-vault-line pb-3">
          <span className="font-mono text-xs text-bronze-hi">YesNoClient.sol</span>
          <CopyButton text={clientSource} />
        </div>
        <pre className="m-0 overflow-x-auto font-mono text-xs leading-relaxed">
          <code>{clientSource}</code>
        </pre>
      </div>
    </section>
  );
}

export function Landing() {
  usePageTitle("Psephex: an AI oracle for Base checked on NEAR");
  return (
    <div className="basalt-glow min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
        <SiteHeader
          end={
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/app">Open the dashboard</Link>
            </Button>
          }
        >
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 text-sm">
            <a href="#how" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
              How it works
            </a>
            <a href="#developers" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
              For developers
            </a>
            <Link to="/app" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink sm:hidden">
              Dashboard
            </Link>
          </nav>
        </SiteHeader>

        <main className="flex flex-col gap-24 pt-10 pb-24 sm:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:gap-16">
            <div className="flex flex-col gap-7">
              <h1 className="m-0 max-w-[16ch] font-display text-[2.6rem] leading-[0.98] font-semibold tracking-[-0.015em] sm:text-6xl lg:text-7xl">Three AI models answer, NEAR checks that two agree, Base gets the verdict.</h1>
              <p className="m-0 max-w-[56ch] text-base text-muted sm:text-lg">
                Psephex is a yes-or-no oracle for Base. Every answer is signed inside a TEE, a NEAR contract enforces two of three, and NEAR Chain Signatures write the result back to Base. No bridge, no oracle key on a server.
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Button asChild size="lg">
                  <Link to="/app">Try it on Base Sepolia</Link>
                </Button>
                <a href="#proof" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-bronze-text">
                  What it proves
                </a>
              </div>
            </div>
            <LatestVerdict />
          </div>

          <LiveNumbers />
          <HowItWorks />
          <div id="proof" className="scroll-mt-6">
            <Limits />
          </div>
          <ForDevelopers />
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
