import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { WagmiProvider } from "wagmi";
import { App } from "./App.js";
import "./index.css";
import { wagmiConfig } from "./wagmi.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } });
const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
