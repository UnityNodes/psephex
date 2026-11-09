import { Link } from "react-router";
import clientSource from "../../../contracts/base/src/examples/YesNoClient.sol?raw";
import type { Stats } from "../api.js";
import { Ballots } from "../components/Ballots.js";
import { CopyButton } from "../components/Commands.js";
import { SiteFooter } from "../components/SiteFooter.js";
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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function NumbersLine({ stats }: { stats: Stats }) {
  const answered = stats.byStatus.confirmed ?? 0;
  const avg = stats.avgSecondsSeenToConfirmed;
  return (
    <p className="m-0 max-w-[70ch] text-lg">
      <span>{plural(stats.total, "dispute")}</span> so far, <span>{answered} answered on Base</span>:{" "}
      <span>
        {stats.answers.YES} YES, {stats.answers.NO} NO and {stats.answers.UNKNOWN} UNKNOWN
      </span>
      .{avg !== null && ` On average ${avg} s from the relayer seeing a question to its answer on Base, counting the test runs where we killed the relayer on purpose.`}
    </p>
  );
}

function LiveNumbers() {
  const stats = useStats();
  return (
    <section aria-labelledby="live-heading" className="flex flex-col gap-3 border-y border-line py-8">
      <h2 id="live-heading" className="m-0 font-display text-xl font-semibold">
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
  const seconds = detail?.timeToConfirmMs != null ? (detail.timeToConfirmMs / 1000).toFixed(1) : null;
  return (
    <section aria-labelledby="latest-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-6 shadow-[0_1px_0_var(--color-line),0_18px_40px_-28px_rgb(27_36_48/0.45)]">
      <h2 id="latest-heading" className="m-0 text-sm font-medium text-muted">
        Latest verdict
      </h2>
      {detail ? (
        <>
          <p className="m-0 line-clamp-3 font-display text-xl leading-snug font-semibold break-words">{displayText(detail.question)}</p>
          <Ballots ballots={ballots(detail)} verdict={detail.answer} compact />
          {seconds && <p className="m-0 text-sm text-muted">Answered on Base {seconds} s after the relayer saw it.</p>}
          <Link to={`/app/r/${detail.id}`} className="text-sm underline underline-offset-2 hover:text-bronze">
            See how dispute #{detail.id} was decided
          </Link>
        </>
      ) : (
        <Ballots ballots={[]} verdict={null} compact />
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-heading" className="flex flex-col gap-8">
      <h2 id="how-heading" className="m-0 font-display text-3xl font-semibold">
        How it works
      </h2>
      <ol aria-label="How a question is answered" className="m-0 grid list-none gap-8 p-0 md:grid-cols-5 md:gap-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative flex flex-col gap-2 md:border-t-2 md:border-ink md:pt-4">
            <span className="font-display text-sm font-semibold text-bronze-text">
              {i + 1}. {s.where}
            </span>
            <h3 className="m-0 text-base font-semibold">{s.title}</h3>
            <p className="m-0 text-sm text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Limits() {
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <section aria-labelledby="proves-heading" className="flex flex-col gap-4">
        <h2 id="proves-heading" className="m-0 font-display text-2xl font-semibold">
          What a verdict proves
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 marker:text-bronze">
          {PROVES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="limits-heading" className="flex flex-col gap-4">
        <h2 id="limits-heading" className="m-0 font-display text-2xl font-semibold">
          What a verdict does not prove
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-3 pl-5 marker:text-bronze">
          <li>
            That the answer is right. In{" "}
            <Link to="/app/r/2" className="underline underline-offset-2 hover:text-bronze">
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
    <section id="developers" aria-labelledby="dev-heading" className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <h2 id="dev-heading" className="m-0 font-display text-3xl font-semibold">
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
      <div className="min-w-0 rounded-lg bg-ink p-4 text-paper">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-line">YesNoClient.sol</span>
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
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link to="/" className="font-display text-2xl font-bold tracking-tight">
          Psephex
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 text-sm">
          <a href="#how" className="py-3 text-muted hover:text-ink">
            How it works
          </a>
          <a href="#developers" className="py-3 text-muted hover:text-ink">
            For developers
          </a>
          <Link to="/app" className="rounded-full border-2 border-ink px-4 py-1.5 font-medium hover:bg-ink hover:text-paper">
            Open the dashboard
          </Link>
        </nav>
      </header>

      <main className="flex flex-col gap-20 pt-8 pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
          <div className="flex flex-col gap-6">
            <h1 className="m-0 font-display text-4xl leading-[1.04] font-semibold sm:text-6xl">Three AI models answer, NEAR checks that two agree, Base gets the verdict.</h1>
            <p className="m-0 max-w-[58ch] text-lg text-muted">
              Psephex is a yes-or-no oracle for Base. Every answer is signed inside a TEE, a NEAR contract enforces two of three, and NEAR Chain Signatures write the result back to Base. No bridge, no oracle key on a server.
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <Link to="/app" className="rounded-full bg-ink px-6 py-3 text-base font-medium text-paper hover:bg-bronze">
                Try it on Base Sepolia
              </Link>
              <a href="#proof" className="underline underline-offset-4 hover:text-bronze">
                What it proves
              </a>
            </div>
          </div>
          <LatestVerdict />
        </div>

        <LiveNumbers />
        <HowItWorks />
        <div id="proof">
          <Limits />
        </div>
        <ForDevelopers />
      </main>

      <SiteFooter />
    </div>
  );
}
