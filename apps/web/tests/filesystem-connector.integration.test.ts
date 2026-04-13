import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import { dataAssets, dataAssetVersions, dataConnections, workflowRunResolvedInputs } from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { syncFilesystemDataConnection } from "@/lib/connectors/filesystem-connector";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { createManualWorkflowRun } from "@/lib/workflow-runs";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createWorkflow } from "@/lib/workflows";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

function buildWorkflowVersionBase(ownerUserId: string) {
  return {
    delivery: {
      channels: [],
      retry_policy: {
        backoff_multiplier: 2,
        initial_backoff_seconds: 30,
        max_attempts: 3,
      },
      schema_version: 1,
    },
    executionIdentity: {
      mode: "fixed_membership_user",
      on_identity_invalid: "block_run",
      recheck_at_enqueue: true,
      recheck_at_execution: true,
      required_membership_roles: ["admin", "owner"],
      require_membership_status: "active",
      run_as_user_id: ownerUserId,
      schema_version: 1,
    },
    outputs: {
      schema_version: 1,
      summary_template: "standard_v1",
    },
    provenance: {
      schema_version: 1,
      source_kind: "manual_builder",
    },
    recipe: {
      schema_version: 1,
      steps: [],
    },
    schedule: {
      kind: "manual_only",
      schema_version: 1,
    },
    thresholds: {
      rules: [],
      schema_version: 1,
    },
  };
}

function buildAssetBoundWorkflowVersion(ownerUserId: string, assetId: string) {
  return {
    ...buildWorkflowVersionBase(ownerUserId),
    inputBindings: {
      bindings: [
        {
          binding: {
            asset_id: assetId,
            kind: "asset_id",
          },
          input_key: "contractors_csv",
        },
      ],
      schema_version: 1,
    },
    inputContract: {
      inputs: [
        {
          allowed_mime_types: ["text/csv"],
          csv_rules: {
            min_row_count: 1,
            required_columns: ["vendor", "payout"],
          },
          data_kind: "table",
          input_key: "contractors_csv",
          label: "Contractors CSV",
          multiplicity: "one",
          required: true,
        },
      ],
      schema_version: 1,
    },
  };
}

describe("filesystem connector integration", () => {
  it("scans company_data into filesystem assets with inferred metadata", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const publicFile = path.join(companyDataRoot, "public", "sales.csv");
      const adminFile = path.join(companyDataRoot, "admin", "notes.md");

      await mkdir(path.dirname(publicFile), { recursive: true });
      await mkdir(path.dirname(adminFile), { recursive: true });
      await writeFile(publicFile, "date,amount\n2026-01-01,100\n2026-01-02,200\n", "utf8");
      await writeFile(adminFile, "# Internal notes\n", "utf8");

      const result = await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      expect(result.scannedFileCount).toBe(2);
      expect(result.createdAssetCount).toBe(2);
      expect(result.versionCreatedCount).toBe(2);
      expect(result.unchangedFileCount).toBe(0);

      const db = await getAppDatabase();
      const salesAsset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.assetKey, "public/sales.csv"),
      });
      const notesAsset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.assetKey, "admin/notes.md"),
      });

      expect(salesAsset).toEqual(
        expect.objectContaining({
          accessScope: "public",
          dataKind: "table",
          organizationId: owner!.organizationId,
        }),
      );
      expect(notesAsset).toEqual(
        expect.objectContaining({
          accessScope: "admin",
          dataKind: "text_document",
          organizationId: owner!.organizationId,
        }),
      );

      const salesVersion = await db.query.dataAssetVersions.findFirst({
        where: eq(dataAssetVersions.id, salesAsset!.activeVersionId!),
      });
      const connection = await db.query.dataConnections.findFirst({
        where: eq(dataConnections.id, salesAsset!.connectionId!),
      });

      expect(salesVersion?.rowCount).toBe(2);
      expect(salesVersion?.schemaHash).toEqual(expect.any(String));
      expect(connection).toEqual(
        expect.objectContaining({
          kind: "filesystem",
          lastSyncAt: expect.any(Number),
        }),
      );
    } finally {
      await environment.cleanup();
    }
  });

  it("avoids duplicate versions for unchanged files and creates a new version after edits", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const relativePath = "admin/contractors.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,100\n", "utf8");

      const firstSync = await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      expect(firstSync.versionCreatedCount).toBe(1);

      const db = await getAppDatabase();
      const assetAfterFirstSync = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.assetKey, relativePath),
      });
      const firstVersionCount = await db
        .select()
        .from(dataAssetVersions)
        .where(eq(dataAssetVersions.assetId, assetAfterFirstSync!.id));

      expect(firstVersionCount).toHaveLength(1);

      const secondSync = await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      expect(secondSync.versionCreatedCount).toBe(0);
      expect(secondSync.unchangedFileCount).toBe(1);

      const secondVersionCount = await db
        .select()
        .from(dataAssetVersions)
        .where(eq(dataAssetVersions.assetId, assetAfterFirstSync!.id));

      expect(secondVersionCount).toHaveLength(1);

      await writeFile(absolutePath, "vendor,payout\nAcme,100\nBravo,275\n", "utf8");

      const thirdSync = await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      expect(thirdSync.versionCreatedCount).toBe(1);

      const assetAfterThirdSync = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.id, assetAfterFirstSync!.id),
      });
      const thirdVersionCount = await db
        .select()
        .from(dataAssetVersions)
        .where(eq(dataAssetVersions.assetId, assetAfterFirstSync!.id));

      expect(thirdVersionCount).toHaveLength(2);
      expect(assetAfterThirdSync?.activeVersionId).not.toBe(assetAfterFirstSync?.activeVersionId);
    } finally {
      await environment.cleanup();
    }
  });

  it("makes the next workflow run pick up the latest synced asset version", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const relativePath = "admin/workflow-contractors.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, relativePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,100\n", "utf8");

      await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      const db = await getAppDatabase();
      const asset = await db.query.dataAssets.findFirst({
        where: eq(dataAssets.assetKey, relativePath),
      });

      expect(asset).not.toBeNull();

      const workflow = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Filesystem Connector Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetBoundWorkflowVersion(owner!.id, asset!.id),
      });

      const firstRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: workflow!.workflow.id,
      });
      const firstExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: firstRun.id,
      });

      expect(firstExecution.status).toBe("completed");

      const firstSnapshot = await db.query.workflowRunResolvedInputs.findMany({
        where: eq(workflowRunResolvedInputs.runId, firstRun.id),
      });

      expect(firstSnapshot).toHaveLength(1);
      const firstAssetVersionId = firstSnapshot[0]?.assetVersionId;

      await writeFile(absolutePath, "vendor,payout\nAcme,100\nBravo,275\n", "utf8");
      await syncFilesystemDataConnection({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
      });

      const secondRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: workflow!.workflow.id,
      });
      const secondExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: secondRun.id,
      });

      expect(secondExecution.status).toBe("completed");

      const secondSnapshot = await db.query.workflowRunResolvedInputs.findMany({
        where: eq(workflowRunResolvedInputs.runId, secondRun.id),
      });

      expect(secondSnapshot).toHaveLength(1);
      expect(secondSnapshot[0]?.assetVersionId).toEqual(expect.any(String));
      expect(secondSnapshot[0]?.assetVersionId).not.toBe(firstAssetVersionId);
    } finally {
      await environment.cleanup();
    }
  });
});
