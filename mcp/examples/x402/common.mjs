import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

export const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
export const ASSET = process.env.X402_ASSET ?? "wrap.testnet";
export const NETWORK = "near:testnet";

export function account(accountId) {
  const keyFile = process.env.KEY_FILE ?? `${process.env.HOME}/.near-credentials/testnet/${accountId}.json`;
  const key = JSON.parse(readFileSync(keyFile, "utf8")).private_key;
  return new Account(accountId, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(key));
}

export function b64json(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

export function unb64json(text) {
  return JSON.parse(Buffer.from(text, "base64").toString("utf8"));
}
