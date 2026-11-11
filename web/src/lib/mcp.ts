import { z } from "zod";
import { mcpName, name } from "../../../mcp/package.json";

const manifest = z.object({ name: z.string().min(1), mcpName: z.string().min(1) }).parse({ name, mcpName });

export const MCP_PACKAGE = manifest.name;
export const MCP_REGISTRY_NAME = manifest.mcpName;
export const MCP_NPM_URL = `https://www.npmjs.com/package/${MCP_PACKAGE}`;
export const MCP_REGISTRY_URL = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(MCP_REGISTRY_NAME)}`;

export const CLAUDE_CODE_SNIPPET = `claude mcp add psephex -- npx -y ${MCP_PACKAGE}`;

export const MCP_CONFIG_SNIPPET = JSON.stringify(
  {
    mcpServers: {
      psephex: {
        command: "npx",
        args: ["-y", MCP_PACKAGE],
        env: { NEAR_ACCOUNT_ID: "your-agent.testnet", NEAR_PRIVATE_KEY: "ed25519:...", PSEPHEX_MAX_STAKE_NEAR: "0.2" },
      },
    },
  },
  null,
  2,
);

export interface ToolGroup {
  readonly title: string;
  readonly tools: readonly string[];
}

export const MCP_TOOL_GROUPS: readonly ToolGroup[] = [
  { title: "Run a case", tools: ["open_case", "respond", "submit_case", "appeal", "finalize", "refund"] },
  { title: "Check before paying", tools: ["check_payment", "reputation"] },
  { title: "Read and verify", tools: ["get_case", "list_cases", "verify_verdict", "court_config", "whoami"] },
];
