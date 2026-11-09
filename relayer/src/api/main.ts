import { JsonRpcProvider } from "near-api-js";
import { BaseChain } from "../base.js";
import { createLogger, createScrubber } from "../logger.js";
import { NearOracle, type NearRpc } from "../near.js";
import { cursorKey, NEAR_TESTNET_CHAIN, type SourceName } from "../sources.js";
import { createChainStatus } from "./chain.js";
import { loadApiConfig, type ApiConfig } from "./config.js";
import { checkApiTargets, createRpcReader } from "./rpc.js";
import { buildServer } from "./server.js";
import { ReadStore } from "./store.js";

const RPC_TIMEOUT_MS = 15_000;

function evmClients(config: ApiConfig): Partial<Record<SourceName, BaseChain>> {
  return Object.fromEntries(
    config.sources.flatMap((s) => (s.kind === "evm" ? [[s.source, new BaseChain({ url: s.rpcUrl, aiOracle: s.aiOracleAddress, chainId: s.chainId, timeoutMs: RPC_TIMEOUT_MS })]] : [])),
  );
}

function openStores(config: ApiConfig): Map<SourceName, ReadStore> {
  const stores = new Map<SourceName, ReadStore>();
  try {
    for (const s of config.sources) stores.set(s.source, ReadStore.open(s.dbPath, cursorKey(s.source)));
  } catch (err) {
    for (const store of stores.values()) store.close();
    throw err;
  }
  return stores;
}

function rpcSecrets(config: ApiConfig): string[] {
  return [config.nearRpcUrl, ...config.sources.flatMap((s) => (s.kind === "evm" ? [s.rpcUrl] : []))];
}

async function main(): Promise<void> {
  const config = loadApiConfig(process.env);
  const log = createLogger(process.env.LOG_LEVEL ?? "info", undefined, rpcSecrets(config), "psephex-api");
  const provider = new JsonRpcProvider({ url: config.nearRpcUrl });
  const near = new NearOracle({ rpc: provider as unknown as NearRpc, contractId: config.nearOracleContract, relayerId: config.nearRelayerAccount, chain: NEAR_TESTNET_CHAIN, signer: null, timeoutMs: RPC_TIMEOUT_MS });
  const evm = evmClients(config);
  await checkApiTargets({ evm, near, sources: config.sources });
  const stores = openStores(config);
  const reader = createRpcReader({ evm, near, nearRpc: provider, timeoutMs: RPC_TIMEOUT_MS });
  const onError = (source: string, err: unknown) => log.warn({ source, err: err instanceof Error ? err.message : String(err) }, "chain read failed");
  const chain = createChainStatus(reader, config, config.chainCacheMs, Date.now, onError);
  const app = await buildServer({ stores, chain, config, log, now: Date.now });
  const shutdown = (signal: string) => {
    log.info({ signal }, "api stopping");
    app.close().finally(() => {
      for (const store of stores.values()) store.close();
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  await app.listen({ host: config.host, port: config.port });
  log.info({ host: config.host, port: config.port, publicUrl: config.publicUrl, cors: config.corsOrigin, sources: config.sources.map((s) => s.source) }, "api listening");
}

main().catch((err: unknown) => {
  const urls = Object.entries(process.env).flatMap(([k, v]) => (/RPC_URL$/.test(k) && v ? [v] : []));
  const scrub = createScrubber(urls);
  const msg = scrub(err instanceof Error ? err.message : String(err));
  process.stderr.write(`${JSON.stringify({ level: "fatal", service: "psephex-api", msg })}\n`);
  process.exit(1);
});
