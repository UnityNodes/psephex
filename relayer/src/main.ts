import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonRpcProvider } from "near-api-js";
import { BaseChain } from "./base.js";
import { loadConfig, type RelayerConfig } from "./config.js";
import { openDatabase, type Repository } from "./db.js";
import { acquireLock } from "./lock.js";
import { createLogger } from "./logger.js";
import { createFulfillSigner, NearOracle, type NearRpc } from "./near.js";
import { NearAiClient } from "./nearai.js";
import { Processor, type Log } from "./pipeline.js";
import { Scanner } from "./scanner.js";
import { startupChecks } from "./startup.js";

const MAX_QUESTION_BYTES = 2000;
const EVM_GAS_LIMIT = 300_000n;
const NEAR_TIMEOUT_MS = 60_000;
const MODEL_TIMEOUT_MS = 120_000;
const SIGNATURE_RETRIES = 10;
const SIGNATURE_DELAY_MS = 1_000;

interface Services {
  readonly repo: Repository;
  readonly near: NearOracle;
  readonly base: BaseChain;
  readonly scanner: Scanner;
  readonly processor: Processor;
}

function build(config: RelayerConfig, log: Log): Services {
  const clock = { now: () => Date.now() };
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const repo = openDatabase(config.dbPath, clock);
  const provider = new JsonRpcProvider({ url: config.nearRpcUrl });
  const signer = createFulfillSigner(provider, config.nearRelayerAccount, config.nearRelayerKey, config.nearOracleContract, config.fulfillGasTera);
  const near = new NearOracle({
    rpc: provider as unknown as NearRpc,
    contractId: config.nearOracleContract,
    relayerId: config.nearRelayerAccount,
    signer,
    fulfillGasTera: config.fulfillGasTera,
    timeoutMs: NEAR_TIMEOUT_MS,
  });
  const base = new BaseChain({ url: config.baseRpcUrl, aiOracle: config.aiOracleAddress, chainId: config.baseChainId });
  const models = new NearAiClient({
    baseUrl: config.nearAiBaseUrl,
    apiKey: config.nearAiApiKey,
    fetch: globalThis.fetch,
    timeoutMs: MODEL_TIMEOUT_MS,
    signatureRetries: SIGNATURE_RETRIES,
    signatureDelayMs: SIGNATURE_DELAY_MS,
    now: clock.now,
    sleep: (ms) => sleep(ms).then(() => undefined),
  });
  const scanner = new Scanner({ repo, base, log, settings: config });
  const processor = new Processor({ repo, near, models, base, clock, log, settings: { ...config, maxQuestionBytes: MAX_QUESTION_BYTES, evmGasLimit: EVM_GAS_LIMIT } });
  return { repo, near, base, scanner, processor };
}

async function loop(services: Services, config: RelayerConfig, log: Log, once: boolean, stop: () => boolean): Promise<void> {
  while (!stop()) {
    try {
      await services.scanner.catchUp();
      const summary = await services.processor.drain();
      if (summary.processed.length > 0) log.info({ ...summary }, "queue pass");
      if (once && services.repo.listActive().length === 0) return;
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "loop iteration failed");
    }
    await sleep(config.pollMs);
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig(process.env);
  const log = createLogger(process.env.LOG_LEVEL ?? "info", undefined, [config.nearAiApiKey, config.nearRelayerKey, config.baseRpcUrl, config.nearRpcUrl]);
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const releaseLock = acquireLock(`${config.dbPath}.lock`);
  const services = build(config, log);
  let stopping = false;
  const stop = (signal: string) => {
    log.info({ signal }, "stopping after the current step");
    stopping = true;
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  try {
    await startupChecks({ near: services.near, base: services.base, settings: config });
    log.info({ aiOracle: config.aiOracleAddress, oracle: config.oracleEvmAddress, near: config.nearOracleContract, once }, "relayer started");
    await loop(services, config, log, once, () => stopping);
  } finally {
    services.repo.close();
    releaseLock();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "fatal", msg: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
