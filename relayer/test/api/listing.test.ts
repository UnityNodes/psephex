import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/api/listing.js";

const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("page cursor", () => {
  it("round-trips the position of the last record", () => {
    const c = { createdAt: 1_762_603_200_000, source: "near" as const, id: 12 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("rejects anything the API did not issue", () => {
    for (const bad of [enc({ t: 1 }), enc([1, "near"]), enc([-1, "near", 1]), enc([1.5, "near", 1]), enc([1, "solana", 1]), enc([1, "base", 0]), enc([1, "base", "1"]), "not json"]) {
      expect(decodeCursor(bad), bad).toBeNull();
    }
  });
});
