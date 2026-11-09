export const SOURCES = ["near", "base", "arbitrum"] as const;

export type Source = (typeof SOURCES)[number];
export type EvmSource = Exclude<Source, "near">;

export const CAIP2: Readonly<Record<Source, string>> = { near: "near:testnet", base: "eip155:84532", arbitrum: "eip155:421614" };
export const SOURCE_NAME: Readonly<Record<Source, string>> = { near: "NEAR testnet", base: "Base Sepolia", arbitrum: "Arbitrum Sepolia" };
export const SOURCE_SHORT: Readonly<Record<Source, string>> = { near: "NEAR", base: "Base", arbitrum: "Arbitrum" };

export function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

export const EXPLORER_NAME: Readonly<Record<Source, string>> = { near: "Nearblocks", base: "Basescan", arbitrum: "Arbiscan" };
