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
      publicBaseRpcUrl: "https://sepolia.base.org",
      nearNetwork: "testnet",
      baseChainId: 84532,
      aiOracleAddress: "0x792bCa54672763Af3B1FaA1Fb62d3Cb2fCff6111",
    });
  });

  it("refuses to start with relayer secrets in its environment", () => {
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_RELAYER_KEY: "ed25519:abc" })).toThrow(/NEAR_RELAYER_KEY must not be set/);
    expect(() => loadApiConfig({ ...BASE_ENV, NEAR_AI_API_KEY: "sk-x" })).toThrow(/NEAR_AI_API_KEY must not be set/);
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
    expect(() => loadApiConfig(rest)).toThrow(/DB_PATH is required/);
  });
});
