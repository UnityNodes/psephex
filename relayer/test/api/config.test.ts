import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../../src/api/config.js";

const BASE_ENV = {
  DB_PATH: "/var/lib/psephex/relayer.sqlite",
  BASE_RPC_URL: "https://base.rpc.test/key",
  NEAR_RPC_URL: "https://near.rpc.test/key",
  AIORACLE_ADDRESS: "0x792bca54672763af3b1faa1fb62d3cb2fcff6111",
  ORACLE_EVM_ADDRESS: "0x3A915e664Bc3c87954b9C1CaD2146B44A8a2e35F",
  NEAR_ORACLE_CONTRACT: "oracle.psephex.testnet",
  NEAR_RELAYER_ACCOUNT: "relayer.psephex.testnet",
};

describe("loadApiConfig", () => {
  it("applies local defaults and checksums addresses", () => {
    const c = loadApiConfig(BASE_ENV);
    expect(c).toMatchObject({
      host: "127.0.0.1",
      port: 8790,
      publicUrl: "http://127.0.0.1:8790",
      corsOrigin: null,
      rateLimitPerMinute: 120,
      trustProxy: false,
      nearNetwork: "testnet",
    });
    expect(c.sources).toEqual([
      {
        source: "base",
        kind: "evm",
        chain: "eip155:84532",
        name: "Base Sepolia",
        dbPath: "/var/lib/psephex/relayer.sqlite",
        explorer: "https://sepolia.basescan.org",
        rpcUrl: "https://base.rpc.test/key",
        publicRpcUrl: "https://sepolia.base.org",
        aiOracleAddress: "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111",
        chainId: 84532,
        dispute: null,
      },
    ]);
  });

  it("lists every configured source with its own database and contracts", () => {
    const c = loadApiConfig({
      ...BASE_ENV,
      API_SOURCES: "base, arbitrum,near",
      ARBITRUM_DB_PATH: "/var/lib/psephex/relayer-arbitrum.sqlite",
      ARBITRUM_RPC_URL: "https://arb.rpc.test/key",
      ARBITRUM_AIORACLE_ADDRESS: "0x1111111111111111111111111111111111111111",
      ARBITRUM_DISPUTE_ADDRESS: "0x2222222222222222222222222222222222222222",
      NEAR_DB_PATH: "/var/lib/psephex/relayer-near.sqlite",
      NEAR_DISPUTE_CONTRACT: "dispute.psephex.testnet",
    });
    expect(c.sources.map((s) => [s.source, s.chain, s.dbPath])).toEqual([
      ["base", "eip155:84532", "/var/lib/psephex/relayer.sqlite"],
      ["arbitrum", "eip155:421614", "/var/lib/psephex/relayer-arbitrum.sqlite"],
      ["near", "near:testnet", "/var/lib/psephex/relayer-near.sqlite"],
    ]);
    expect(c.sources[1]).toMatchObject({ publicRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io", dispute: "0x2222222222222222222222222222222222222222" });
    expect(c.sources[2]).toMatchObject({ kind: "near", dispute: "dispute.psephex.testnet", explorer: "https://testnet.nearblocks.io" });
  });

  it("serves NEAR alone without EVM settings", () => {
    const c = loadApiConfig({ NEAR_RPC_URL: BASE_ENV.NEAR_RPC_URL, NEAR_ORACLE_CONTRACT: BASE_ENV.NEAR_ORACLE_CONTRACT, NEAR_RELAYER_ACCOUNT: BASE_ENV.NEAR_RELAYER_ACCOUNT, API_SOURCES: "near", NEAR_DB_PATH: "/n.sqlite" });
    expect(c.oracleEvmAddress).toBeNull();
    expect(c.sources.map((s) => s.source)).toEqual(["near"]);
  });

  it("rejects unknown, repeated or database-sharing sources", () => {
    expect(() => loadApiConfig({ ...BASE_ENV, API_SOURCES: "base,solana" })).toThrow(/unknown source "solana"/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_SOURCES: "base,base" })).toThrow(/twice/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_SOURCES: "base,near", NEAR_DB_PATH: BASE_ENV.DB_PATH })).toThrow(/own database/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_SOURCES: "base,arbitrum" })).toThrow(/ARBITRUM_DB_PATH is required/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_SOURCES: "near", NEAR_DB_PATH: "/n", NEAR_DISPUTE_CONTRACT: "x;rm" })).toThrow(/NEAR account/);
  });

  it("refuses to start with relayer secrets in its environment", () => {
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_RELAYER_KEY: "ed25519:abc" })).toThrow(/NEAR_RELAYER_KEY must not be set/);
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_AI_API_KEY: "sk-x" })).toThrow(/NEAR_AI_API_KEY must not be set/);
    expect(() => loadApiConfig({ ...BASE_ENV, PHALA_API_KEY: "sk-rp-x" })).toThrow(/PHALA_API_KEY must not be set/);
  });

  it("only serves testnet contracts", () => {
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_ORACLE_CONTRACT: "oracle.psephex.near" })).toThrow(/testnet/);
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_RELAYER_ACCOUNT: "Relayer;rm" })).toThrow(/NEAR account/);
  });

  it("accepts only a bare origin for CORS", () => {
    expect(loadApiConfig({ ...BASE_ENV, API_CORS_ORIGIN: "https://psephex.app" }).corsOrigin).toBe("https://psephex.app");
    expect(() => loadApiConfig({ ...BASE_ENV, API_CORS_ORIGIN: "https://psephex.app/app" })).toThrow(/origin/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_CORS_ORIGIN: "*" })).toThrow(/origin/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_CORS_ORIGIN: "http://psephex.app" })).toThrow(/https/);
  });

  it("rejects a public URL that is not safe to paste into a shell", () => {
    expect(loadApiConfig({ ...BASE_ENV, API_PUBLIC_URL: "https://api.psephex.app/v1/" }).publicUrl).toBe("https://api.psephex.app/v1");
    expect(() => loadApiConfig({ ...BASE_ENV, API_PUBLIC_URL: "https://api.psephex.app/'$(id)'" })).toThrow(/API_PUBLIC_URL/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_PUBLIC_URL: "https://user:pw@api.psephex.app" })).toThrow(/API_PUBLIC_URL/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_PUBLIC_URL: "https://api.psephex.app/?a=1" })).toThrow(/API_PUBLIC_URL/);
  });

  it("parses the port, proxy list and limits", () => {
    const c = loadApiConfig({ ...BASE_ENV, API_PORT: "9000", API_TRUST_PROXY: "127.0.0.1,::1", API_RATE_LIMIT: "30" });
    expect(c).toMatchObject({ port: 9000, trustProxy: "127.0.0.1,::1", rateLimitPerMinute: 30 });
    expect(() => loadApiConfig({ ...BASE_ENV, API_PORT: "70000" })).toThrow(/API_PORT/);
    expect(() => loadApiConfig({ ...BASE_ENV, API_TRUST_PROXY: "true" })).toThrow(/API_TRUST_PROXY/);
    expect(loadApiConfig({ ...BASE_ENV, API_TRUST_PROXY: "10.0.0.5, fd00::1" }).trustProxy).toBe("10.0.0.5,fd00::1");
    for (const wide of ["0.0.0.0/0", "::/0", "10.0.0.0/8", "8.8.8.8", "2001:db8::1"]) {
      expect(() => loadApiConfig({ ...BASE_ENV, API_TRUST_PROXY: wide }), wide).toThrow(/API_TRUST_PROXY/);
    }
  });

  it("requires the chain settings", () => {
    const { DB_PATH: _db, ...rest } = BASE_ENV;
    expect(() => loadApiConfig(rest)).toThrow(/BASE_DB_PATH or DB_PATH is required/);
  });
});
