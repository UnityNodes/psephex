import { describe, expect, it } from "vitest";
import { createLogger, createScrubber } from "../src/logger.js";

function capture(secrets: string[] = []) {
  const lines: string[] = [];
  const log = createLogger("info", { write: (line: string) => void lines.push(line) }, secrets);
  return { log, lines };
}

describe("createLogger", () => {
  it("writes JSON, redacts secret keys and serializes bigint", () => {
    const { log, lines } = capture();
    log.info({ apiKey: "sk-secret", nested: { nearRelayerKey: "ed25519:secret" }, block: 5n, list: [1n] }, "hello");
    log.warn({ requestId: 1 }, "careful");
    log.error({ requestId: 2 }, "broken");
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({ msg: "hello", apiKey: "[redacted]", nested: { nearRelayerKey: "[redacted]" }, block: "5", list: ["1"], service: "psephex-relayer" });
    expect(lines.join("")).not.toMatch(/secret/);
    expect(lines).toHaveLength(3);
  });

  it("scrubs RPC URLs and configured secrets out of error text", () => {
    const { log, lines } = capture(["https://base-sepolia.g.alchemy.com/v2/AbCdEfGhIjKl", "nearai-key-123456"]);
    const viemStyle = 'HTTP request failed.\nURL: https://base-sepolia.g.alchemy.com/v2/AbCdEfGhIjKl\nRequest body: {"method":"eth_call"}';
    log.warn({ err: viemStyle, other: new Error("fetch to https://rpc.example/?apiKey=zzz9999 failed with nearai-key-123456") }, "step failed");
    const out = lines.join("");
    expect(out).not.toMatch(/AbCdEfGhIjKl|zzz9999|nearai-key-123456/);
    expect(out).toContain("https://rpc.example/[redacted]");
    expect(out).toContain("URL: [redacted]");
  });
});

describe("createScrubber", () => {
  it("ignores very short secrets and keeps plain text", () => {
    const scrub = createScrubber(["ab", "longsecret"]);
    expect(scrub("ab longsecret plain")).toBe("ab [redacted] plain");
  });
});
