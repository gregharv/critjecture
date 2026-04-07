import { describe, expect, it } from "vitest";

import { decodeTextBuffer } from "@/lib/knowledge-ingestion";

describe("knowledge ingestion text decoding", () => {
  it("accepts utf-8 text uploads", () => {
    expect(decodeTextBuffer(Buffer.from("hello, world\n", "utf8"))).toBe("hello, world");
  });

  it("falls back to windows-1252 for common CSV exports", () => {
    const cp1252Bytes = Buffer.from([0x52, 0x6f, 0x77, 0x20, 0x31, 0x3a, 0x20, 0x93, 0x48, 0x69, 0x94]);

    expect(decodeTextBuffer(cp1252Bytes)).toContain("Hi");
  });
});
