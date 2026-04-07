import { describe, expect, it } from "vitest";

import { getAuthenticatedUserByEmail } from "@/lib/users";
import { decodeTextBuffer, normalizeCsvLineEndings } from "@/lib/knowledge-ingestion";
import { uploadKnowledgeFile } from "@/lib/knowledge-files";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

describe("knowledge ingestion text decoding", () => {
  it("accepts utf-8 text uploads", () => {
    expect(decodeTextBuffer(Buffer.from("hello, world\n", "utf8"))).toBe("hello, world");
  });

  it("falls back to windows-1252 for common csv exports", () => {
    const cp1252Bytes = Buffer.from([0x52, 0x6f, 0x77, 0x20, 0x31, 0x3a, 0x20, 0x93, 0x48, 0x69, 0x94]);

    expect(decodeTextBuffer(cp1252Bytes)).toContain("Hi");
  });

  it("normalizes carriage-return and mixed CSV line endings", () => {
    const crOnly = Buffer.from("a,b\r1,2\r3,4\r", "utf8");
    const mixed = Buffer.from("a,b\r\n1,2\r3,4\n", "utf8");

    expect(normalizeCsvLineEndings(crOnly).toString("utf8")).toBe("a,b\n1,2\n3,4\n");
    expect(normalizeCsvLineEndings(mixed).toString("utf8")).toBe("a,b\n1,2\n3,4\n");
  });

  it("marks a csv upload ready after chunk indexing", async () => {
    const env = await createTestAppEnvironment({ organizationSlug: "critjecture-test-org" });

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const uploaded = await uploadKnowledgeFile({
        file: new File([
          "ledger_year,contractor,payout\n2026,Acme,1200\n2026,Beacon,900\n",
        ], "contractors.csv", { type: "text/csv" }),
        requestedScope: "public",
        user: owner!,
      });

      expect(uploaded.ingestionStatus).toBe("ready");
      expect(uploaded.ingestionError).toBeNull();
      expect(uploaded.sourcePath).toContain("public/uploads/");
    } finally {
      await env.cleanup();
    }
  });
});
