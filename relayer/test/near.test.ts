import { describe, expect, it } from "vitest";
import { NearOracle, outcomeFromResponse, withTimeout, type NearRpc } from "../src/near.js";

const b64 = (s: string): string => Buffer.from(s).toString("base64");

const PANIC = {
  final_execution_status: "FINAL",
  status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: max_fee_per_gas above cap" } } } } },
};
const SIGNED = { ok: true, request_id: 7, unsigned_tx: "02ab", payload: "cd", signature: { big_r: { affine_point: "02" }, s: { scalar: "11" }, recovery_id: 0 } };

describe("outcomeFromResponse", () => {
  it("maps a contract panic to a failure with the panic text", () => {
    expect(outcomeFromResponse(PANIC)).toEqual({ kind: "failure", error: "Smart contract panicked: max_fee_per_gas above cap" });
  });

  it("maps a final SuccessValue with on_signed JSON to success", () => {
    expect(outcomeFromResponse({ final_execution_status: "FINAL", status: { SuccessValue: b64(JSON.stringify(SIGNED)) } })).toEqual({ kind: "success", result: SIGNED });
  });

  it("treats an executed but not yet final tx as final enough", () => {
    expect(outcomeFromResponse({ final_execution_status: "EXECUTED", status: { SuccessValue: b64('{"ok":false}') } })).toEqual({ kind: "success", result: { ok: false } });
  });

  it("keeps a tx that is only included as unknown", () => {
    expect(outcomeFromResponse({ final_execution_status: "INCLUDED", status: { SuccessValue: "" } })).toEqual({ kind: "unknown" });
    expect(outcomeFromResponse({ final_execution_status: "FINAL", status: "Started" })).toEqual({ kind: "unknown" });
  });

  it("fails on a return value that is not an on_signed object", () => {
    expect(outcomeFromResponse({ final_execution_status: "FINAL", status: { SuccessValue: b64("true") } })).toMatchObject({ kind: "failure" });
    expect(outcomeFromResponse({ final_execution_status: "FINAL", status: { SuccessValue: b64("{not json") } })).toMatchObject({ kind: "failure" });
  });

  it("stringifies a failure it cannot name", () => {
    expect(outcomeFromResponse({ final_execution_status: "FINAL", status: { Failure: { InvalidTxError: "Expired" } } })).toEqual({ kind: "failure", error: '{"InvalidTxError":"Expired"}' });
  });
});

describe("withTimeout", () => {
  it("resolves fast promises and rejects slow ones", async () => {
    await expect(withTimeout(Promise.resolve(1), 50, "x")).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => {}), 10, "slow call")).rejects.toThrow(/slow call timed out/);
  });
});

class FakeRpc implements NearRpc {
  views = new Map<string, unknown>();
  statusError: Error | undefined;
  status: unknown = PANIC;
  sendError: Error | undefined;
  lastView: { method: string; args: object } | undefined;

  async callFunction<T>(args: { contractId: string; method: string; args: object }): Promise<T | undefined> {
    this.lastView = { method: args.method, args: args.args };
    return this.views.get(args.method) as T | undefined;
  }

  async viewTransactionStatus(): Promise<unknown> {
    if (this.statusError) throw this.statusError;
    return this.status;
  }

  async sendTransactionUntil(): Promise<unknown> {
    if (this.sendError) throw this.sendError;
    return this.status;
  }

  keyQuery: { accountId: string; publicKey: string } | undefined;

  async viewAccessKey(args: { accountId: string; publicKey: string }): Promise<unknown> {
    this.keyQuery = args;
    return { nonce: 1n, permission: "FullAccess" };
  }
}

function oracle(rpc: FakeRpc): NearOracle {
  return new NearOracle({ rpc, contractId: "oracle.psephex.testnet", relayerId: "relayer.psephex.testnet", signer: null, fulfillGasTera: 200, timeoutMs: 1000 });
}

describe("NearOracle views", () => {
  it("maps models and the fee cap", async () => {
    const rpc = new FakeRpc();
    rpc.views.set("models", [{ model: "m", provider: "near-ai", scheme: "nearai-v1", public_key: "aa" }]);
    rpc.views.set("max_fee_per_gas_cap", "2000000000");
    const n = oracle(rpc);
    expect(await n.models()).toEqual([{ model: "m", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa" }]);
    expect(await n.maxFeePerGasCap()).toBe(2_000_000_000n);
  });

  it("passes request arguments to build_request and verify_consensus", async () => {
    const rpc = new FakeRpc();
    rpc.views.set("build_request", "{\"model\":\"m\"}");
    rpc.views.set("verify_consensus", { ok: true, answer: "YES", reason: "", required: 2, votes: [] });
    rpc.views.set("is_fulfilled", true);
    const n = oracle(rpc);
    expect(await n.buildRequest(7, "q", "m")).toBe("{\"model\":\"m\"}");
    expect(rpc.lastView).toEqual({ method: "build_request", args: { request_id: 7, question: "q", model: "m" } });
    expect((await n.verifyConsensus(7, "q", [])).answer).toBe("YES");
    expect(await n.isFulfilled(7)).toBe(true);
  });

  it("reads config and the MPC derived key", async () => {
    const rpc = new FakeRpc();
    rpc.views.set("config", { base_oracle_address: "792bca", base_chain_id: 84532, signer: "v1.signer-prod.testnet", path: "base-1", owner: "o", models: 0 });
    rpc.views.set("derived_public_key", "secp256k1:abc");
    const n = oracle(rpc);
    expect(await n.config()).toEqual({ base_oracle_address: "792bca", base_chain_id: 84532, signer: "v1.signer-prod.testnet", path: "base-1" });
    expect(await n.derivedPublicKey("v1.signer-prod.testnet", "base-1", "oracle.psephex.testnet")).toBe("secp256k1:abc");
    expect(rpc.lastView).toEqual({ method: "derived_public_key", args: { path: "base-1", predecessor: "oracle.psephex.testnet", domain_id: 0 } });
    rpc.views.set("config", { base_chain_id: "x" });
    rpc.views.set("derived_public_key", 5);
    await expect(n.config()).rejects.toThrow(/config/);
    await expect(n.derivedPublicKey("s", "p", "a")).rejects.toThrow(/string/);
  });

  it("rejects malformed view results", async () => {
    const rpc = new FakeRpc();
    rpc.views.set("build_request", 42);
    rpc.views.set("max_fee_per_gas_cap", "abc");
    rpc.views.set("models", "nope");
    const n = oracle(rpc);
    await expect(n.buildRequest(1, "q", "m")).rejects.toThrow(/string/);
    await expect(n.maxFeePerGasCap()).rejects.toThrow(/cap/);
    await expect(n.models()).rejects.toThrow(/array/);
  });
});

describe("NearOracle transactions", () => {
  it("maps an unknown transaction to unknown", async () => {
    const rpc = new FakeRpc();
    rpc.statusError = Object.assign(new Error("Unknown transaction 1111"), { name: "UnknownTransactionError" });
    expect(await oracle(rpc).txOutcome("1111")).toEqual({ kind: "unknown" });
  });

  it("rethrows other status errors", async () => {
    const rpc = new FakeRpc();
    rpc.statusError = new Error("502 bad gateway");
    await expect(oracle(rpc).txOutcome("h")).rejects.toThrow(/502/);
  });

  it("returns the parsed outcome of a known transaction", async () => {
    expect(await oracle(new FakeRpc()).txOutcome("h")).toMatchObject({ kind: "failure" });
  });

  it("treats a send timeout as unknown so the hash is polled later", async () => {
    const rpc = new FakeRpc();
    rpc.sendError = new Error("send_tx timed out");
    const signed = { txHash: "h", signedTxBase64: "AA==" };
    const n = new NearOracle({ rpc, contractId: "c", relayerId: "r", signer: null, fulfillGasTera: 200, timeoutMs: 1000, decode: () => ({}) });
    expect(await n.sendSigned(signed)).toEqual({ kind: "unknown" });
    rpc.sendError = new Error("InvalidNonce");
    expect(await n.sendSigned(signed)).toEqual({ kind: "invalid", error: "InvalidNonce" });
    rpc.sendError = new Error("Transaction Expired");
    expect(await n.sendSigned(signed)).toEqual({ kind: "invalid", error: "Transaction Expired" });
    rpc.sendError = new Error("connection reset");
    await expect(n.sendSigned(signed)).rejects.toThrow(/reset/);
    rpc.sendError = undefined;
    expect(await n.sendSigned(signed)).toMatchObject({ kind: "failure" });
  });

  it("reads the permission of the relayer key", async () => {
    const rpc = new FakeRpc();
    const signer = { sign: async () => ({ txHash: "h", signedTxBase64: "" }), publicKey: async () => "ed25519:PUB" };
    const n = new NearOracle({ rpc, contractId: "c", relayerId: "relayer.psephex.testnet", signer, fulfillGasTera: 200, timeoutMs: 1000 });
    expect(await n.relayerKeyPermission()).toBe("FullAccess");
    expect(rpc.keyQuery).toEqual({ accountId: "relayer.psephex.testnet", publicKey: "ed25519:PUB" });
    await expect(oracle(rpc).relayerKeyPermission()).rejects.toThrow(/key/);
  });

  it("refuses to sign without a key", async () => {
    await expect(oracle(new FakeRpc()).signFulfill({ request_id: 1, question: "q", answers: [], nonce: 0, max_fee_per_gas: "1", max_priority_fee_per_gas: "1" })).rejects.toThrow(/key/);
  });
});
