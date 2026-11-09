/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BASE_RPC_URL?: string;
  readonly VITE_ARBITRUM_RPC_URL?: string;
  readonly VITE_ARBITRUM_AI_ORACLE?: string;
  readonly VITE_ARBITRUM_DISPUTE?: string;
  readonly VITE_NEAR_RPC_URL?: string;
  readonly VITE_NEAR_COURT_CONTRACT?: string;
  readonly VITE_REPO_URL?: string;
  readonly VITE_VIDEO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare const __STYLE_NONCE__: string;
