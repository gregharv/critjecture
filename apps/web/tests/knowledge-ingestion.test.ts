import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import { dataAssets, dataAssetVersions, dataConnections } from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { ensureFilesystemAssetVersion } from "@/lib/data-assets";
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

  it("marks a csv upload ready after chunk indexing and registers an asset version", async () => {
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

      const db = await getAppDatabase();
      const asset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.externalObjectId, uploaded.id),
      });
      const version = asset?.activeVersionId
        ? await db.query.dataAssetVersions.findFirst({
            where: eq(dataAssetVersions.id, asset.activeVersionId),
          })
        : null;
      const connection = asset?.connectionId
        ? await db.query.dataConnections.findFirst({
            where: eq(dataConnections.id, asset.connectionId),
          })
        : null;

      expect(asset).toEqual(
        expect.objectContaining({
          accessScope: "public",
          assetKey: uploaded.sourcePath,
          displayName: "contractors.csv",
          organizationId: owner!.organizationId,
        }),
      );
      expect(version).toEqual(
        expect.objectContaining({
          materializedPath: uploaded.sourcePath,
          rowCount: 2,
          schemaHash: expect.any(String),
        }),
      );
      expect(connection?.kind).toBe("upload");
    } finally {
      await env.cleanup();
    }
  });

  it("keeps uploaded and filesystem files in the same asset registry", async () => {
    const env = await createTestAppEnvironment({ organizationSlug: "critjecture-test-org" });

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const uploaded = await uploadKnowledgeFile({
        file: new File(["ledger_year,contractor,payout\n2026,Acme,1200\n"], "uploaded.csv", {
          type: "text/csv",
        }),
        requestedScope: "public",
        user: owner!,
      });

      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const relativePath = "admin/local.csv";
      const absolutePath = path.join(companyDataRoot, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nBravo,220\n", "utf8");
      await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath,
      });

      const db = await getAppDatabase();
      const assetRows = await db.select().from(dataAssets).where(eq(dataAssets.organizationId, owner!.organizationId));

      expect(assetRows.map((row) => row.assetKey)).toEqual(
        expect.arrayContaining([uploaded.sourcePath, relativePath]),
      );
    } finally {
      await env.cleanup();
    }
  });
});
