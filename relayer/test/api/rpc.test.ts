import { describe, expect, it } from "vitest";
import { checkApiTargets, createRpcReader } from "../../src/api/rpc.js";
import { allSources, ARB_AIORACLE, buildFixture, MODELS } from "./fixture.js";

const nearViews = { models: async () => [...MODELS], nearFee: async () => 9n, lastNearRequestId: async () => 4 };

describe("createRpcReader", () => {
  it("reads each EVM source, NEAR heads and NEAR accounts through the existing clients", async () => {
    const seen: string[] = [];
    const reader = createRpcReader({
      evm: {
        base: { headBlock: async () => 7n, balance: async (a) => (seen.push(`base ${a}`), 9n) },
        arbitrum: { headBlock: async () => 70n, balance: async (a) => (seen.push(`arbitrum ${a}`), 90n) },
      },
      near: nearViews,
      nearRpc: { viewAccount: async ({ accountId }) => (seen.push(accountId), { amount: 5n }) },
      timeoutMs: 1_000,
    });
    expect(await reader.head("base")).toBe(7n);
    expect(await reader.head("arbitrum")).toBe(70n);
    expect(await reader.head("near")).toBe(4n);
    expect(await reader.evmBalance("arbitrum", "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F")).toBe(90n);
    expect(await reader.nearBalance("relayer.psephex.testnet")).toBe(5n);
    expect(await reader.nearFee()).toBe(9n);
    expect(await reader.models()).toHaveLength(3);
    expect(seen).toEqual(["arbitrum 0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F", "relayer.psephex.testnet"]);
    await expect(createRpcReader({ evm: {}, near: nearViews, nearRpc: { viewAccount: async () => ({ amount: 0n }) }, timeoutMs: 1 }).head("base")).rejects.toThrow(/no EVM RPC/);
  });

  it("times out a NEAR account view that never answers", async () => {
    const reader = createRpcReader({
      evm: {},
      near: nearViews,
      nearRpc: { viewAccount: () => new Promise(() => {}) },
      timeoutMs: 10,
    });
    await expect(reader.nearBalance("relayer.psephex.testnet")).rejects.toThrow(/timed out/);
  });
});

describe("checkApiTargets", () => {
  const fx = buildFixture();
  const sources = allSources(fx);
  fx.cleanup();
  const chains = (baseAddress: string, arbAddress = ARB_AIORACLE.toLowerCase()) => [
    { chain: "eip155:84532", chainId: 84532, name: "Base Sepolia", oracleAddress: baseAddress },
    { chain: "eip155:421614", chainId: 421614, name: "Arbitrum Sepolia", oracleAddress: arbAddress },
  ];
  const near = (baseAddress: string, nearChain = "near:testnet", arb?: string) => ({ config: async () => ({ chains: chains(baseAddress, arb), nearChain }) });
  const BASE = "0x792bca54672763af3b1faa1fb62d3cb2fcff6111";

  it("passes when the NEAR contract signs for every configured AiOracle and serves the NEAR chain", async () => {
    const asserted: string[] = [];
    const evm = { base: { assertChain: async () => void asserted.push("base") }, arbitrum: { assertChain: async () => void asserted.push("arbitrum") } };
    await checkApiTargets({ evm, near: near(BASE), sources });
    expect(asserted).toEqual(["base", "arbitrum"]);
  });

  it("fails on another AiOracle, a missing chain or another NEAR network", async () => {
    const evm = { base: { assertChain: async () => {} }, arbitrum: { assertChain: async () => {} } };
    await expect(checkApiTargets({ evm, near: near("0x0000000000000000000000000000000000000001"), sources })).rejects.toThrow(/signs for AiOracle/);
    await expect(checkApiTargets({ evm, near: near(BASE, "near:testnet", "0x0000000000000000000000000000000000000002"), sources })).rejects.toThrow(/eip155:421614/);
    await expect(checkApiTargets({ evm, near: { config: async () => ({ chains: [], nearChain: "near:testnet" }) }, sources })).rejects.toThrow(/no chain eip155:84532/);
    await expect(checkApiTargets({ evm, near: near(BASE, "near:mainnet"), sources })).rejects.toThrow(/near:mainnet/);
    await expect(checkApiTargets({ evm: {}, near: near(BASE), sources })).rejects.toThrow(/no EVM RPC/);
  });
});
