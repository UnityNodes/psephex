import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonRpcProvider } from "near-api-js";
import { BaseChain } from "./base.js";
import { loadConfig, type CommonRelayerConfig, type EvmRelayerConfig, type NearRelayerConfig, type RelayerConfig } from "./config.js";
import { openDatabase, type Repository } from "./db.js";
import { acquireLock } from "./lock.js";
import { createLogger } from "./logger.js";
import { createFulfillSigner, NearOracle, type NearRpc } from "./near.js";
import { NearAiClient } from "./nearai.js";
import { NearScanner } from "./near-scanner.js";
import { Processor, type Log, type ProcessorSettings } from "./pipeline.js";
import { byProvider, type ModelProviders } from "./providers.js";
import { Scanner } from "./scanner.js";
import { cursorKey, SOURCES } from "./sources.js";
import { nearStartupChecks, startupChecks } from "./startup.js";

const MAX_QUESTION_BYTES = 2000;
const EVM_GAS_LIMIT = 300_000n;
const NEAR_TIMEOUT_MS = 60_000;
const MODEL_TIMEOUT_MS = 120_000;
const SIGNATURE_RETRIES = 10;
const SIGNATURE_DELAY_MS = 1_000;
const NEAR_AI_PROVIDER = "near-ai";
const PHALA_PROVIDER = "phala";

interface SourceScanner {
  catchUp(): Promise<number>;
  head(): Promise<bigint>;
  scanned(): bigint;
}

interface Services {
  readonly repo: Repository;
  readonly scanner: SourceScanner;
  readonly processor: Processor;
  readonly checks: () => Promise<void>;
}

interface Shared {
  readonly repo: Repository;
  readonly near: NearOracle;
  readonly models: ModelProviders;
  readonly clock: { now(): number };
  readonly settings: ProcessorSettings;
}

function shared(config: CommonRelayerConfig): Shared {
  const clock = { now: () => Date.now() };
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const repo = openDatabase(config.dbPath, clock);
  const foreign = repo.cursorKeys().filter((k) => k !== cursorKey(config.source));
  if (foreign.length > 0) {
    repo.close();
    throw new Error(`${config.dbPath} holds the cursor of ${foreign.join(", ")}; SOURCE=${config.source} needs its own DB_PATH`);
  }
  const provider = new JsonRpcProvider({ url: config.nearRpcUrl });
  const signer = createFulfillSigner(provider, config.nearRelayerAccount, config.nearRelayerKey, config.nearOracleContract, config.fulfillGasTera);
  const near = new NearOracle({
    rpc: provider as unknown as NearRpc,
    contractId: config.nearOracleContract,
    relayerId: config.nearRelayerAccount,
    chain: config.chain,
    signer,
    timeoutMs: NEAR_TIMEOUT_MS,
  });
  const client = (baseUrl: string, apiKey: string) =>
    new NearAiClient({
      baseUrl,
      apiKey,
      fetch: globalThis.fetch,
      timeoutMs: MODEL_TIMEOUT_MS,
      signatureRetries: SIGNATURE_RETRIES,
      signatureDelayMs: SIGNATURE_DELAY_MS,
      now: clock.now,
      sleep: (ms) => sleep(ms).then(() => undefined),
    });
  const models = byProvider({
    [NEAR_AI_PROVIDER]: client(config.nearAiBaseUrl, config.nearAiApiKey),
    ...(config.phalaApiKey ? { [PHALA_PROVIDER]: client(config.phalaBaseUrl, config.phalaApiKey) } : {}),
  });
  const settings: ProcessorSettings = { ...config, chainLabel: SOURCES[config.source].short, maxQuestionBytes: MAX_QUESTION_BYTES };
  return { repo, near, models, clock, settings };
}

function buildEvm(config: EvmRelayerConfig, log: Log): Services {
  const { repo, near, models, clock, settings } = shared(config);
  const base = new BaseChain({ url: config.evmRpcUrl, aiOracle: config.aiOracleAddress, chainId: config.evmChainId });
  const scanner = new Scanner({ repo, base, log, settings: { ...config, cursorKey: cursorKey(config.source) } });
  const target = { kind: "evm" as const, base, settings: { ...config, evmGasLimit: EVM_GAS_LIMIT } };
  const processor = new Processor({ repo, near, models, target, clock, log, settings });
  return { repo, scanner, processor, checks: () => startupChecks({ near, base, settings: config }) };
}

function buildNear(config: NearRelayerConfig, log: Log): Services {
  const { repo, near, models, clock, settings } = shared(config);
  const scanner = new NearScanner({ repo, near, log, settings: config });
  const processor = new Processor({ repo, near, models, target: { kind: "near" }, clock, log, settings });
  return { repo, scanner, processor, checks: () => nearStartupChecks({ near, settings: config }) };
}

function build(config: RelayerConfig, log: Log): Services {
  return config.kind === "near" ? buildNear(config, log) : buildEvm(config, log);
}

async function loop(services: Services, config: RelayerConfig, log: Log, once: boolean, stop: () => boolean): Promise<void> {
  const startHead = await services.scanner.head();
  while (!stop()) {
    const started = Date.now();
    try {
      await services.scanner.catchUp();
      const summary = await services.processor.drain();
      if (summary.processed.length > 0) log.info({ ...summary, ms: Date.now() - started }, "queue pass");
      if (once && services.repo.listActive().length === 0 && services.scanner.scanned() >= startHead) return;
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "loop iteration failed");
    }
    await sleep(config.pollMs);
  }
}

function secrets(config: RelayerConfig): string[] {
  const evm = config.kind === "evm" ? [config.evmRpcUrl] : [];
  return [config.nearAiApiKey, config.nearRelayerKey, config.nearRpcUrl, config.phalaApiKey ?? "", ...evm];
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig(process.env);
  const log = createLogger(process.env.LOG_LEVEL ?? "info", undefined, secrets(config), config.source === "base" ? "psephex-relayer" : `psephex-relayer-${config.source}`);
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const releaseLock = acquireLock(`${config.dbPath}.lock`);
  let services: Services | null = null;
  let stopping = false;
  const stop = (signal: string) => {
    log.info({ signal }, "stopping after the current step");
    stopping = true;
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  try {
    services = build(config, log);
    await services.checks();
    const target = config.kind === "evm" ? { aiOracle: config.aiOracleAddress, oracle: config.oracleEvmAddress } : {};
    log.info({ source: config.source, chain: config.chain, near: config.nearOracleContract, ...target, once }, "relayer started");
    await loop(services, config, log, once, () => stopping);
  } finally {
    services?.repo.close();
    releaseLock();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${JSON.stringify({ level: "fatal", msg: err instanceof Error ? err.message : String(err) })}\n`);
  process.exit(1);
});
