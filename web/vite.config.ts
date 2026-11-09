import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin, type PluginOption } from "vite";
import { defineConfig } from "vitest/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEFAULT_RPC = "https://sepolia.base.org";
const DEFAULT_ARBITRUM_RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const DEFAULT_NEAR_RPC = "https://rpc.testnet.near.org";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

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

const FONTS = ["CabinetGrotesk-Variable.woff2", "Satoshi-Variable.woff2"];

/**
 * The Fontshare license forbids putting the font files in a public repository, so they are
 * fetched by scripts/fetch-fonts.sh and ignored by git. A build without them would ship a page
 * that silently falls back to system fonts, so it stops instead.
 */
function requireFonts(): void {
  const missing = FONTS.filter((f) => !existsSync(fileURLToPath(new URL(`./public/fonts/${f}`, import.meta.url))));
  if (missing.length > 0) throw new Error(`missing fonts ${missing.join(", ")}: run scripts/fetch-fonts.sh first`);
}

/**
 * Radix dialogs lock page scroll by inserting a <style> tag, which a strict style-src blocks, so the
 * page behind an open dialog kept scrolling. The tag carries this per-build nonce. It is public in
 * the bundle, so it only admits styles, never scripts, which stay limited to 'self'.
 */
const STYLE_NONCE = randomBytes(16).toString("base64url");

/**
 * The page talks to the API and to the RPC of each chain it reads, and to nothing else. The
 * MyNearWallet login and signing run in a separate window on its own origin and talk back by
 * postMessage, so the wallet needs no entry here. Arbitrum is listed only when its contracts are
 * configured, because a build without them never reads that chain.
 */
function connectOrigins(env: Record<string, string>): string[] {
  const origins = [requireApiUrl(env.VITE_API_URL), new URL(env.VITE_BASE_RPC_URL || DEFAULT_RPC).origin, new URL(env.VITE_NEAR_RPC_URL || DEFAULT_NEAR_RPC).origin];
  const arbitrum = EVM_ADDRESS.test(env.VITE_ARBITRUM_AI_ORACLE ?? "") && EVM_ADDRESS.test(env.VITE_ARBITRUM_DISPUTE ?? "");
  if (arbitrum) origins.push(new URL(env.VITE_ARBITRUM_RPC_URL || DEFAULT_ARBITRUM_RPC).origin);
  return [...new Set(origins)];
}

function contentSecurityPolicy(origins: readonly string[]): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${STYLE_NONCE}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${origins.join(" ")}`,
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
  if (command === "build") requireFonts();
  if (command === "build") plugins.push(contentSecurityPolicy(connectOrigins(env)));
  return {
    plugins,
    define: { __STYLE_NONCE__: JSON.stringify(command === "build" ? STYLE_NONCE : "") },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: { target: "es2022", sourcemap: false },
    server: { fs: { allow: [".", "../contracts/base/src/examples"] } },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/main.tsx", "src/abi.ts", "src/vite-env.d.ts", "src/wagmi.ts", "src/near/selector.ts"],
        thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  };
});
