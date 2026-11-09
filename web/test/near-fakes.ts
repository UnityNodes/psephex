import { vi } from "vitest";
import type { NearRpc, NearTxResult } from "../src/near/rpc.js";
import type { NearWallet } from "../src/near/wallet.js";

export function fakeNearWallet(over: Partial<NearWallet> = {}): NearWallet {
  return {
    status: "ready",
    accountId: null,
    prepare: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    call: vi.fn(async () => "8kQ5dRw2kCzJYZ3XUjbYRLVhP8nHkDqzxBGh9qGJxR1q"),
    ...over,
  };
}

export function fakeNearRpc(views: Readonly<Record<string, unknown>>, tx: NearTxResult = { ok: true, value: 4 }): NearRpc & { view: ReturnType<typeof vi.fn> } {
  const view = vi.fn(async (contract: string, method: string) => {
    const key = `${contract}.${method}`;
    if (!(key in views)) throw new Error(`no fake for ${key}`);
    return views[key];
  });
  return { view, txResult: vi.fn(async () => tx) } as unknown as NearRpc & { view: ReturnType<typeof vi.fn> };
}
