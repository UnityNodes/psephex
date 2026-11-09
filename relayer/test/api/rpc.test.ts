import { describe, expect, it } from "vitest";
import { checkApiTargets, createRpcReader } from "../../src/api/rpc.js";
import { MODELS } from "./fixture.js";

describe("createRpcReader", () => {
  it("reads Base and NEAR through the existing clients", async () => {
    const seen: string[] = [];
    const reader = createRpcReader({
      base: { headBlock: async () => 7n, balance: async (a) => (seen.push(a), 9n) },
      near: { models: async () => [...MODELS] },
      nearRpc: { viewAccount: async ({ accountId }) => (seen.push(accountId), { amount: 5n }) },
      timeoutMs: 1_000,
    });
    expect(await reader.baseHead()).toBe(7n);
    expect(await reader.baseBalance("0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F")).toBe(9n);
    expect(await reader.nearBalance("relayer.psephex.testnet")).toBe(5n);
    expect(await reader.models()).toHaveLength(3);
    expect(seen).toEqual(["0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F", "relayer.psephex.testnet"]);
  });

  it("times out a NEAR account view that never answers", async () => {
    const reader = createRpcReader({
      base: { headBlock: async () => 7n, balance: async () => 9n },
      near: { models: async () => [] },
      nearRpc: { viewAccount: () => new Promise(() => {}) },
      timeoutMs: 10,
    });
    await expect(reader.nearBalance("relayer.psephex.testnet")).rejects.toThrow(/timed out/);
  });
});

describe("checkApiTargets", () => {
  const config = { aiOracleAddress: "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111" as const, baseChainId: 84532 };
  const near = (address: string, chainId = 84532) => ({ config: async () => ({ base_oracle_address: address, base_chain_id: chainId, signer: "v1.signer-prod.testnet", path: "p" }) });

  it("passes when the NEAR contract signs for the configured AiOracle and chain", async () => {
    let asserted = false;
    await checkApiTargets({ base: { assertChain: async () => void (asserted = true) }, near: near("792bca54672763af3b1faa1fb62d3cb2fcff6111"), config });
    expect(asserted).toBe(true);
  });

  it("fails on another AiOracle or chain", async () => {
    const base = { assertChain: async () => {} };
    await expect(checkApiTargets({ base, near: near("0x0000000000000000000000000000000000000001"), config })).rejects.toThrow(/signs for AiOracle/);
    await expect(checkApiTargets({ base, near: near("792bca54672763af3b1faa1fb62d3cb2fcff6111", 8453), config })).rejects.toThrow(/chain 8453/);
  });
});
