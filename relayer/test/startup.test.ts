import { describe, expect, it } from "vitest";
import { checkRelayerPermission, evmAddressFromDerivedKey, nearStartupChecks, startupChecks, type StartupNear } from "../src/startup.js";
import { loadConfig } from "../src/config.js";

const DERIVED = "secp256k1:5SfEYf4Y1CCW1ryYLRXb9oq4MkBBXc4mkRXQ77EqHVcvbmm7yJ33fP9oLCQKsbZb61TMfXiLpsmdPcu997fgeLsK";
const ORACLE = "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F";
const AIORACLE = "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111";

const FC_KEY = { FunctionCall: { allowance: "999812953654844600000000", method_names: ["fulfill_on_evm"], receiver_id: "oracle.psephex.testnet" } };
const NEAR_KEY = { FunctionCall: { ...FC_KEY.FunctionCall, method_names: ["fulfill_on_near"] } };

interface NearOverrides {
  base_oracle_address: string;
  base_chain_id: number;
  derived: string;
  permission: unknown;
  near_chain: string;
  near_fee: bigint;
}

function near(overrides: Partial<NearOverrides> = {}): StartupNear {
  const chainId = overrides.base_chain_id ?? 84532;
  return {
    config: async () => ({
      signer: "v1.signer-prod.testnet",
      path: "base-1",
      chains: [{ chain: `eip155:${chainId}`, chainId, name: "Base Sepolia", oracleAddress: `0x${overrides.base_oracle_address ?? AIORACLE.toLowerCase().slice(2)}` }],
      nearChain: overrides.near_chain ?? "near:testnet",
      nearFee: overrides.near_fee ?? 10n ** 22n,
      lastNearRequestId: 0,
    }),
    derivedPublicKey: async () => overrides.derived ?? DERIVED,
    relayerKeyPermission: async () => overrides.permission ?? FC_KEY,
  };
}

const settings = { chain: "eip155:84532", aiOracleAddress: AIORACLE, oracleEvmAddress: ORACLE, nearOracleContract: "oracle.psephex.testnet" } as const;
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
    await expect(startupChecks({ near: near({ base_chain_id: 1 }), base, settings })).rejects.toThrow(/no chain eip155:84532/);
  });

  it("checks the Arbitrum entry of the chains table for an Arbitrum relayer", async () => {
    const arbitrum = { ...settings, chain: "eip155:421614" };
    await expect(startupChecks({ near: near({ base_chain_id: 421614 }), base, settings: arbitrum })).resolves.toBeUndefined();
    await expect(startupChecks({ near: near(), base, settings: arbitrum })).rejects.toThrow(/421614/);
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
    const evm = "fulfill_on_evm";
    expect(() => checkRelayerPermission(FC_KEY, contract, evm)).not.toThrow();
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: ["fulfill_on_evm", "fulfill_on_near"] } }, contract, evm)).not.toThrow();
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, receiver_id: "other.testnet" } }, contract, evm)).toThrow(/other.testnet/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: [] } }, contract, evm)).toThrow(/methods/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: ["fulfill_on_evm", "add_relayer"] } }, contract, evm)).toThrow(/methods/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, method_names: ["fulfill_on_base"] } }, contract, evm)).toThrow(/methods/);
    expect(() => checkRelayerPermission(NEAR_KEY, contract, evm)).toThrow(/methods/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, allowance: "1000" } }, contract, evm)).toThrow(/allowance/);
    expect(() => checkRelayerPermission({ FunctionCall: { ...FC_KEY.FunctionCall, allowance: null } }, contract, evm)).not.toThrow();
  });
});

describe("nearStartupChecks", () => {
  const nearSettings = { chain: "near:testnet", nearOracleContract: "oracle.psephex.testnet" };

  it("passes with a fulfill_on_near key, the testnet chain and a positive fee", async () => {
    await expect(nearStartupChecks({ near: near({ permission: NEAR_KEY }), settings: nearSettings })).resolves.toBeUndefined();
  });

  it("refuses an EVM-only key, another NEAR network or a zero fee", async () => {
    await expect(nearStartupChecks({ near: near(), settings: nearSettings })).rejects.toThrow(/fulfill_on_near/);
    await expect(nearStartupChecks({ near: near({ permission: NEAR_KEY, near_chain: "near:mainnet" }), settings: nearSettings })).rejects.toThrow(/near:mainnet/);
    await expect(nearStartupChecks({ near: near({ permission: NEAR_KEY, near_fee: 0n }), settings: nearSettings })).rejects.toThrow(/fee is 0/);
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
    if (c.kind !== "evm") throw new Error("expected an EVM config");
    expect(c.aiOracleAddress).toBe(AIORACLE);
    expect(c.maxFeePerGas).toBe(2_000_000_000n);
    expect(c).toMatchObject({ source: "base", chain: "eip155:84532", evmChainId: 84532, evmRpcUrl: "https://sepolia.base.org", dbPath: "data/relayer.sqlite", confirmations: 10, startBlock: 0n, logBlockRange: 200n, stuckMs: 1_800_000, maxQueue: 50, feeBaseMultiplier: 4, nearAiBaseUrl: "https://cloud-api.near.ai" });
  });

  it("treats the Phala key as optional and requires https for Phala", () => {
    expect(loadConfig(env)).toMatchObject({ phalaApiKey: null, phalaBaseUrl: "https://api.redpill.ai" });
    expect(loadConfig({ ...env, PHALA_API_KEY: "sk-rp-x" })).toMatchObject({ phalaApiKey: "sk-rp-x" });
    expect(() => loadConfig({ ...env, PHALA_BASE_URL: "http://api.redpill.ai" })).toThrow(/https/);
  });

  it("reads overrides", () => {
    const c = loadConfig({ ...env, MAX_FEE_GWEI: "0.5", START_BLOCK: "56174081", CONFIRMATIONS: "3", NEAR_AI_BASE_URL: "http://127.0.0.1:9999/" });
    expect(c).toMatchObject({ maxFeePerGas: 500_000_000n, startBlock: 56_174_081n, confirmations: 3, nearAiBaseUrl: "http://127.0.0.1:9999" });
  });

  it("loads an Arbitrum source from EVM_* names with its own chain key and database", () => {
    const { BASE_RPC_URL: _rpc, ...rest } = env;
    const c = loadConfig({ ...rest, SOURCE: "arbitrum", START_BLOCK: "1", EVM_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc" });
    expect(c).toMatchObject({ kind: "evm", source: "arbitrum", chain: "eip155:421614", evmChainId: 421614, evmRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc", dbPath: "data/relayer-arbitrum.sqlite" });
    expect(() => loadConfig({ ...env, SOURCE: "arbitrum", START_BLOCK: "1" })).toThrow(/EVM_RPC_URL/);
    expect(() => loadConfig({ ...env, SOURCE: "arbitrum", START_BLOCK: "1", BASE_CHAIN_ID: "84532", EVM_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc" })).not.toThrow();
    expect(() => loadConfig({ ...env, SOURCE: "arbitrum", START_BLOCK: "1", EVM_CHAIN_ID: "84532", EVM_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc" })).toThrow(/runs on chain 421614, got 84532/);
    expect(() => loadConfig({ ...env, SOURCE: "arbitrum", EVM_RPC_URL: "https://sepolia-rollup.arbitrum.io/rpc" })).toThrow(/START_BLOCK is required/);
    expect(loadConfig({ ...env, EVM_CHAIN_ID: "31337" })).toMatchObject({ chain: "eip155:31337" });
    expect(() => loadConfig(rest)).toThrow(/EVM_RPC_URL or BASE_RPC_URL is required/);
  });

  it("loads a NEAR source without any EVM settings", () => {
    const { BASE_RPC_URL: _rpc, AIORACLE_ADDRESS: _a, ORACLE_EVM_ADDRESS: _o, ...nearOnly } = env;
    const c = loadConfig({ ...nearOnly, SOURCE: "near", NEAR_START_ID: "3" });
    expect(c).toMatchObject({ kind: "near", source: "near", chain: "near:testnet", startId: 3, pageSize: 100, dbPath: "data/relayer-near.sqlite" });
    expect(() => loadConfig({ ...nearOnly, SOURCE: "near", NEAR_PAGE_SIZE: "101" })).toThrow(/at most 100/);
    expect(() => loadConfig({ ...nearOnly, SOURCE: "near", NEAR_ORACLE_CONTRACT: "oracle.psephex.near" })).toThrow(/testnet/);
    expect(() => loadConfig({ ...env, SOURCE: "solana" })).toThrow(/SOURCE/);
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
