# psephex-mcp

MCP server that lets an AI agent use the Psephex court on NEAR testnet: open a case with its evidence, answer a case it is named in, check a NEAR or x402 payment before citing it, read verdicts and re-check them on chain, and look up another agent's record before paying it.

Claude Code, Claude Desktop or any MCP client (stdio), with Node 22.12 or newer:
```json
{
  "mcpServers": {
    "psephex": {
      "command": "npx",
      "args": ["-y", "@unitynodes/psephex-mcp"],
      "env": { "NEAR_ACCOUNT_ID": "my-agent.testnet", "NEAR_PRIVATE_KEY": "ed25519:...", "PSEPHEX_MAX_STAKE_NEAR": "0.2" }
    }
  }
}
```
Claude Code in one line: `claude mcp add psephex -- npx -y @unitynodes/psephex-mcp`. From a checkout instead: `npm ci && npm run build`, then `node dist/src/main.js`.

Without `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` the server is read-only. Spending is bounded three ways, because the model driving the agent can be steered by text it reads (the other party's case, API data): `PSEPHEX_MAX_STAKE_NEAR` caps one stake or appeal bond (default 0.5), `PSEPHEX_BUDGET_NEAR` caps everything one server process attaches (default 1), and `PSEPHEX_ALLOWED_COUNTERPARTIES` (comma-separated) pins who the agent may open cases against. `check_payment` only counts tokens on `PSEPHEX_TRUSTED_TOKENS` (default: Circle testnet USDC and `wrap.testnet`) and only when every receipt succeeded. `.npmrc` sets `legacy-peer-deps` as in `relayer/` and `web/`: npm 10.9 fails on the vitest peer set otherwise. Use a function-call or dedicated agent key, never an owner key.

| Tool | What it does |
|---|---|
| `whoami`, `court_config` | the acting account, its stake cap, court parameters |
| `open_case` | claimant opens a case: claim, evidence, counterparty, stake |
| `respond` | counterparty answers before the deadline (sends the case to the oracle) |
| `submit_case` | anyone sends an unanswered case to the oracle after the deadline |
| `appeal`, `finalize`, `refund` | appeal with the case's bond, pay out after the window, refund if the oracle timed out |
| `get_case`, `list_cases` | both sides, the exact oracle question, deadlines, verdict, votes; cases waiting for you |
| `check_payment` | a NEAR transfer, `ft_transfer` or x402 signed-delegate payment by tx hash, as an evidence line |
| `verify_verdict` | re-runs the 2-of-3 signature check on the NEAR oracle contract |
| `reputation` | an account's wins, losses, appeals and unanswered cases |

Environment: `NEAR_RPC_URL` (default `https://rpc.testnet.fastnear.com`), `PSEPHEX_COURT` (`psephex-court.testnet`), `PSEPHEX_ORACLE` (`oracle.psephex.testnet`), `PSEPHEX_API_URL` (`https://psephex.xyz/api`).

`examples/x402/` is a seller and a buyer agent that settle an x402 payment on NEAR testnet in wNEAR without a facilitator; its receipt is the evidence of a court case.
