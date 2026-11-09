import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadStore } from "../../src/api/store.js";
import { modelsView, requestDetail, requestSummary, shellToken, verifyPlan, type ViewSettings } from "../../src/api/views.js";
import { apiConfig, BASE_TX, buildFixture, HOSTILE_QUESTION, MODELS, NEAR_TX, T0, type Fixture } from "./fixture.js";

function bundle(store: ReadStore, id: number) {
  const request = store.request(id);
  if (!request) throw new Error(`no request ${id}`);
  return { request, answers: store.modelAnswers(id), nearTxs: store.nearTxs(id), baseTxs: store.baseTxs(id) };
}

describe("views", () => {
  let fx: Fixture;
  let store: ReadStore;
  let settings: ViewSettings;

  beforeEach(() => {
    fx = buildFixture();
    store = ReadStore.open(fx.path);
    settings = apiConfig(fx.path);
  });

  afterEach(() => {
    store.close();
    fx.cleanup();
  });

  it("shortens long questions by characters in the list", () => {
    const row = store.request(4);
    if (!row) throw new Error("missing");
    const s = requestSummary(row);
    expect(Array.from(s.question)).toHaveLength(161);
    expect(s.question.endsWith("…")).toBe(true);
    expect(s).toMatchObject({ id: 4, status: "rejected", reason: "question is longer than 2000 bytes", answer: null });
    expect(s.createdAt).toBe(new Date(T0).toISOString());
  });

  it("puts every stored artefact of a request into the detail view", () => {
    const d = requestDetail({ ...bundle(store, 1), models: MODELS });
    expect(d.question).toBe("Is 7 prime?");
    expect(d.votes).toHaveLength(3);
    expect(d.models[0]).toMatchObject({ model: "alpha/A", publicKey: "aa".repeat(32), signatureHex: "ee".repeat(64), chatId: "chat-1-alpha/A" });
    expect(typeof d.models[0]?.requestBody).toBe("string");
    expect(d.near).toEqual([expect.objectContaining({ txHash: NEAR_TX, ok: true, result: { ok: true, request_id: 1 } })]);
    expect(d.base).toEqual([expect.objectContaining({ txHash: BASE_TX, status: "success", gasUsed: "79561", events: [{ event: "Fulfilled", args: { id: "1", answer: 1 } }] })]);
    expect(d.timeToConfirmMs).toBe(42_000);
  });

  it("leaves public keys empty when NEAR is unreachable", () => {
    const d = requestDetail({ ...bundle(store, 1), models: null });
    expect(d.models[0]?.publicKey).toBeNull();
  });

  it("builds verification commands for a signed request", () => {
    const plan = verifyPlan(bundle(store, 1), settings);
    expect(plan.available).toBe(true);
    expect(plan.near.args.answers).toHaveLength(3);
    expect(plan.near.args.answers[0]).toEqual({ model: "alpha/A", response_body: expect.any(String), signature_hex: "ee".repeat(64) });
    const commands = plan.steps.map((s) => s.command).join("\n");
    expect(commands).toContain("curl -s 'https://api.psephex.test/requests/1/verify' | jq '.data.near.args' > psephex-1.json");
    expect(commands).toContain("near contract call-function as-read-only oracle.psephex.testnet verify_consensus file-args psephex-1.json network-config testnet now");
    expect(commands).toContain(`cast receipt ${BASE_TX} --rpc-url https://sepolia.base.org`);
    expect(commands).toContain(`near transaction view-status ${NEAR_TX} network-config testnet`);
    const fulfilled = plan.steps.find((s) => s.command.includes("cast to-dec"));
    expect(fulfilled?.command).toContain("0x792bca54672763af3b1faa1fb62d3cb2fcff6111");
    expect(fulfilled?.expect).toEqual(["answer code 1"]);
    expect(plan.steps.find((s) => s.command.includes("cast keccak"))?.expect).toEqual([store.request(1)?.questionHash]);
    expect(plan.steps.find((s) => s.command.includes("verify_consensus"))?.expect).toEqual(['"ok": true', '"answer": "YES"']);
  });

  it("never puts the question text into a shell command", () => {
    const plan = verifyPlan(bundle(store, 2), settings);
    expect(plan.near.args.question).toBe(HOSTILE_QUESTION);
    for (const step of plan.steps) {
      expect(step.command).not.toMatch(/rm -rf|curl evil|`|\$\(/);
    }
  });

  it("explains why a request cannot be verified yet", () => {
    const plan = verifyPlan(bundle(store, 2), settings);
    expect(plan.available).toBe(false);
    expect(plan.reason).toBe("model answers without a signature: alpha/A");
    expect(plan.steps.some((s) => s.command.includes("verify_consensus"))).toBe(false);
    const rejected = verifyPlan(bundle(store, 4), settings);
    expect(rejected.reason).toMatch(/no signed model answers.*rejected: question is longer/);
  });

  it("withholds the consensus re-check when NEAR now holds another model set", () => {
    const plan = verifyPlan(bundle(store, 1), settings, ["alpha/A", "beta/B", "delta/D"]);
    expect(plan.available).toBe(false);
    expect(plan.reason).toBe("answered by an earlier model set (alpha/A, beta/B, gamma/C); NEAR now checks alpha/A, beta/B, delta/D");
    expect(plan.steps.some((s) => s.command.includes("verify_consensus"))).toBe(false);
    expect(plan.steps.some((s) => s.command.includes("cast keccak"))).toBe(true);
    expect(verifyPlan(bundle(store, 1), settings, ["gamma/C", "alpha/A", "beta/B"]).available).toBe(true);
    expect(verifyPlan(bundle(store, 1), settings, null).available).toBe(true);
  });

  it("rejects tokens that a shell would interpret", () => {
    expect(shellToken("0xabc")).toBe("0xabc");
    for (const bad of ["a b", "a'b", "$(id)", "a;b", "a|b", "", "a\nb", "--rpc-url", "~root"]) expect(() => shellToken(bad)).toThrow(/unsafe/);
  });

  it("refuses to build commands from a malformed stored hash", () => {
    const b = bundle(store, 1);
    expect(() => verifyPlan({ ...b, request: { ...b.request, questionHash: "--rpc-url=evil" } }, settings)).toThrow(/32-byte hex/);
    expect(() => verifyPlan({ ...b, nearTxs: b.nearTxs.map((t) => ({ ...t, txHash: "$(id)" })) }, settings)).toThrow(/NEAR tx hash/);
  });

  it("strips terminal control characters from free-text reasons", () => {
    const row = store.request(4);
    if (!row) throw new Error("missing");
    const s = requestSummary({ ...row, reason: "bad\u001b[31m red\u0007 \u009b2J end" });
    expect(s.reason).toBe("bad[31m red 2J end");
  });

  it("lists models with an attestation link the verifier completes with a nonce", () => {
    const [first] = modelsView(MODELS, settings);
    expect(first).toMatchObject({ model: "alpha/A", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa".repeat(32) });
    expect(first?.attestation?.url).toBe("https://cloud-api.near.ai/v1/attestation/report?model=alpha%2FA&signing_algo=ed25519&nonce=");
  });
});
