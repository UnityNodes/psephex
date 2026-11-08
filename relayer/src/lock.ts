import { openSync, readFileSync, unlinkSync, writeSync, closeSync } from "node:fs";

export type PidAlive = (pid: number) => boolean;

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryCreate(path: string, pid: number): boolean {
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, String(pid));
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/**
 * Two relayer processes on one database would both sign the same request with the same
 * EVM nonce. The lock file holds the owner pid; a lock left by a dead process is taken over.
 */
export function acquireLock(path: string, pid: number = process.pid, alive: PidAlive = processAlive): () => void {
  if (!tryCreate(path, pid)) {
    const holder = Number(readFileSync(path, "utf8").trim());
    if (Number.isInteger(holder) && holder > 0 && alive(holder)) throw new Error(`another relayer (pid ${holder}) holds ${path}`);
    unlinkSync(path);
    if (!tryCreate(path, pid)) throw new Error(`could not take over the stale lock ${path}`);
  }
  return () => unlinkSync(path);
}
