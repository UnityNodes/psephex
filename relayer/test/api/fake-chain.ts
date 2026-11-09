import type { ChainSnapshot, ChainStatus, Sample, SourceHead } from "../../src/api/chain.js";
import type { ReadStore } from "../../src/api/store.js";
import type { SourceName } from "../../src/sources.js";
import type { ModelInfo } from "../../src/types.js";
import { MODELS, T0 } from "./fixture.js";

export class FakeChain implements ChainStatus {
  base: Sample<SourceHead> = { ok: true, value: { head: 300n, oracleBalanceWei: 15n * 10n ** 15n }, at: T0, stale: false };
  arbitrum: Sample<SourceHead> = { ok: true, value: { head: 1_000n, oracleBalanceWei: 2n * 10n ** 15n }, at: T0, stale: false };
  nearHead: Sample<SourceHead> = { ok: true, value: { head: 3n, oracleBalanceWei: null }, at: T0, stale: false };
  near: ChainSnapshot["near"] = { ok: true, value: { relayerBalanceYocto: 4n * 10n ** 24n }, at: T0, stale: false };
  modelList: Sample<readonly ModelInfo[]> = { ok: true, value: MODELS, at: T0, stale: false };
  fee: Sample<bigint> = { ok: true, value: 10n ** 22n, at: T0, stale: false };
  async snapshot(): Promise<ChainSnapshot> {
    return { sources: { base: this.base, arbitrum: this.arbitrum, near: this.nearHead }, near: this.near };
  }
  async models(): Promise<Sample<readonly ModelInfo[]>> {
    return this.modelList;
  }
  async nearFee(): Promise<Sample<bigint>> {
    return this.fee;
  }
}

export function storeMap(entries: readonly (readonly [SourceName, ReadStore])[]): Map<SourceName, ReadStore> {
  return new Map(entries);
}
