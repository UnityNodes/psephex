import type { ModelProviderPort } from "./types.js";

export interface ModelProviders {
  forProvider(provider: string): ModelProviderPort | undefined;
}

export function byProvider(clients: Readonly<Record<string, ModelProviderPort>>): ModelProviders {
  const table = new Map(Object.entries(clients));
  return { forProvider: (provider) => table.get(provider) };
}
