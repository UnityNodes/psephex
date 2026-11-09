import type { CallOutcome, NearPort } from "../src/near.js";

export class FakeNear implements NearPort {
  views = new Map<string, unknown>();
  calls: { contract: string; method: string; args: object; deposit: bigint; gas: number }[] = [];
  accounts = new Set<string>(["bob.testnet", "alice.testnet"]);
  txs = new Map<string, unknown>();
  callResult: CallOutcome = { txHash: "HASH", value: 1, logs: [] };

  async view<T>(contract: string, method: string, args: object): Promise<T> {
    const key = `${contract}.${method}`;
    const v = this.views.get(`${key}:${JSON.stringify(args)}`) ?? this.views.get(key);
    if (v === undefined) throw new Error(`no fake view ${key}`);
    return (typeof v === "function" ? (v as (a: object) => unknown)(args) : v) as T;
  }

  async call(contract: string, method: string, args: object, deposit: bigint, gas: number): Promise<CallOutcome> {
    this.calls.push({ contract, method, args, deposit, gas });
    return this.callResult;
  }

  async accountExists(id: string): Promise<boolean> {
    return this.accounts.has(id);
  }

  async tx(hash: string): Promise<unknown> {
    const t = this.txs.get(hash);
    if (!t) throw new Error("unknown transaction");
    return t;
  }
}
