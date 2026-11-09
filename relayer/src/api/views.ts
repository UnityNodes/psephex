import { getAddress, toEventSelector } from "viem";
import type { BaseTxRow, NearTxRow } from "../db.js";
import type { SourceName } from "../sources.js";
import type { ModelAnswerRow, ModelInfo, RequestRow } from "../types.js";
import type { ApiEvmSource, ApiNearSource, ApiSource } from "./config.js";

export interface ViewSettings {
  readonly publicUrl: string;
  readonly nearNetwork: string;
  readonly nearOracleContract: string;
  readonly oracleEvmAddress: string | null;
  readonly nearAiBaseUrl: string;
}

export type SourceRef = Pick<ApiSource, "source" | "chain">;

export interface RequestBundle {
  readonly request: RequestRow;
  readonly answers: readonly ModelAnswerRow[];
  readonly nearTxs: readonly NearTxRow[];
  readonly baseTxs: readonly BaseTxRow[];
}

export interface RequestSummary {
  readonly source: SourceName;
  readonly chain: string;
  readonly id: number;
  readonly question: string;
  readonly answer: string | null;
  readonly status: string;
  readonly reason: string | null;
  readonly requester: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VerifyStep {
  readonly title: string;
  readonly command: string;
  readonly expect?: readonly string[];
}

export interface VerifyPlan {
  readonly source: SourceName;
  readonly chain: string;
  readonly requestId: number;
  readonly available: boolean;
  readonly reason: string | null;
  readonly questionHash: string;
  readonly near: {
    readonly contract: string;
    readonly method: "verify_consensus";
    readonly network: string;
    readonly args: {
      readonly chain: string;
      readonly request_id: number;
      readonly question: string;
      readonly answers: readonly { readonly model: string; readonly response_body: string; readonly signature_hex: string }[];
    };
  };
  readonly steps: readonly VerifyStep[];
}

const SUMMARY_CHARS = 160;
const SHELL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/~-]*$/;
const NEAR_TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const ATTESTATION_BASES: Readonly<Record<string, string>> = { "near-ai": "https://cloud-api.near.ai", phala: "https://api.redpill.ai" };
const GET_REQUEST_SIG = "'getRequest(uint256)((address,bytes32,bool))'";
const SETTLED_BASE_STATUSES = new Set(["success", "reverted"]);
const FULFILLED_TOPIC = toEventSelector("Fulfilled(uint256,uint8)");
const ANSWER_CODES: Readonly<Record<string, number>> = { UNKNOWN: 0, YES: 1, NO: 2 };

/**
 * /verify returns commands people paste into a terminal. Every value placed into them comes from
 * config or the chain, and is checked against a set of characters a shell never interprets, so a
 * crafted value cannot turn into command execution on the verifier's machine.
 */
export function shellToken(value: string): string {
  if (!SHELL_TOKEN.test(value)) throw new Error(`unsafe value for a shell command: ${JSON.stringify(value)}`);
  return value;
}

/**
 * Reasons mix relayer text with RPC and model error messages. Raw ESC or C1 bytes in them would
 * drive the terminal of anyone reading the JSON with jq -r, so control characters are removed.
 */
function plainText(text: string | null): string | null {
  return text === null ? null : text.replace(CONTROL_CHARS, "");
}

function hexToken(value: string, bytes: number): string {
  if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) throw new Error(`unsafe value for a shell command: expected ${bytes}-byte hex, got ${JSON.stringify(value)}`);
  return value;
}

function nearTxToken(value: string): string {
  if (!NEAR_TX_HASH.test(value)) throw new Error(`unsafe value for a shell command: expected a NEAR tx hash, got ${JSON.stringify(value)}`);
  return value;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function shorten(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= SUMMARY_CHARS) return text;
  const cut = chars.slice(0, SUMMARY_CHARS).join("");
  const space = cut.lastIndexOf(" ");
  return `${space > SUMMARY_CHARS / 2 ? cut.slice(0, space) : cut}…`;
}

function parseStored(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparsed: text };
  }
}

export function requestSummary(r: RequestRow, src: SourceRef): RequestSummary {
  return {
    source: src.source,
    chain: src.chain,
    id: r.id,
    question: shorten(r.question),
    answer: r.answer,
    status: r.status,
    reason: plainText(r.reason),
    requester: r.requester,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

/**
 * API v2 names the transaction lists nearTxs and baseTxs. The v1 names near and base stay as
 * the same arrays so dashboards built against v1 keep reading request details.
 */
export function requestDetail(input: RequestBundle & { readonly models: readonly ModelInfo[] | null; readonly source: SourceRef }) {
  const { request: r, answers, nearTxs, baseTxs, models, source } = input;
  const keys = new Map((models ?? []).map((m) => [m.model, m.publicKey]));
  const near = nearTxs.map((t) => ({
    txHash: t.txHash,
    nonce: t.nonce,
    maxFeePerGas: t.maxFee,
    maxPriorityFeePerGas: t.maxPriorityFee,
    ok: t.ok,
    result: parseStored(t.signatureJson),
    unsignedTx: t.unsignedTx,
    createdAt: iso(t.createdAt),
  }));
  const base = baseTxs.map((t) => ({ txHash: t.txHash, status: t.status, gasUsed: t.gasUsed, events: parseStored(t.eventsJson), sentAt: iso(t.sentAt) }));
  return {
    source: source.source,
    chain: source.chain,
    id: r.id,
    requester: r.requester,
    origin: r.origin,
    question: r.question,
    questionHash: r.questionHash,
    paidWei: r.paidWei,
    askedTx: r.askedTx,
    status: r.status,
    reason: plainText(r.reason),
    answer: r.answer,
    votes: parseStored(r.votesJson),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    timeToConfirmMs: r.status === "confirmed" ? r.updatedAt - r.createdAt : null,
    models: answers.map((a) => ({
      model: a.model,
      provider: a.provider,
      publicKey: keys.get(a.model) ?? null,
      requestBody: a.requestBody,
      responseBody: a.responseBody,
      chatId: a.chatId,
      signatureHex: a.signatureHex,
      signedText: a.signedText,
      attempts: a.attempts,
      latencyMs: a.latencyMs,
    })),
    nearTxs: near,
    baseTxs: base,
    near,
    base,
  };
}

/**
 * verify_consensus checks answers against the models registered on NEAR now. After the owner
 * changes the set, an older request can no longer pass that view even though its NEAR and Base
 * transactions stay valid, so the plan says so instead of handing out a command that fails.
 */
function setMismatch(b: RequestBundle, currentModels: readonly string[] | null): string | null {
  if (currentModels === null) return null;
  const answered = [...new Set(b.answers.map((a) => a.model))].sort();
  const current = [...currentModels].sort();
  const same = answered.length === current.length && answered.every((m, i) => m === current[i]);
  return same ? null : `answered by an earlier model set (${answered.join(", ")}); NEAR now checks ${currentModels.join(", ")}`;
}

function unverifiableReason(b: RequestBundle, currentModels: readonly string[] | null): string | null {
  if (b.answers.length === 0) return `no signed model answers stored; request ${b.request.status}${b.request.reason ? `: ${b.request.reason}` : ""}`;
  const unsigned = b.answers.filter((a) => !a.responseBody || !a.signatureHex).map((a) => a.model);
  if (unsigned.length > 0) return `model answers without a signature: ${unsigned.join(", ")}`;
  return setMismatch(b, currentModels);
}

function hashStep(b: RequestBundle, file: string, where: string): VerifyStep {
  return { title: `Hash the question and compare it with the hash ${where} stored`, command: `jq -j .question ${file} | cast keccak`, expect: [hexToken(b.request.questionHash.toLowerCase(), 32)] };
}

function evmSteps(b: RequestBundle, s: ViewSettings, src: ApiEvmSource, file: string): VerifyStep[] {
  const id = shellToken(String(b.request.id));
  const rpc = shellToken(src.publicRpcUrl);
  const network = shellToken(s.nearNetwork);
  const hash = hexToken(b.request.questionHash.toLowerCase(), 32);
  const steps: VerifyStep[] = [
    hashStep(b, file, src.name),
    { title: `Read the request on ${src.name}: requester, question hash, fulfilled`, command: `cast call ${hexToken(src.aiOracleAddress, 20)} ${GET_REQUEST_SIG} ${id} --rpc-url ${rpc}`, expect: [hash] },
  ];
  for (const tx of b.nearTxs.filter((t) => t.ok === true)) {
    steps.push({ title: "Inspect the NEAR transaction that checked 2 of 3 and asked MPC to sign", command: `near transaction view-status ${nearTxToken(tx.txHash)} network-config ${network}` });
  }
  for (const tx of b.baseTxs.filter((t) => SETTLED_BASE_STATUSES.has(t.status))) {
    const txHash = hexToken(tx.txHash, 32);
    steps.push({ title: `Check the ${src.name} transaction that delivered the answer`, command: `cast receipt ${txHash} --rpc-url ${rpc}`, expect: [tx.status === "success" ? "1 (success)" : "0 (failed)"] });
    if (s.oracleEvmAddress !== null) {
      steps.push({ title: "Check it was sent from the MPC-derived oracle address", command: `cast tx ${txHash} from --rpc-url ${rpc}`, expect: [getAddress(s.oracleEvmAddress)] });
    }
    const answerCode = b.request.answer === null ? undefined : ANSWER_CODES[b.request.answer];
    if (tx.status === "success" && answerCode !== undefined) {
      const oracle = hexToken(src.aiOracleAddress.toLowerCase(), 20);
      const filter = `'.logs[] | select((.address | ascii_downcase) == "${oracle}" and .topics[0] == "${FULFILLED_TOPIC}") | .data'`;
      steps.push({
        title: "Read the answer code AiOracle emitted in Fulfilled (0 UNKNOWN, 1 YES, 2 NO)",
        command: `cast receipt ${txHash} --json --rpc-url ${rpc} | jq -r ${filter} | cast to-dec | sed 's/^/answer code /'`,
        expect: [`answer code ${answerCode}`],
      });
    }
  }
  return steps;
}

function nearSteps(b: RequestBundle, s: ViewSettings, src: ApiNearSource, file: string): VerifyStep[] {
  const id = shellToken(String(b.request.id));
  const contract = shellToken(s.nearOracleContract);
  const network = shellToken(s.nearNetwork);
  const hash = hexToken(b.request.questionHash.toLowerCase(), 32);
  const stored = b.request.status === "confirmed" && b.request.answer ? [`"answer": "${b.request.answer}"`] : [];
  const steps: VerifyStep[] = [
    hashStep(b, file, src.name),
    {
      title: "Read the request and the stored verdict on the NEAR contract",
      command: `near contract call-function as-read-only ${contract} near_request json-args '{"request_id":${id}}' network-config ${network} now`,
      expect: [`"question_hash": "${hash}"`, ...stored],
    },
  ];
  for (const tx of b.nearTxs.filter((t) => t.ok === true)) {
    steps.push({ title: "Inspect the fulfill_on_near transaction that checked 2 of 3 and stored the verdict", command: `near transaction view-status ${nearTxToken(tx.txHash)} network-config ${network}` });
  }
  return steps;
}

export function verifyPlan(b: RequestBundle, s: ViewSettings, src: ApiSource, currentModels: readonly string[] | null = null): VerifyPlan {
  const id = shellToken(String(b.request.id));
  const source = shellToken(src.source);
  const file = `psephex-${source}-${id}.json`;
  const reason = unverifiableReason(b, currentModels);
  const contract = shellToken(s.nearOracleContract);
  const network = shellToken(s.nearNetwork);
  const download: VerifyStep = {
    title: "Download the exact arguments the oracle used",
    command: `curl -s '${shellToken(s.publicUrl)}/requests/${source}/${id}/verify' | jq '.data.near.args' > ${file}`,
  };
  const consensus: VerifyStep = {
    title: "Re-run the signature and 2-of-3 check on the NEAR contract",
    command: `near contract call-function as-read-only ${contract} verify_consensus file-args ${file} network-config ${network} now`,
    expect: [`"ok": true`, ...(b.request.answer ? [`"answer": "${b.request.answer}"`] : [])],
  };
  const chainSteps = src.kind === "near" ? nearSteps(b, s, src, file) : evmSteps(b, s, src, file);
  return {
    source: src.source,
    chain: src.chain,
    requestId: b.request.id,
    available: reason === null,
    reason: plainText(reason),
    questionHash: b.request.questionHash,
    near: {
      contract: s.nearOracleContract,
      method: "verify_consensus",
      network: s.nearNetwork,
      args: {
        chain: src.chain,
        request_id: b.request.id,
        question: b.request.question,
        answers: b.answers.map((a) => ({ model: a.model, response_body: a.responseBody ?? "", signature_hex: a.signatureHex ?? "" })),
      },
    },
    steps: [download, ...(reason === null ? [consensus] : []), ...chainSteps],
  };
}

export function chainsView(sources: readonly ApiSource[], s: Pick<ViewSettings, "oracleEvmAddress" | "nearOracleContract">, nearFeeYocto: bigint | null) {
  return sources.map((src) =>
    src.kind === "evm"
      ? {
          source: src.source,
          chain: src.chain,
          name: src.name,
          kind: src.kind,
          explorer: src.explorer,
          aiOracle: src.aiOracleAddress,
          ...(src.dispute === null ? {} : { dispute: src.dispute }),
          ...(s.oracleEvmAddress === null ? {} : { oracleAddress: s.oracleEvmAddress }),
        }
      : {
          source: src.source,
          chain: src.chain,
          name: src.name,
          kind: src.kind,
          explorer: src.explorer,
          aiOracle: s.nearOracleContract,
          ...(src.dispute === null ? {} : { dispute: src.dispute }),
          nearFee: nearFeeYocto === null ? null : nearFeeYocto.toString(),
        },
  );
}

export function modelsView(models: readonly ModelInfo[], s: Pick<ViewSettings, "nearAiBaseUrl">) {
  return models.map((m) => ({
    model: m.model,
    provider: m.provider,
    scheme: m.scheme,
    publicKey: m.publicKey,
    attestation: ATTESTATION_BASES[m.provider]
      ? {
          url: `${m.provider === "near-ai" ? s.nearAiBaseUrl : ATTESTATION_BASES[m.provider]}/v1/attestation/report?model=${encodeURIComponent(m.model)}&signing_algo=ed25519&nonce=`,
          howTo: "The link adds a fresh random nonce, shown below. Check that the TDX quote report_data holds this public key followed by that nonce.",
        }
      : null,
  }));
}
