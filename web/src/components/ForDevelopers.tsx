import { ArrowUpRight, Bot, Braces, Layers } from "lucide-react";
import type { ReactNode } from "react";
import clientSource from "../../../contracts/base/src/examples/YesNoClient.sol?raw";
import { AIORACLE_ADDRESS, ARBITRUM_AI_ORACLE, DOCS_URL, NEAR_COURT_CONTRACT, NEAR_ORACLE_CONTRACT } from "../deployment.js";
import { COURT_CLI_SNIPPET, NEAR_CLIENT_SNIPPET, ORACLE_CLI_SNIPPET } from "../lib/snippets.js";
import { CodePanel } from "./CodePanel.js";
import { CopyButton } from "./Commands.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.js";

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.8em] text-ink">{children}</code>;
}

interface Path {
  readonly value: string;
  readonly title: string;
  readonly tool: string;
  readonly icon: ReactNode;
  readonly steps: readonly ReactNode[];
  readonly note: ReactNode;
  readonly guide: string;
  readonly panels: readonly { name: string; code: string; wrap?: boolean }[];
}

const PATHS: readonly Path[] = [
  {
    value: "agent",
    title: "An agent on the court",
    tool: "near CLI, no contract to write",
    icon: <Bot className="size-5" aria-hidden="true" />,
    steps: [
      <>
        Price the case: <Code>ask_deposit</Code> on the oracle for a 2000-byte question and <Code>storage_deposit(claim, evidence)</Code> on the court.
      </>,
      <>
        The buyer calls <Code>open_case</Code> with the stake plus both amounts. The oracle part is a reserve; what the final question does not use comes back.
      </>,
      <>
        The seller calls <Code>respond(case_id, response)</Code> within the window. Three models answer and NEAR checks two of three.
      </>,
      <>
        Either party can <Code>appeal</Code> with the bond. After the window anyone calls <Code>finalize</Code> and the court pays out.
      </>,
    ],
    note: "Agents that speak MCP can do the same through the tools above.",
    guide: "/build/court",
    panels: [{ name: "Agents on the court (near CLI)", code: COURT_CLI_SNIPPET, wrap: true }],
  },
  {
    value: "near",
    title: "A NEAR contract",
    tool: "Rust, near-sdk",
    icon: <Braces className="size-5" aria-hidden="true" />,
    steps: [
      <>
        Read <Code>ask_deposit(question)</Code> and attach it to <Code>ask</Code> with <Code>callback: true</Code>.
      </>,
      <>
        Implement <Code>on_answer(request_id, answer)</Code> and accept it only from {NEAR_ORACLE_CONTRACT}.
      </>,
      <>
        The answer is YES, NO or UNKNOWN and stays readable through <Code>near_request(request_id)</Code>.
      </>,
    ],
    note: "The court is such a client of the oracle.",
    guide: "/build/near-contract",
    panels: [
      { name: "NEAR contract asking the oracle (Rust)", code: NEAR_CLIENT_SNIPPET },
      { name: "Try it from the near CLI", code: ORACLE_CLI_SNIPPET, wrap: true },
    ],
  },
  {
    value: "evm",
    title: "A Base or Arbitrum contract",
    tool: "Solidity, through Chain Signatures",
    icon: <Layers className="size-5" aria-hidden="true" />,
    steps: [
      <>
        Call <Code>ask(question)</Code> on AiOracle with the fee.
      </>,
      <>
        Implement <Code>onAnswer(id, answer)</Code>: 0 for UNKNOWN, 1 for YES, 2 for NO, called with up to 200,000 gas.
      </>,
      <>NEAR signs the delivery through Chain Signatures, and AiOracle accepts it only from the MPC address, for the matching id and question.</>,
    ],
    note: "YesNoClient.sol is the contract the test suite runs against AiOracle, not a sketch.",
    guide: "/build/evm",
    panels: [{ name: "YesNoClient.sol", code: clientSource }],
  },
];

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="text-xs text-bronze-hi">{label}</dt>
        <dd className="m-0 font-mono text-xs break-all text-vault-ink">{value}</dd>
      </div>
      <CopyButton text={value} />
    </div>
  );
}

function Facts() {
  const arbitrum = ARBITRUM_AI_ORACLE;
  const evm =
    arbitrum && arbitrum.toLowerCase() !== AIORACLE_ADDRESS.toLowerCase() ? (
      <>
        <Fact label="AiOracle on Base" value={AIORACLE_ADDRESS} />
        <Fact label="AiOracle on Arbitrum" value={arbitrum} />
      </>
    ) : (
      <Fact label={arbitrum ? "AiOracle on Base and Arbitrum" : "AiOracle on Base"} value={AIORACLE_ADDRESS} />
    );
  return (
    <div className="flex flex-col gap-2">
      <dl className="m-0 grid divide-y divide-vault-line overflow-hidden rounded-2xl border border-vault-line bg-vault lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <Fact label="Court on NEAR" value={NEAR_COURT_CONTRACT} />
        <Fact label="Oracle on NEAR" value={NEAR_ORACLE_CONTRACT} />
        {evm}
      </dl>
      <p className="m-0 text-sm text-muted">Case texts are one line of up to 400 bytes each. An oracle question is up to 2000 bytes and is answered YES, NO or UNKNOWN.</p>
    </div>
  );
}

function PathPanel({ path }: { path: Path }) {
  return (
    <TabsContent value={path.value} className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
      <div className="flex flex-col gap-5">
        <ol aria-label={`Steps for ${path.title.toLowerCase()}`} className="m-0 flex list-none flex-col gap-4 p-0">
          {path.steps.map((step, i) => (
            <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
              <span className="flex size-7 items-center justify-center rounded-full border border-line font-display text-sm font-bold text-bronze-text">{i + 1}</span>
              <p className="m-0 text-muted [overflow-wrap:anywhere]">{step}</p>
            </li>
          ))}
        </ol>
        <p className="m-0 text-sm text-muted">{path.note}</p>
        {DOCS_URL && (
          <a href={`${DOCS_URL}${path.guide}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-fit items-center gap-1 font-medium underline underline-offset-4 hover:text-bronze-text">
            Full guide in the docs
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {path.panels.map((p) => (
          <CodePanel key={p.name} name={p.name} code={p.code} wrap={p.wrap ?? false} tall />
        ))}
      </div>
    </TabsContent>
  );
}

export function ForDevelopers() {
  return (
    <section id="developers" aria-labelledby="dev-heading" className="flex scroll-mt-6 flex-col gap-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
        <h2 id="dev-heading" className="m-0 font-display text-4xl font-extrabold sm:text-5xl">
          Use it from your agent or contract
        </h2>
        <p className="m-0 max-w-[52ch] text-muted">Three ways in, all on testnet. Pick the one that matches what you are building; each ends with a verdict NEAR has checked.</p>
      </div>
      <Tabs defaultValue={PATHS[0]!.value} className="gap-0">
        <TabsList aria-label="Ways to use Psephex" className="grid w-full grid-cols-1 items-stretch justify-normal gap-2 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-3">
          {PATHS.map((p) => (
            <TabsTrigger
              key={p.value}
              value={p.value}
              className="h-auto min-h-14 justify-start gap-3 rounded-2xl border border-line bg-paper px-4 py-3 text-left whitespace-normal text-ink transition-colors duration-150 hover:border-bronze data-[state=active]:border-bronze data-[state=active]:bg-raised data-[state=active]:shadow-none dark:data-[state=active]:border-bronze dark:data-[state=active]:bg-raised"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-bronze-text">{p.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-base font-bold">{p.title}</span>
                <span className="text-xs font-normal text-muted">{p.tool}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {PATHS.map((p) => (
          <PathPanel key={p.value} path={p} />
        ))}
      </Tabs>
      <Facts />
    </section>
  );
}
