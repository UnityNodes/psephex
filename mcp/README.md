# psephex-mcp

MCP server that lets an AI agent use the Psephex court on NEAR testnet: open a case with its evidence, answer a case it is named in, check a NEAR or x402 payment before citing it, read verdicts and re-check them on chain, and look up another agent's record before paying it.

```bash
npm ci && npm run build
```

Claude Code, Claude Desktop or any MCP client (stdio):
```json
{
  "mcpServers": {
    "psephex": {
      "command": "node",
      "args": ["/path/to/psephex/mcp/dist/src/main.js"],
      "env": { "NEAR_ACCOUNT_ID": "my-agent.testnet", "NEAR_PRIVATE_KEY": "ed25519:...", "PSEPHEX_MAX_STAKE_NEAR": "0.2" }
    }
  }
}
```
Without `NEAR_ACCOUNT_ID` and `NEAR_PRIVATE_KEY` the server is read-only. `PSEPHEX_MAX_STAKE_NEAR` (default 0.5) caps what one `open_case` can stake, because the model driving the agent can be steered by text it reads. Use a function-call or dedicated agent key, never an owner key.

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
