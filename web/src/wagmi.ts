import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { ARBITRUM_RPC_URL, BASE_RPC_URL } from "./deployment.js";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, arbitrumSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http(BASE_RPC_URL), [arbitrumSepolia.id]: http(ARBITRUM_RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
