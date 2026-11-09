import { Account, JsonRpcProvider, KeyPairSigner, teraToGas, type KeyPairString } from "near-api-js";

export interface CallOutcome {
  readonly txHash: string;
  readonly value: unknown;
  readonly logs: readonly string[];
}

export interface NearPort {
  view<T>(contract: string, method: string, args: object): Promise<T>;
  call(contract: string, method: string, args: object, depositYocto: bigint, gasTera: number): Promise<CallOutcome>;
  accountExists(accountId: string): Promise<boolean>;
  tx(txHash: string, sender: string): Promise<unknown>;
}

interface RawOutcome {
  readonly transaction?: { readonly hash?: string };
  readonly status?: { readonly SuccessValue?: string; readonly Failure?: unknown };
  readonly receipts_outcome?: readonly { readonly outcome?: { readonly logs?: readonly string[] } }[];
}

export function decodeOutcome(raw: unknown): CallOutcome {
  const r = raw as RawOutcome;
  if (r.status?.Failure !== undefined) throw new Error(`transaction failed: ${JSON.stringify(r.status.Failure).slice(0, 300)}`);
  const encoded = r.status?.SuccessValue ?? "";
  let value: unknown = null;
  if (encoded) {
    const text = Buffer.from(encoded, "base64").toString("utf8");
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  const logs = (r.receipts_outcome ?? []).flatMap((o) => o.outcome?.logs ?? []);
  return { txHash: r.transaction?.hash ?? "", value, logs };
}

export function createNear(rpcUrl: string, accountId: string | null, privateKey: string | null): NearPort {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = accountId && privateKey ? new Account(accountId, provider, KeyPairSigner.fromSecretKey(privateKey as KeyPairString)) : null;
  return {
    async view<T>(contract: string, method: string, args: object): Promise<T> {
      return (await provider.callFunction({ contractId: contract, method, args: { ...args } })) as T;
    },
    async call(contract, method, args, depositYocto, gasTera) {
      if (!account) throw new Error("this server is read-only: set NEAR_ACCOUNT_ID and NEAR_PRIVATE_KEY to act");
      const raw = await account.callFunctionRaw({ contractId: contract, methodName: method, args: { ...args }, deposit: depositYocto, gas: teraToGas(gasTera) });
      return decodeOutcome(raw);
    },
    async accountExists(id) {
      try {
        await provider.viewAccount({ accountId: id });
        return true;
      } catch (err) {
        if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(err))) return false;
        throw err;
      }
    },
    async tx(txHash, sender) {
      return provider.viewTransactionStatus({ txHash, accountId: sender, waitUntil: "FINAL" });
    },
  };
}
