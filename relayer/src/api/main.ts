import { JsonRpcProvider } from "near-api-js";
import { BaseChain } from "../base.js";
import { createLogger, createScrubber } from "../logger.js";
import { NearOracle, type NearRpc } from "../near.js";
import { createChainStatus } from "./chain.js";
import { loadApiConfig } from "./config.js";
import { checkApiTargets, createRpcReader } from "./rpc.js";
import { buildServer } from "./server.js";
import { ReadStore } from "./store.js";

const RPC_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const config = loadApiConfig(process.env);
  const log = createLogger(process.env.LOG_LEVEL ?? "info", undefined, [config.baseRpcUrl, config.nearRpcUrl], "psephex-api");
  const provider = new JsonRpcProvider({ url: config.nearRpcUrl });
  const near = new NearOracle({ rpc: provider as unknown as NearRpc, contractId: config.nearOracleContract, relayerId: config.nearRelayerAccount, signer: null, timeoutMs: RPC_TIMEOUT_MS });
  const base = new BaseChain({ url: config.baseRpcUrl, aiOracle: config.aiOracleAddress, chainId: config.baseChainId, timeoutMs: RPC_TIMEOUT_MS });
  await checkApiTargets({ base, near, config });
  const store = ReadStore.open(config.dbPath);
  const reader = createRpcReader({ base, near, nearRpc: provider, timeoutMs: RPC_TIMEOUT_MS });
  const onError = (source: string, err: unknown) => log.warn({ source, err: err instanceof Error ? err.message : String(err) }, "chain read failed");
  const chain = createChainStatus(reader, config, config.chainCacheMs, Date.now, onError);
  const app = await buildServer({ store, chain, config, log, now: Date.now });
  const shutdown = (signal: string) => {
    log.info({ signal }, "api stopping");
    app.close().finally(() => store.close());
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  await app.listen({ host: config.host, port: config.port });
  log.info({ host: config.host, port: config.port, publicUrl: config.publicUrl, cors: config.corsOrigin }, "api listening");
}

main().catch((err: unknown) => {
  const scrub = createScrubber([process.env.BASE_RPC_URL ?? "", process.env.NEAR_RPC_URL ?? ""]);
  const msg = scrub(err instanceof Error ? err.message : String(err));
  process.stderr.write(`${JSON.stringify({ level: "fatal", service: "psephex-api", msg })}\n`);
  process.exit(1);
});
