import { m, useReducedMotion } from "motion/react";
import { Box, Check, Cpu, Database, ShieldCheck, Signature, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import clientSource from "../../../contracts/base/src/examples/YesNoClient.sol?raw";
import type { Stats } from "../api.js";
import { LivePath } from "../components/LivePath.js";
import { CopyButton } from "../components/Commands.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { SiteHeader } from "../components/SiteHeader.js";
import { Button } from "../components/ui/button.js";
import { NumberTicker } from "../components/ui/number-ticker.js";
import { AIORACLE_ADDRESS, ARBITRUM_AI_ORACLE, NEAR_ORACLE_CONTRACT } from "../deployment.js";
import { NEAR_CLI_SNIPPET, NEAR_CLIENT_SNIPPET } from "../lib/snippets.js";
import { SOURCES, SOURCE_SHORT } from "../sources.js";
import { useLatestVerdict, usePageTitle, useStats } from "../hooks.js";

const STEP_ICONS: readonly ReactNode[] = [Box, Cpu, ShieldCheck, Database, Signature].map((Icon, i) => <Icon key={i} className="size-4" aria-hidden="true" />);

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const still = useReducedMotion() === true || typeof IntersectionObserver === "undefined";
  if (still) return <div className={className}>{children}</div>;
  return (
    <m.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </m.div>
  );
}

const STEPS: readonly { title: string; body: string; where: string }[] = [
  {
    where: "NEAR",
    title: "You ask on NEAR and pay in NEAR",
    body: "Call ask on oracle.psephex.testnet with a yes-or-no question and the deposit that ask_deposit(question) returns: the fee plus the storage for the record. Any extra deposit comes back.",
  },
  {
    where: "NEAR AI and Phala",
    title: "Three models answer in TEEs",
    body: "The relayer sends the exact request the NEAR contract built to DeepSeek V4.1 and Qwen3.6 on NEAR AI and to Gemma 4 on Phala. Every answer is signed inside a TEE.",
  },
  { where: "NEAR", title: "NEAR checks two of three", body: "oracle.psephex.testnet rebuilds the request from the question in its own state, checks every signature against the registered keys and needs two matching answers." },
  {
    where: "NEAR",
    title: "The verdict lands in NEAR state",
    body: "The contract stores the answer and the votes. If you asked with callback set, it calls on_answer(request_id, answer) on your contract.",
  },
  {
    where: "NEAR Chain Signatures",
    title: "Base and Arbitrum get the same verdict",
    body: "For a question asked on Base or Arbitrum, the NEAR contract asks NEAR MPC to sign the answer transaction. AiOracle accepts it only from that MPC address. There is no bridge and no oracle key on a server.",
  },
];

const PROVES: readonly string[] = [
  "Each answer was signed inside a TEE by a key registered on NEAR and attested with a fresh nonce: the model's own key on NEAR AI, the gateway's key on Phala.",
  "At least two of the three signed answers agree. The NEAR contract checks this, not our server.",
  "The models saw the request the NEAR contract built from the stored question, with temperature 0 and a fixed seed inside the signed request.",
  "On Base and Arbitrum, only the MPC-derived address can deliver the answer, and only for the matching id and question. There is no bridge and no oracle key on a server.",
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
          <Count n={answered} /> answered
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
      {stats.bySource && <p className="m-0 text-sm text-muted">{SOURCES.map((src) => `${stats.bySource?.[src]?.total ?? 0} on ${SOURCE_SHORT[src]}`).join(", ")}.</p>}
      {avg !== null && <p className="m-0 max-w-[62ch] text-sm text-muted">On average {avg} s from the relayer seeing a question to its answer on chain, counting the test runs where we killed the relayer on purpose.</p>}
    </div>
  );
}

function LiveNumbers() {
  const stats = useStats();
  return (
    <section aria-labelledby="live-heading" className="flex flex-col gap-4 border-y border-line py-10">
      <h2 id="live-heading" className="m-0 flex items-center gap-2 text-sm font-medium text-bronze-text">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-yes" />
        Live on testnet
      </h2>
      {stats.data && <NumbersLine stats={stats.data} />}
      {stats.isError && <p className="m-0 text-muted">Live numbers are unavailable right now. The contracts below are still on Nearblocks and Basescan.</p>}
      {stats.isPending && <p className="m-0 text-muted">Reading the numbers…</p>}
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="grid scroll-mt-6 gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
      <div className="flex flex-col gap-4 lg:sticky lg:top-10 lg:self-start">
        <h2 id="how-heading" className="m-0 font-display text-4xl font-extrabold sm:text-5xl">
          How it works
        </h2>
        <p className="m-0 max-w-[44ch] text-muted">Every question passes through one NEAR contract and three enclaves. No step trusts our server: NEAR checks the signatures and keeps the verdict, and Base and Arbitrum only accept an answer signed by NEAR MPC.</p>
      </div>
      <ol aria-label="How a question is answered" className="m-0 flex list-none flex-col p-0">
        {STEPS.map((s, i) => (
          <li key={s.title} className="border-t border-line py-6 last:border-b">
            <Reveal className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4" delay={i * 0.05}>
              <span className="flex size-10 items-center justify-center rounded-xl bg-raised text-bronze-text">{STEP_ICONS[i]}</span>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-bronze-text">
                  {i + 1}. {s.where}
                </span>
                <h3 className="m-0 font-display text-xl font-bold text-ink">{s.title}</h3>
                <p className="m-0 max-w-[60ch] text-muted">{s.body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Limits() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="proves-heading" className="flex flex-col gap-5 rounded-3xl border border-line bg-paper p-6 sm:p-8">
        <h2 id="proves-heading" className="m-0 font-display text-2xl font-extrabold">
          What a verdict proves
        </h2>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {PROVES.map((p) => (
            <li key={p} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
              <Check className="mt-1 size-4 text-yes" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="limits-heading" className="flex flex-col gap-5 rounded-3xl border border-line bg-paper p-6 sm:p-8">
        <h2 id="limits-heading" className="m-0 font-display text-2xl font-extrabold">
          What a verdict does not prove
        </h2>
        <ul className="m-0 flex list-none flex-col gap-4 p-0 [&>li]:grid [&>li]:grid-cols-[1.25rem_minmax(0,1fr)] [&>li]:gap-3">
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>
            That the answer is right. In{" "}
            <Link to="/app/r/base/2" className="underline underline-offset-2 hover:text-bronze-text">
              dispute #2
            </Link>{" "}
            all three models said 9 is a prime number, and the oracle delivered that.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>That asking again is impossible. Temperature 0 and the seed make repeats match in practice, not cryptographically.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>Fully independent operators. Two models run on NEAR AI and one on Phala, and on Phala one attested gateway signs for the model it routes to, so you trust that gateway.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>Knowledge of fresh events. Put the evidence in the question itself.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>A fixed set of models. The owner of the NEAR contract can change it.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function CodePanel({ name, code, wrap = false }: { name: string; code: string; wrap?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border border-vault-line bg-vault p-4 text-vault-ink">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-vault-line pb-3">
        <span className="font-mono text-xs text-bronze-hi">{name}</span>
        <CopyButton text={code} />
      </div>
      <pre className={`m-0 overflow-x-auto font-mono text-xs leading-relaxed ${wrap ? "break-all whitespace-pre-wrap" : ""}`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ForDevelopers() {
  return (
    <section id="developers" aria-labelledby="dev-heading" className="grid scroll-mt-6 gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <h2 id="dev-heading" className="m-0 font-display text-4xl font-extrabold sm:text-5xl">
          Use it from your contract
        </h2>
        <h3 className="m-0 font-display text-xl font-bold">From NEAR</h3>
        <p className="m-0 text-muted [overflow-wrap:anywhere]">
          Call <code className="font-mono text-sm">ask</code> on {NEAR_ORACLE_CONTRACT} with the deposit from <code className="font-mono text-sm">ask_deposit(question)</code> and{" "}
          <code className="font-mono text-sm">callback: true</code>, and implement <code className="font-mono text-sm">on_answer(request_id, answer)</code>. The answer is the string YES, NO or UNKNOWN, and it also stays readable through{" "}
          <code className="font-mono text-sm">near_request(request_id)</code>. The contract sketch shows the shape; dispute.psephex.testnet calls ask the same way.
        </p>
        <h3 className="m-0 font-display text-xl font-bold">From Solidity</h3>
        <p className="m-0 text-muted">
          On Base or Arbitrum, call <code className="font-mono text-sm">ask</code> with the fee and implement <code className="font-mono text-sm">onAnswer</code>. AiOracle calls it with 0 for UNKNOWN, 1 for YES and 2 for NO, with up to 200,000 gas. YesNoClient.sol is the contract the test suite runs against AiOracle, not a sketch.
        </p>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Oracle on NEAR</dt>
          <dd className="m-0 font-mono text-xs break-all">{NEAR_ORACLE_CONTRACT}</dd>
          <dt className="text-muted">NEAR deposit</dt>
          <dd className="m-0">ask_deposit(question), extra comes back</dd>
          <dt className="text-muted">AiOracle on Base</dt>
          <dd className="m-0 font-mono text-xs break-all">{AIORACLE_ADDRESS}</dd>
          {ARBITRUM_AI_ORACLE && (
            <>
              <dt className="text-muted">AiOracle on Arbitrum</dt>
              <dd className="m-0 font-mono text-xs break-all">{ARBITRUM_AI_ORACLE}</dd>
            </>
          )}
          <dt className="text-muted">EVM fee</dt>
          <dd className="m-0">0.0001 ETH per question</dd>
          <dt className="text-muted">Question</dt>
          <dd className="m-0">up to 2000 bytes, answered YES, NO or UNKNOWN</dd>
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <CodePanel name="near CLI" code={NEAR_CLI_SNIPPET} wrap />
        <CodePanel name="NEAR contract (Rust)" code={NEAR_CLIENT_SNIPPET} />
        <CodePanel name="YesNoClient.sol" code={clientSource} />
      </div>
    </section>
  );
}

function HeroTitle({ text }: { text: string }) {
  const still = useReducedMotion() === true;
  const words = text.split(" ");
  return (
    <h1 className="m-0 font-display text-[2.7rem] leading-[0.95] font-extrabold sm:text-6xl lg:text-7xl">
      {words.map((w, i) => (
        <Fragment key={i}>
          <m.span
            className="inline-block"
            initial={still ? false : { opacity: 0, y: "0.35em" }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.04 * i }}
          >
            {w}
          </m.span>
          {i < words.length - 1 && " "}
        </Fragment>
      ))}
    </h1>
  );
}

function HeroPath() {
  const { detail } = useLatestVerdict();
  return <LivePath detail={detail} />;
}

export function Landing() {
  usePageTitle("Psephex: an AI oracle that runs on NEAR");
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

        <main className="flex flex-col gap-24 pt-10 pb-24 sm:pt-14">
          <div className="flex flex-col gap-10">
            <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
              <HeroTitle text="An AI oracle that runs on NEAR. Three models answer, NEAR keeps the verdict." />
              <div className="flex flex-col gap-6">
                <p className="m-0 max-w-[52ch] text-base text-muted sm:text-lg">
                  Ask a yes-or-no question from NEAR and pay in NEAR. Three models answer inside TEEs, the NEAR contract checks that two agree, and the verdict lands in its state. Base and Arbitrum get the same verdict through NEAR Chain Signatures, with no bridge and no oracle key.
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Button asChild size="lg">
                    <Link to="/app/new">Try it on NEAR testnet</Link>
                  </Button>
                  <a href="#proof" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-bronze-text">
                    What it proves
                  </a>
                </div>
              </div>
            </div>
            <HeroPath />
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
