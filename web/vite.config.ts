import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type PluginOption } from "vite";
import { defineConfig } from "vitest/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEFAULT_RPC = "https://sepolia.base.org";

/**
 * A production bundle that silently falls back to a localhost API looks fine in review and breaks
 * for every visitor, so a build refuses to run without an explicit https API address.
 */
function requireApiUrl(raw: string | undefined): string {
  if (!raw) throw new Error("VITE_API_URL is required for a build, for example https://api.psephex.example");
  const url = new URL(raw);
  if (url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) throw new Error("VITE_API_URL must use https outside localhost");
  return url.origin;
}

function contentSecurityPolicy(apiOrigin: string, rpcOrigin: string): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin} ${rpcOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "psephex-csp",
    apply: "build",
    transformIndexHtml: (html) => html.replace("<meta charset=\"UTF-8\" />", `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (command === "build") plugins.push(contentSecurityPolicy(requireApiUrl(env.VITE_API_URL), new URL(env.VITE_BASE_RPC_URL || DEFAULT_RPC).origin));
  return {
    plugins,
    build: { target: "es2022", sourcemap: false },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/main.tsx", "src/abi.ts", "src/vite-env.d.ts", "src/wagmi.ts"],
        thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  };
});
