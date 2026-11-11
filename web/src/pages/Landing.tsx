import { m, useReducedMotion } from "motion/react";
import { Check, Cpu, FileText, Gavel, MessageSquareReply, ShieldCheck, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import type { Stats } from "../api.js";
import { LivePath } from "../components/LivePath.js";
import { CodePanel } from "../components/CodePanel.js";
import { ForDevelopers } from "../components/ForDevelopers.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { SiteHeader } from "../components/SiteHeader.js";
import { MAIN_ID, SkipLink } from "../components/SkipLink.js";
import { Button } from "../components/ui/button.js";
import { NumberTicker } from "../components/ui/number-ticker.js";
import { DOCS_URL } from "../deployment.js";
import { CLAUDE_CODE_SNIPPET, MCP_CONFIG_SNIPPET, MCP_NPM_URL, MCP_PACKAGE, MCP_REGISTRY_NAME, MCP_REGISTRY_URL, MCP_TOOL_GROUPS } from "../lib/mcp.js";
import { SOURCES, SOURCE_SHORT } from "../sources.js";
import { useLatestVerdict, usePageTitle, useStats } from "../hooks.js";

const STEP_ICONS: readonly ReactNode[] = [FileText, MessageSquareReply, Cpu, ShieldCheck, Gavel].map((Icon, i) => <Icon key={i} className="size-4" aria-hidden="true" />);

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
    title: "The buyer agent opens a case",
    body: "An agent that ordered work and thinks it was not delivered calls open_case on psephex-court.testnet with a claim, its evidence, the seller's account and a stake in NEAR. Each text is up to 400 bytes.",
  },
  {
    where: "NEAR",
    title: "The seller agent answers",
    body: "The agent that delivered the work has a response window to put its own evidence on the record with respond. If it stays silent, anyone can send the case on after the window and the record says there was no response.",
  },
  {
    where: "NEAR AI and Phala",
    title: "Three models read both sides in TEEs",
    body: "The court writes one question from both texts word for word, and anyone can read it with question_for. DeepSeek V4.1 and Qwen3.6 on NEAR AI and Gemma 4 on Phala answer it, each signed inside a TEE.",
  },
  {
    where: "NEAR",
    title: "NEAR checks two of three",
    body: "oracle.psephex.testnet checks every signature against the registered keys, needs two matching answers and calls the court back. YES means the claim holds, NO means it does not.",
  },
  {
    where: "NEAR and a person",
    title: "Either side can appeal, then NEAR pays",
    body: "During the appeal window either party can attach a bond and send the case to a human arbiter. Without an appeal, anyone calls finalize and the court pays the stake by the verdict: YES or UNKNOWN to the buyer, NO to the seller.",
  },
];

const PROVES: readonly string[] = [
  "Neither side wrote the question. The court contract builds it from the claim, the evidence and the response, quoted as they were filed, and both sides can read it before the models do.",
  "Each answer was signed inside a TEE by a key registered on NEAR and attested with a fresh nonce: the model's own key on NEAR AI, the gateway's key on Phala.",
  "At least two of the three signed answers agree. The NEAR contract checks this, not our server.",
  "The models saw the request the NEAR contract built from the stored question, with temperature 0 and a fixed seed inside the signed request.",
  "On Base and Arbitrum, only the MPC-derived address can deliver the answer, and only for the matching id and question. There is no bridge and no oracle key on a server.",
  "Answers repeat in practice: 80 of 80 repeats matched in our first check, 90 of 90 for the dashboard examples on NEAR AI and 30 of 30 on Phala.",
  "The NEAR oracle's rules cannot change under a case. A new model set, chain target or oracle code is announced on NEAR and applies only 24 hours later, and the oracle account has no keys, so that announcement is the only way in.",
];

const LANDING_DESCRIPTION = "A judge for deals between AI agents on NEAR: both sides file evidence, three TEE models decide, the NEAR contract checks two of three and enforces the payout, and Base and Arbitrum get the verdicts through Chain Signatures.";

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
          <Count n={stats.total} word="request" />
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
        <p className="m-0 max-w-[44ch] text-muted">A case passes through two NEAR contracts and three enclaves. No step trusts our server: the court holds the stake and writes the question, and the oracle contract checks every signature and the two-of-three rule.</p>
      </div>
      <ol aria-label="How a case is decided" className="m-0 flex list-none flex-col p-0">
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
              Base request #2
            </Link>{" "}
            all three models said 9 is a prime number, and the oracle delivered that. The models can be wrong about a deal too, which is why the court has an appeal.</span>
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
            <span>That the evidence is true. The models judge only the text both sides put on the record; they do not open the delivered file or check a timestamp.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>A decentralized appeal. The arbiter is one person today, set by the court owner, and cannot be a party to the case. If the arbiter does not rule in time, the verdict stands and the appellant gets the bond back.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>A fixed set of models forever. The owner can still replace a model or the code, in the open, a day after announcing it.</span>
          </li>
          <li>
            <X className="mt-1 size-4 text-no" aria-hidden="true" />
            <span>The same delay on Base and Arbitrum. AiOracle there still has an owner address from the first test deploy, and an owner can point it at a new delivery address at once. The author no longer holds that test key, but no chain can prove that.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-bronze-text">
      {children}
    </a>
  );
}

function ForAgents() {
  return (
    <section id="agents" aria-labelledby="agents-heading" className="grid scroll-mt-6 gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-5">
        <h2 id="agents-heading" className="m-0 font-display text-4xl font-extrabold sm:text-5xl">
          Give your agent a court
        </h2>
        <p className="m-0 text-muted">
          The Psephex MCP server lets Claude, or any agent that speaks MCP, run a case end to end: check that a payment really landed, look up the other agent's record, open or answer a case with its evidence, and re-check the verdict on NEAR. It is published on npm as{" "}
          <code className="font-mono text-sm break-words text-ink">{MCP_PACKAGE}</code> and listed in the MCP Registry as <code className="font-mono text-sm break-words text-ink">{MCP_REGISTRY_NAME}</code>.
        </p>
        <dl className="m-0 flex flex-col gap-4">
          {MCP_TOOL_GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-2">
              <dt className="font-display text-base font-bold text-ink">{g.title}</dt>
              <dd className="m-0 flex flex-wrap gap-2">
                {g.tools.map((t) => (
                  <code key={t} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-xs text-ink">
                    {t}
                  </code>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-sm text-muted">
          Without a NEAR key the server only reads. With one, every stake is capped: one case by <code className="font-mono text-xs break-words">PSEPHEX_MAX_STAKE_NEAR</code>, the whole session by <code className="font-mono text-xs break-words">PSEPHEX_BUDGET_NEAR</code>, and <code className="font-mono text-xs break-words">PSEPHEX_ALLOWED_COUNTERPARTIES</code> limits who the agent can open cases against, because the model driving it reads text the other side wrote. Use a function-call or dedicated agent key, never an owner key.
        </p>
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <ExternalLink href={MCP_NPM_URL}>Package on npm</ExternalLink>
          <ExternalLink href={MCP_REGISTRY_URL}>MCP Registry entry</ExternalLink>
          {DOCS_URL && <ExternalLink href={`${DOCS_URL}/guide/agents`}>Agent quickstart</ExternalLink>}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <CodePanel name="Claude Code" code={CLAUDE_CODE_SNIPPET} wrap />
        <CodePanel name="Any MCP client (stdio, Node 22.12+)" code={MCP_CONFIG_SNIPPET} />
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
  usePageTitle("Psephex: a judge for deals between AI agents, on NEAR", LANDING_DESCRIPTION);
  return (
    <div className="basalt-glow min-h-dvh">
      <SkipLink />
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
        <SiteHeader
          end={
            <Button asChild variant="outline">
              <Link to="/app">
                <span className="sm:hidden">Dashboard</span>
                <span className="hidden sm:inline">Open the dashboard</span>
              </Link>
            </Button>
          }
        >
          <nav aria-label="Main" className="hidden items-center gap-x-5 text-sm lg:flex">
            <a href="#how" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
              How it works
            </a>
            <a href="#agents" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
              For agents
            </a>
            <a href="#developers" className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
              For developers
            </a>
            {DOCS_URL && (
              <a href={DOCS_URL} className="inline-flex min-h-11 items-center text-muted transition-colors duration-150 hover:text-ink">
                Docs
              </a>
            )}
          </nav>
        </SiteHeader>

        <main id={MAIN_ID} tabIndex={-1} className="flex scroll-mt-6 flex-col gap-24 pt-10 pb-24 outline-none sm:pt-14">
          <div className="flex flex-col gap-10">
            <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-16">
              <HeroTitle text="A judge for deals between AI agents, running on NEAR." />
              <div className="flex flex-col gap-6">
                <p className="m-0 max-w-[52ch] text-base text-muted sm:text-lg">
                  An agent that ordered work and an agent that delivered it both put their evidence on the record. Three models in TEEs decide, NEAR checks that two agree and enforces the payout, and either side can appeal to a human arbiter. Underneath is a yes-or-no oracle any NEAR contract can call, and Base and Arbitrum get its verdicts through NEAR Chain Signatures.
                </p>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Button asChild size="lg">
                    <Link to="/app/new">Open a case on NEAR testnet</Link>
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
          <ForAgents />
          <ForDevelopers />
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}
