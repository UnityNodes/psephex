import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE = resolve(process.cwd(), "../docs/evidence/runs/stage5-api-merged");

export function evidence(name: string): unknown {
  return JSON.parse(readFileSync(resolve(EVIDENCE, name), "utf8"));
}

export function dataOf(name: string): Record<string, unknown> {
  return (evidence(name) as { data: Record<string, unknown> }).data;
}

export const CLAIMANT = "0x876004318B1Fb54BcE2e5a486b00713F9278D4AF";
export const COUNTERPARTY = "0xBc94d3C1F9599Fbe3D6f4DCa5aAD679d2C504799";
