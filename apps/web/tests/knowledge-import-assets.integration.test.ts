import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import { dataAssets, dataAssetVersions, dataConnections, documents } from "@/lib/app-schema";
import {
  createKnowledgeImportJobFromFiles,
  getKnowledgeImportJob,
} from "@/lib/knowledge-imports";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

async function waitForImportJobCompletion(input: {
  jobId: string;
  user: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUserByEmail>>>;
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    const result = await getKnowledgeImportJob(input.user, input.jobId);

    if (
      result.job.status === "completed" ||
      result.job.status === "completed_with_errors" ||
      result.job.status === "failed"
    ) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for import job ${input.jobId}`);
}

describe("knowledge import asset integration", () => {
  it("reuses the same uploaded asset for repeated single-file imports with the same name", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const firstJob = await createKnowledgeImportJobFromFiles({
        files: [
          {
            file: new File(["ledger_year,contractor,payout\n2026,Acme,1200\n"], "superstore-sales.csv", {
              type: "text/csv",
            }),
            relativePath: "superstore-sales.csv",
          },
        ],
        requestedScope: "public",
        sourceKind: "single_file",
        user: owner!,
      });
      const firstCompleted = await waitForImportJobCompletion({
        jobId: firstJob.id,
        user: owner!,
      });

      const firstDocumentId = firstCompleted.files[0]?.documentId;
      expect(firstDocumentId).toEqual(expect.any(String));

      const secondJob = await createKnowledgeImportJobFromFiles({
        files: [
          {
            file: new File(["ledger_year,contractor,payout\n2026,Acme,1200\n2026,Beacon,900\n"], "superstore-sales.csv", {
              type: "text/csv",
            }),
            relativePath: "superstore-sales.csv",
          },
        ],
        replaceExisting: true,
        requestedScope: "public",
        sourceKind: "single_file",
        user: owner!,
      });
      const secondCompleted = await waitForImportJobCompletion({
        jobId: secondJob.id,
        user: owner!,
      });

      expect(secondCompleted.files[0]?.documentId).toBe(firstDocumentId);

      const db = await getAppDatabase();
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, firstDocumentId!),
      });
      const assets = await db.select().from(dataAssets).where(eq(dataAssets.assetKey, document!.sourcePath));
      const versions = assets[0]
        ? await db.select().from(dataAssetVersions).where(eq(dataAssetVersions.assetId, assets[0].id))
        : [];

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");

      expect(document?.sourcePath).toBe(`public/uploads/${year}/${month}/superstore-sales.csv`);
      expect(assets).toHaveLength(1);
      expect(versions).toHaveLength(2);
    } finally {
      await environment.cleanup();
    }
  });

  it("requires explicit replacement before reusing an existing path in the month folder", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const firstJob = await createKnowledgeImportJobFromFiles({
        files: [
          {
            file: new File(["region,sales\nwest,10\n"], "sales.csv", {
              type: "text/csv",
            }),
            relativePath: "sales.csv",
          },
        ],
        requestedScope: "public",
        sourceKind: "single_file",
        user: owner!,
      });
      await waitForImportJobCompletion({
        jobId: firstJob.id,
        user: owner!,
      });

      await expect(
        createKnowledgeImportJobFromFiles({
          files: [
            {
              file: new File(["region,sales\nwest,11\n"], "sales.csv", {
                type: "text/csv",
              }),
              relativePath: "sales.csv",
            },
          ],
          requestedScope: "public",
          sourceKind: "single_file",
          user: owner!,
        }),
      ).rejects.toThrow(/Confirm replacement to continue\./);
    } finally {
      await environment.cleanup();
    }
  });

  it("creates bulk import assets and versions for imported files", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const job = await createKnowledgeImportJobFromFiles({
        files: [
          {
            file: new File([
              "ledger_year,contractor,payout\n2026,Acme,1200\n2026,Beacon,900\n",
            ], "imports/finance/contractors.csv", { type: "text/csv" }),
            relativePath: "finance/contractors.csv",
          },
        ],
        requestedScope: "admin",
        sourceKind: "directory",
        user: owner!,
      });

      const completed = await waitForImportJobCompletion({
        jobId: job.id,
        user: owner!,
      });

      expect(completed.job.status).toBe("completed");
      expect(completed.files).toHaveLength(1);
      expect(completed.files[0]?.stage).toBe("ready");
      expect(completed.files[0]?.documentId).toEqual(expect.any(String));

      const db = await getAppDatabase();
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, completed.files[0]!.documentId!),
      });
      const asset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.externalObjectId, completed.files[0]!.documentId!),
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

      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");

      expect(document).toEqual(
        expect.objectContaining({
          accessScope: "admin",
          ingestionStatus: "ready",
          sourcePath: `admin/uploads/${year}/${month}/finance/contractors.csv`,
          sourceType: "bulk_import",
        }),
      );
      expect(asset).toEqual(
        expect.objectContaining({
          accessScope: "admin",
          assetKey: document?.sourcePath,
          dataKind: "table",
          displayName: document?.displayName,
          externalObjectId: completed.files[0]!.documentId!,
          organizationId: owner!.organizationId,
        }),
      );
      expect(version).toEqual(
        expect.objectContaining({
          materializedPath: document?.sourcePath,
          rowCount: 2,
          schemaHash: expect.any(String),
        }),
      );
      expect(connection).toEqual(
        expect.objectContaining({
          kind: "bulk_import",
          lastSyncAt: expect.any(Number),
        }),
      );
    } finally {
      await environment.cleanup();
    }
  });
});
