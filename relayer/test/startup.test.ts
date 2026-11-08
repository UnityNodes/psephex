import { describe, expect, it } from "vitest";
import { checkRelayerPermission, evmAddressFromDerivedKey, startupChecks, type StartupNear } from "../src/startup.js";
import { loadConfig } from "../src/config.js";

const DERIVED = "secp256k1:5SfEYf4Y1CCW1ryYLRXb9oq4MkBBXc4mkRXQ77EqHVcvbmm7yJ33fP9oLCQKsbZb61TMfXiLpsmdPcu997fgeLsK";
const ORACLE = "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F";
const AIORACLE = "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111";

const FC_KEY = { FunctionCall: { allowance: "999812953654844600000000", method_names: ["fulfill_on_base"], receiver_id: "oracle.psephex.testnet" } };

function near(overrides: Partial<{ base_oracle_address: string; base_chain_id: number; derived: string; permission: unknown }> = {}): StartupNear {
  return {
    config: async () => ({
      base_oracle_address: overrides.base_oracle_address ?? AIORACLE.toLowerCase().slice(2),
      base_chain_id: overrides.base_chain_id ?? 84532,
      signer: "v1.signer-prod.testnet",
      path: "base-1",
    }),
    derivedPublicKey: async () => overrides.derived ?? DERIVED,
    relayerKeyPermission: async () => overrides.permission ?? FC_KEY,
  };
}

const settings = { aiOracleAddress: AIORACLE, oracleEvmAddress: ORACLE, baseChainId: 84532, nearOracleContract: "oracle.psephex.testnet" } as const;
const base = { assertChain: async () => {}, fee: async () => 100_000_000_000_000n };

describe("evmAddressFromDerivedKey", () => {
  it("matches the address derived for oracle.psephex.testnet on 08.11.2026", () => {
    expect(evmAddressFromDerivedKey(DERIVED)).toBe(ORACLE);
  });

  it("rejects keys that are not 64-byte secp256k1 points", () => {
    expect(() => evmAddressFromDerivedKey("ed25519:abc")).toThrow(/secp256k1/);
    expect(() => evmAddressFromDerivedKey("secp256k1:3mJr7AoUXx2Wqd")).toThrow(/64 bytes/);
  });
});

describe("startupChecks", () => {
  it("passes when NEAR points at our AiOracle and derives our oracle address", async () => {
    await expect(startupChecks({ near: near(), base, settings })).resolves.toBeUndefined();
  });

  it("fails when NEAR signs for another AiOracle", async () => {
    await expect(startupChecks({ near: near({ base_oracle_address: "afab2dda85dbd8e6a915b55fdabf46e6d0569e27" }), base, settings })).rejects.toThrow(/AiOracle/);
  });

  it("fails on a chain id mismatch", async () => {
    await expect(startupChecks({ near: near({ base_chain_id: 1 }), base, settings })).rejects.toThrow(/chain/);
  });

  it("fails when the derived address differs from ORACLE_EVM_ADDRESS", async () => {
    await expect(startupChecks({ near: near(), base, settings: { ...settings, oracleEvmAddress: AIORACLE } })).rejects.toThrow(/derived/);
  });

  it("fails when the Base RPC is on another chain", async () => {
    const wrong = { ...base, assertChain: async () => Promise.reject(new Error("Base RPC reports chain id 8453")) };
    await expect(startupChecks({ near: near(), base: wrong, settings })).rejects.toThrow(/8453/);
  });
});

describe("relayer key and fee checks", () => {
  it("refuses a zero AiOracle fee", async () => {
    await expect(startupChecks({ near: near(), base: { ...base, fee: async () => 0n }, settings })).rejects.toThrow(/fee is 0/);
  });

  it("refuses a full-access relayer key", async () => {
    await expect(startupChecks({ near: near({ permission: "FullAccess" }), base, settings })).rejects.toThrow(/full access/);
  });

  it("checks receiver, methods and allowance of the function-call key", () => {
    const contract = "oracle.psephex.testnet";
    expect(() => checkRelayerPermission(FC_KEY, contract)).not.toThrow();
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, receiver_id: "other.testnet" } }, contract)).toThrow(/other.testnet/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: [] } }, contract)).toThrow(/methods/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: ["fulfill_on_base", "add_relayer"] } }, contract)).toThrow(/methods/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, allowance: "1000" } }, contract)).toThrow(/allowance/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, allowance: null } }, contract)).not.toThrow();
  });
});

describe("loadConfig", () => {
  const env = {
    BASE_RPC_URL: "https://sepolia.base.org",
    NEAR_RPC_URL: "https://rpc.testnet.fastnear.com",
    NEAR_AI_API_KEY: "k",
    NEAR_RELAYER_ACCOUNT: "relayer.psephex.testnet",
    NEAR_RELAYER_KEY: `ed25519:${"3".repeat(64)}`,
    NEAR_ORACLE_CONTRACT: "oracle.psephex.testnet",
    AIORACLE_ADDRESS: AIORACLE.toLowerCase(),
    ORACLE_EVM_ADDRESS: ORACLE,
  };

  it("loads defaults and normalizes addresses", () => {
    const c = loadConfig(env);
    expect(c.aiOracleAddress).toBe(AIORACLE);
    expect(c.maxFeePerGas).toBe(2_000_000_000n);
    expect(c).toMatchObject({ baseChainId: 84532, confirmations: 10, startBlock: 0n, logBlockRange: 200n, stuckMs: 1_800_000, maxQueue: 50, feeBaseMultiplier: 4, nearAiBaseUrl: "https://cloud-api.near.ai" });
  });

  it("reads overrides", () => {
    const c = loadConfig({ ...env, MAX_FEE_GWEI: "0.5", START_BLOCK: "56174081", CONFIRMATIONS: "3", NEAR_AI_BASE_URL: "http://127.0.0.1:9999/" });
    expect(c).toMatchObject({ maxFeePerGas: 500_000_000n, startBlock: 56_174_081n, confirmations: 3, nearAiBaseUrl: "http://127.0.0.1:9999" });
  });

  it("rejects missing or malformed values without echoing secrets", () => {
    expect(() => loadConfig({ ...env, NEAR_AI_API_KEY: "" })).toThrow(/NEAR_AI_API_KEY is required/);
    expect(() => loadConfig({ ...env, NEAR_RELAYER_KEY: "secret-value" })).toThrow(/ed25519/);
    expect(() => loadConfig({ ...env, NEAR_RELAYER_KEY: "secret-value" })).not.toThrow(/secret-value/);
    expect(() => loadConfig({ ...env, AIORACLE_ADDRESS: "0x123" })).toThrow(/EVM address/);
    expect(() => loadConfig({ ...env, BASE_RPC_URL: "http://example.com" })).toThrow(/https/);
    expect(() => loadConfig({ ...env, BASE_RPC_URL: "not a url" })).toThrow(/valid URL/);
    expect(() => loadConfig({ ...env, CONFIRMATIONS: "0" })).toThrow(/positive/);
    expect(() => loadConfig({ ...env, CONFIRMATIONS: "-1" })).toThrow(/positive/);
    expect(() => loadConfig({ ...env, START_BLOCK: "1e5" })).toThrow(/non-negative/);
    expect(() => loadConfig({ ...env, MAX_FEE_GWEI: "abc" })).toThrow(/decimal/);
    expect(() => loadConfig({ ...env, MAX_FEE_GWEI: "0" })).toThrow(/positive/);
  });
});
