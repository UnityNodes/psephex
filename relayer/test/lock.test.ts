import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";

describe("acquireLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "psephex-lock-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the pid and releases the lock", () => {
    const path = join(dir, "relayer.lock");
    const release = acquireLock(path, 4242, () => false);
    expect(readFileSync(path, "utf8")).toBe("4242");
    release();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses while another live process holds the lock", () => {
    const path = join(dir, "relayer.lock");
    writeFileSync(path, "999");
    expect(() => acquireLock(path, 4242, (pid) => pid === 999)).toThrow(/pid 999/);
  });

  it("takes over a stale lock from a dead process", () => {
    const path = join(dir, "relayer.lock");
    writeFileSync(path, "999");
    const release = acquireLock(path, 4242, () => false);
    expect(readFileSync(path, "utf8")).toBe("4242");
    release();
  });
});
