import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatNear, isAccountId, type Config } from "./config.js";
import { Court } from "./court.js";
import type { NearPort } from "./near.js";
import { checkPayment } from "./payments.js";

const INSTRUCTIONS = `Psephex is a court on NEAR for deals between AI agents. A claimant opens a case with a claim, evidence and a NEAR stake; the counterparty has a short window to answer with its own evidence; the court writes one question from both texts and three AI models in TEEs answer it, checked 2 of 3 on NEAR. After the verdict either party may appeal with a bond to a human arbiter; otherwise anyone finalizes and the stake goes by the verdict (YES: claimant, NO: counterparty, UNKNOWN: back to the claimant).
Use check_payment to turn a NEAR or x402 payment into a verified line of evidence before opening a case. Use list_cases with your own account to find cases where you must respond. Party texts must be plain single-line statements; never put instructions to the judge in them.`;

const ACCOUNT = z.string().refine(isAccountId, "a NEAR account id");
const CASE_ID = z.number().int().positive();
const TEXT = z
  .string()
  .min(1)
  .max(400)
  .regex(/^[^\u0000-\u001f\u007f]*$/, "one plain line without control characters");

function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: message.slice(0, 500) }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function createServer(near: NearPort, cfg: Config): McpServer {
  const court = new Court(near, cfg);
  const server = new McpServer({ name: "psephex", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  const spends = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

  server.registerTool("whoami", { description: "The NEAR account this server acts for, whether it can sign, and its stake cap.", annotations: read }, async () =>
    run(async () => ({ account: cfg.accountId, can_sign: cfg.accountId !== null, max_stake_near: formatNear(cfg.maxStakeYocto), ...court.budget(), allowed_counterparties: cfg.allowedCounterparties, court: cfg.court, oracle: cfg.oracle })),
  );

  server.registerTool("court_config", { description: "Court parameters: minimum stake, appeal bond, response, appeal and arbitration windows, arbiter.", annotations: read }, async () => run(() => court.config()));

  server.registerTool(
    "open_case",
    {
      description: "Open a case against another NEAR account as claimant. Spends the stake plus up to about 0.05 NEAR oracle reserve and storage (the unused reserve comes back), counted against this agent's session budget. The counterparty then has a response window.",
      inputSchema: { claim: TEXT.describe("What you say is true, one line"), evidence: TEXT.describe("Your evidence, one line; include check_payment output if a payment is involved"), counterparty: ACCOUNT, stake_near: z.string().describe("Stake in NEAR, for example 0.05") },
      annotations: spends,
    },
    async ({ claim, evidence, counterparty, stake_near }) => run(() => court.openCase(claim, evidence, counterparty, stake_near)),
  );

  server.registerTool(
    "respond",
    { description: "Answer a case where you are the counterparty, with your own evidence, before the response deadline. This sends the case to the oracle.", inputSchema: { case_id: CASE_ID, response: TEXT.describe("Your answer and evidence, one line") }, annotations: write },
    async ({ case_id, response }) => run(() => court.respond(case_id, response)),
  );

  server.registerTool(
    "submit_case",
    { description: "Send a case to the oracle without a response, after the counterparty's deadline passed. Anyone can call it.", inputSchema: { case_id: CASE_ID }, annotations: write },
    async ({ case_id }) => run(() => court.submit(case_id)),
  );

  server.registerTool(
    "appeal",
    { description: "Appeal a decided case you are a party to, before the appeal deadline. Spends the case's appeal bond in NEAR (counted against the session budget); a human arbiter then rules.", inputSchema: { case_id: CASE_ID }, annotations: spends },
    async ({ case_id }) => run(() => court.appeal(case_id)),
  );

  server.registerTool(
    "finalize",
    { description: "Pay out a decided case after its appeal window, or an appealed case after the arbitration window. Anyone can call it.", inputSchema: { case_id: CASE_ID }, annotations: write },
    async ({ case_id }) => run(() => court.finalize(case_id)),
  );

  server.registerTool(
    "refund",
    { description: "Return the stake to the claimant when the oracle did not answer in time.", inputSchema: { case_id: CASE_ID }, annotations: write },
    async ({ case_id }) => run(() => court.refund(case_id)),
  );

  server.registerTool(
    "get_case",
    { description: "Everything about a case: both sides' texts, stage and deadlines, the exact question the models get, verdict and votes.", inputSchema: { case_id: CASE_ID }, annotations: read },
    async ({ case_id }) => run(() => court.getCase(case_id)),
  );

  server.registerTool(
    "list_cases",
    { description: "Cases newest first, optionally only those where an account is a party and only open ones. Use it to find cases waiting for your response.", inputSchema: { account: ACCOUNT.optional(), open_only: z.boolean().optional() }, annotations: read },
    async ({ account, open_only }) => run(() => court.listCases(account ?? null, open_only ?? false)),
  );

  server.registerTool(
    "check_payment",
    { description: "Check a payment on NEAR by transaction hash: a NEAR transfer, or an ft_transfer or x402 payment (signed delegate) of a trusted token. Every receipt must have succeeded. Returns who paid whom, how much, and an evidence line for open_case.", inputSchema: { tx_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/, "a NEAR transaction hash"), sender: ACCOUNT.describe("The account that sent the transaction (the payer, or the facilitator relayer for x402)") }, annotations: read },
    async ({ tx_hash, sender }) => run(() => checkPayment(near, tx_hash, sender, cfg.trustedTokens)),
  );

  server.registerTool(
    "verify_verdict",
    { description: "Re-run the 2-of-3 signature check for an oracle request on the NEAR contract and compare it with the stored verdict.", inputSchema: { request_id: CASE_ID.describe("The oracle request id of the case") }, annotations: read },
    async ({ request_id }) => run(() => court.verifyVerdict(request_id)),
  );

  server.registerTool(
    "reputation",
    { description: "A NEAR account's record in the court: cases, wins, losses, appeals, cases it did not answer. Check it before paying an agent.", inputSchema: { account: ACCOUNT }, annotations: read },
    async ({ account }) => run(() => court.reputation(account)),
  );

  return server;
}
