import { describe, expect, it } from "vitest";
import { formatNear, loadConfig, parseNear } from "../src/config.js";
import { Court, reputationOf, type Case } from "../src/court.js";
import { decodeOutcome } from "../src/near.js";
import { checkPayment } from "../src/payments.js";
import { FakeNear } from "./fake-near.js";

const NEAR = 10n ** 24n;
const ENV = { NEAR_ACCOUNT_ID: "alice.testnet", NEAR_PRIVATE_KEY: "ed25519:x" };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");

function court(env: Record<string, string> = ENV) {
  const near = new FakeNear();
  near.views.set("oracle.psephex.testnet.ask_deposit", (NEAR / 30n).toString());
  near.views.set("psephex-court.testnet.storage_deposit", (NEAR / 100n).toString());
  return { near, court: new Court(near, loadConfig(env)) };
}

function aCase(over: Partial<Case>): Case {
  return { claimant: "alice.testnet", counterparty: "bob.testnet", amount: "1", claim: "c", evidence: "e", response: "r", stage: "settled", respond_by_ns: "1", request_id: 1, verdict: "YES", appeal_by_ns: "1", appeal_bond: "0", appellant: null, arbiter: null, arbitrate_by_ns: null, winner: "alice.testnet", ...over };
}

describe("config", () => {
  it("parses and formats NEAR amounts exactly", () => {
    expect(parseNear("0.05")).toBe(NEAR / 20n);
    expect(parseNear("1")).toBe(NEAR);
    expect(parseNear("-1")).toBeNull();
    expect(parseNear("1e3")).toBeNull();
    expect(formatNear(NEAR / 20n)).toBe("0.05");
    expect(formatNear(NEAR * 2n)).toBe("2");
  });

  it("is read-only without a key and refuses half a key", () => {
    expect(loadConfig({}).accountId).toBeNull();
    expect(() => loadConfig({ NEAR_ACCOUNT_ID: "alice.testnet" })).toThrow(/both/);
    expect(() => loadConfig({ ...ENV, NEAR_ACCOUNT_ID: "Not An Account" })).toThrow(/account id/);
    expect(() => loadConfig({ NEAR_RPC_URL: "http://rpc.example.com" })).toThrow(/https/);
    expect(loadConfig({ PSEPHEX_MAX_STAKE_NEAR: "2" }).maxStakeYocto).toBe(2n * NEAR);
  });
});

describe("court tools", () => {
  it("opens a case with stake plus the bounded oracle reserve and storage", async () => {
    const { near, court: c } = court();
    const out = await c.openCase("claim", "evidence", "bob.testnet", "0.05");
    const call = near.calls[0]!;
    expect(call.method).toBe("open_case");
    expect(call.args).toEqual({ claim: "claim", evidence: "evidence", counterparty: "bob.testnet", oracle_reserve: (NEAR / 30n).toString() });
    expect(call.deposit).toBe(NEAR / 20n + NEAR / 30n + NEAR / 100n);
    expect(call.gas).toBe(100);
    expect(out.case_id).toBe(1);
  });

  it("refuses stakes above the agent's cap, unknown or self counterparties, and read-only use", async () => {
    await expect(court().court.openCase("c", "e", "bob.testnet", "0.6")).rejects.toThrow(/cap/);
    await expect(court().court.openCase("c", "e", "nobody.testnet", "0.05")).rejects.toThrow(/does not exist/);
    await expect(court().court.openCase("c", "e", "alice.testnet", "0.05")).rejects.toThrow(/yourself/);
    const ro = court({});
    await expect(ro.court.openCase("c", "e", "bob.testnet", "0.05")).rejects.toThrow(/read-only/);
    expect(ro.near.calls).toHaveLength(0);
  });

  it("refuses prices outside the contract limits", async () => {
    const { near, court: c } = court();
    near.views.set("oracle.psephex.testnet.ask_deposit", (2n * NEAR).toString());
    await expect(c.openCase("c", "e", "bob.testnet", "0.05")).rejects.toThrow(/oracle price/);
    expect(near.calls).toHaveLength(0);
  });

  it("sends respond and submit with 150 Tgas and appeal with the case's own bond", async () => {
    const { near, court: c } = court();
    await c.respond(3, "my answer");
    await c.submit(4);
    near.views.set("psephex-court.testnet.get_case", aCase({ stage: "decided", appeal_bond: (NEAR / 50n).toString(), winner: null }));
    await c.appeal(5);
    expect(near.calls.map((x) => [x.method, x.gas, x.deposit])).toEqual([
      ["respond", 150, 0n],
      ["submit", 150, 0n],
      ["appeal", 50, NEAR / 50n],
    ]);
  });

  it("refuses to appeal a case that is not decided", async () => {
    const { near, court: c } = court();
    near.views.set("psephex-court.testnet.get_case", aCase({ stage: "settled" }));
    await expect(c.appeal(5)).rejects.toThrow(/only a decided case/);
  });

  it("lists every case across pages and filters by party and open stage", async () => {
    const { near, court: c } = court();
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ ...aCase({ stage: i % 2 ? "awaiting_response" : "settled", counterparty: i % 3 ? "bob.testnet" : "carol.testnet" }), case_id: from + i }));
    near.views.set("psephex-court.testnet.cases", (args: { from_id: number }) => (args.from_id === 1 ? page(1, 50) : page(51, 3)));
    expect((await c.allCases()).length).toBe(53);
    const open = await c.listCases("carol.testnet", true);
    expect(open.every((x) => x.stage !== "settled")).toBe(true);
    expect((await c.listCases(null, false))[0]!.case_id).toBe(53);
  });

  it("counts wins, losses, appeals and silence for reputation", () => {
    const rep = reputationOf("bob.testnet", [
      aCase({ winner: "bob.testnet", verdict: "NO" }),
      aCase({ winner: "alice.testnet", response: null }),
      aCase({ stage: "decided", winner: null, appellant: "bob.testnet" }),
      aCase({ stage: "refunded", winner: null }),
      aCase({ claimant: "x.testnet", counterparty: "y.testnet" }),
    ]);
    expect(rep).toMatchObject({ cases: 4, won: 1, lost: 1, open: 1, refunded: 1, appeals_filed: 1, did_not_respond: 1, win_rate: 0.5 });
  });
});

describe("payments", () => {
  function tx(actions: object[], failed = false, signer = "alice.testnet", receiver = "usdc.testnet") {
    return { transaction: { hash: "H", signer_id: signer, receiver_id: receiver, actions }, status: failed ? { Failure: {} } : { SuccessValue: "" } };
  }

  it("reads a NEAR transfer", async () => {
    const near = new FakeNear();
    near.txs.set("T1", tx([{ Transfer: { deposit: (NEAR / 10n).toString() } }], false, "alice.testnet", "bob.testnet"));
    const r = await checkPayment(near, "T1", "alice.testnet");
    expect(r).toMatchObject({ ok: true, payer: "alice.testnet", payee: "bob.testnet", asset: "NEAR", amount: "0.1", x402: false });
    expect(r.evidence).toContain("0.1 NEAR from alice.testnet to bob.testnet");
  });

  it("reads an ft_transfer with token decimals", async () => {
    const near = new FakeNear();
    near.views.set("usdc.testnet.ft_metadata", { decimals: 6, symbol: "USDC" });
    near.txs.set("T2", tx([{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "bob.testnet", amount: "2500000" }) } }]));
    expect(await checkPayment(near, "T2", "alice.testnet")).toMatchObject({ ok: true, payee: "bob.testnet", amount: "2.5", asset: "USDC (usdc.testnet)", x402: false });
  });

  it("recognises an x402 payment submitted by a relayer as the delegator's payment", async () => {
    const near = new FakeNear();
    near.views.set("usdc.testnet.ft_metadata", { decimals: 6, symbol: "USDC" });
    const delegate = { Delegate: { delegate_action: { sender_id: "buyer.testnet", receiver_id: "usdc.testnet", actions: [{ FunctionCall: { method_name: "ft_transfer", args: b64({ receiver_id: "seller.testnet", amount: "1000000" }) } }] } } };
    near.txs.set("T3", tx([delegate], false, "relayer.testnet", "buyer.testnet"));
    const r = await checkPayment(near, "T3", "relayer.testnet");
    expect(r).toMatchObject({ ok: true, payer: "buyer.testnet", payee: "seller.testnet", amount: "1", x402: true });
    expect(r.evidence).toContain("x402 payment");
  });

  it("reports failed and empty transactions", async () => {
    const near = new FakeNear();
    near.txs.set("T4", tx([{ Transfer: { deposit: "5" } }], true, "a.testnet", "b.testnet"));
    near.txs.set("T5", tx([{ FunctionCall: { method_name: "something", args: "" } }]));
    expect(await checkPayment(near, "T4", "a.testnet")).toMatchObject({ ok: false, reason: "the transaction failed" });
    expect(await checkPayment(near, "T5", "a.testnet")).toMatchObject({ ok: false, asset: "unknown" });
  });
});

describe("transaction outcomes", () => {
  it("decodes the return value and logs, and throws on failure", () => {
    const out = decodeOutcome({ transaction: { hash: "H" }, status: { SuccessValue: Buffer.from("7").toString("base64") }, receipts_outcome: [{ outcome: { logs: ["a"] } }, { outcome: { logs: ["b"] } }] });
    expect(out).toEqual({ txHash: "H", value: 7, logs: ["a", "b"] });
    expect(() => decodeOutcome({ status: { Failure: { ActionError: "x" } } })).toThrow(/failed/);
  });
});
