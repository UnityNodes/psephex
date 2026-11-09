import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { BASE_RPC_URL, CHAIN } from "./deployment.js";

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: { [CHAIN.id]: http(BASE_RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
