import { Buffer } from "buffer";

/**
 * The HERE wallet SDK imports Node's `crypto` for `randomBytes`, the nonce of a NEP-413 sign-in.
 * Browsers have no such module, so the bundler's empty stub made HERE fail with "randomBytes is
 * not a function". This module stands in for `crypto` in browser builds and draws the bytes from
 * Web Crypto, the same source Node uses.
 */
export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export default { randomBytes };
