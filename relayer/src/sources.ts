export const SOURCE_NAMES = ["base", "arbitrum", "near"] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];

export type SourceKind = "evm" | "near";

export interface SourceInfo {
  readonly kind: SourceKind;
  readonly name: string;
  readonly short: string;
  readonly explorer: string;
  readonly defaultChainId?: number;
  readonly publicRpcUrl?: string;
}

export const SOURCES: Readonly<Record<SourceName, SourceInfo>> = {
  base: { kind: "evm", name: "Base Sepolia", short: "Base", explorer: "https://sepolia.basescan.org", defaultChainId: 84532, publicRpcUrl: "https://sepolia.base.org" },
  arbitrum: {
    kind: "evm",
    name: "Arbitrum Sepolia",
    short: "Arbitrum",
    explorer: "https://sepolia.arbiscan.io",
    defaultChainId: 421614,
    publicRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  near: { kind: "near", name: "NEAR testnet", short: "NEAR", explorer: "https://testnet.nearblocks.io" },
};

export const NEAR_TESTNET_CHAIN = "near:testnet";

export function isSourceName(value: string): value is SourceName {
  return (SOURCE_NAMES as readonly string[]).includes(value);
}

export function evmChainKey(chainId: number): string {
  return `eip155:${chainId}`;
}

export function sourceRank(source: SourceName): number {
  return SOURCE_NAMES.indexOf(source);
}

/**
 * Each source keeps its own database. The cursor row is named after the source, so a database
 * opened by the wrong process or listed under the wrong source in the API is caught instead of
 * being scanned or served as another chain's history.
 */
export function cursorKey(source: SourceName): string {
  return source;
}
