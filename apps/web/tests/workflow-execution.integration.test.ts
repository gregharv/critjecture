import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import {
  dataAssets,
  dataAssetVersions,
  documents,
  organizationMemberships,
  workflowDeliveries,
  workflowInputRequests,
  workflowRunInputChecks,
  workflowRunResolvedInputs,
  workflowRuns,
  workflowRunSteps,
} from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { ensureFilesystemAssetVersion } from "@/lib/data-assets";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { recheckWaitingWorkflowRuns } from "@/lib/workflow-resume";
import { createManualWorkflowRun, getWorkflowRunById } from "@/lib/workflow-runs";
import { processWorkflowRunQueueOnce } from "@/lib/workflow-worker";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createWorkflow } from "@/lib/workflows";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

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

function buildRequiredInputWorkflowVersion(ownerUserId: string) {
  return {
    ...buildWorkflowVersionBase(ownerUserId),
    inputBindings: {
      bindings: [
        {
          binding: {
            kind: "selector",
            max_documents: 1,
            selection: "latest_updated_at",
            selector: {
              access_scope_in: ["public"],
              display_name_equals: "sales.csv",
            },
          },
          input_key: "sales_csv",
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
            required_columns: ["date", "amount"],
          },
          data_kind: "table",
          input_key: "sales_csv",
          label: "Sales CSV",
          multiplicity: "one",
          required: true,
        },
      ],
      schema_version: 1,
    },
  };
}

function buildAssetBoundWorkflowVersion(
  ownerUserId: string,
  assetId: string,
  options?: {
    mustBeNewerThanLastSuccessfulRun?: boolean;
    skipIfUnchanged?: boolean;
  },
) {
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
          ...(options?.mustBeNewerThanLastSuccessfulRun
            ? { must_be_newer_than_last_successful_run: true }
            : {}),
          multiplicity: "one",
          required: true,
          ...(options?.skipIfUnchanged ? { skip_if_unchanged: true } : {}),
        },
      ],
      schema_version: 1,
    },
  };
}

function buildAssetSelectorWorkflowVersion(ownerUserId: string, assetKey: string) {
  return {
    ...buildWorkflowVersionBase(ownerUserId),
    inputBindings: {
      bindings: [
        {
          binding: {
            kind: "asset_selector",
            max_assets: 1,
            selection: "latest_updated_at",
            selector: {
              access_scope_in: [assetKey.startsWith("admin/") ? "admin" : "public"],
              asset_key_equals: assetKey,
            },
          },
          input_key: "selected_asset",
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
          input_key: "selected_asset",
          label: "Selected Asset",
          multiplicity: "one",
          required: true,
        },
      ],
      schema_version: 1,
    },
  };
}

describe("workflow execution integration", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("completes a manual workflow run end-to-end", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Manual Workflow",
        organizationId: owner!.organizationId,
        status: "active",
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const execution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(execution.status).toBe("completed");
      expect(execution.run.status).toBe("completed");
    } finally {
      await environment.cleanup();
    }
  });

  it("uses asset-bound local company_data files without waiting for input", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const sourcePath = "admin/contractors.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,1250\n", "utf8");

      const { asset } = await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Asset-Bound Local File Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetBoundWorkflowVersion(owner!.id, asset.id),
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const execution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(execution.status).toBe("completed");
      expect(execution.run.status).toBe("completed");
      expect(execution.run.metadata.resolved_inputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input_key: "contractors_csv",
          }),
        ]),
      );
      expect(execution.run.metadata.resolved_inputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documents: expect.arrayContaining([
              expect.objectContaining({
                asset_id: asset.id,
                source_path: sourcePath,
              }),
            ]),
          }),
        ]),
      );
    } finally {
      await environment.cleanup();
    }
  });

  it("resolves asset_selector bindings against the asset registry", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const sourcePath = "public/uploads/selector-target.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,1250\n", "utf8");

      await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Asset Selector Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetSelectorWorkflowVersion(owner!.id, sourcePath),
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const execution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(execution.status).toBe("completed");
      expect(execution.run.metadata.resolved_inputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input_key: "selected_asset",
            documents: expect.arrayContaining([
              expect.objectContaining({
                source_path: sourcePath,
              }),
            ]),
          }),
        ]),
      );
    } finally {
      await environment.cleanup();
    }
  });

  it("skips execution when inputs are unchanged and skip_if_unchanged is enabled", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const sourcePath = "admin/skip-if-unchanged.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,1250\n", "utf8");

      const { asset } = await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Skip Unchanged Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetBoundWorkflowVersion(owner!.id, asset.id, {
          skipIfUnchanged: true,
        }),
      });

      const firstRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const firstExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: firstRun.id,
      });

      expect(firstExecution.status).toBe("completed");

      const secondRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const secondExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: secondRun.id,
      });

      expect(secondExecution.status).toBe("skipped");
      expect(secondExecution.run.status).toBe("skipped");
      expect(secondExecution.run.metadata.input_validation).toEqual(
        expect.objectContaining({
          skipped_input_count: 1,
          status: "skip",
        }),
      );
      expect(secondExecution.run.metadata.skip_reason).toBe("inputs_unchanged");
    } finally {
      await environment.cleanup();
    }
  });

  it("blocks validation when inputs are not newer than the last successful run", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const sourcePath = "admin/must-be-newer.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,1250\n", "utf8");

      const { asset } = await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Must Be Newer Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetBoundWorkflowVersion(owner!.id, asset.id, {
          mustBeNewerThanLastSuccessfulRun: true,
        }),
      });

      const firstRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const firstExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: firstRun.id,
      });

      expect(firstExecution.status).toBe("completed");

      const secondRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const secondExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: secondRun.id,
      });

      expect(secondExecution.status).toBe("blocked_validation");
      expect(secondExecution.run.status).toBe("blocked_validation");
      expect(secondExecution.run.metadata.input_validation).toEqual(
        expect.objectContaining({
          failed_input_count: 1,
          status: "blocked_validation",
        }),
      );
    } finally {
      await environment.cleanup();
    }
  });

  it("waits for missing required input then auto-resumes after file arrival", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Input-Gated Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildRequiredInputWorkflowVersion(owner!.id),
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const firstExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(firstExecution.status).toBe("waiting_for_input");
      expect(firstExecution.run.status).toBe("waiting_for_input");

      const db = await getAppDatabase();
      const now = Date.now();
      const sourcePath = "public/uploads/sales.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "date,amount\n2026-01-01,10\n", "utf8");

      await db.insert(documents).values({
        accessScope: "public",
        byteSize: 24,
        contentSha256: `sha-${randomUUID()}`,
        createdAt: now,
        displayName: "sales.csv",
        id: randomUUID(),
        ingestionError: null,
        ingestionStatus: "ready",
        lastIndexedAt: now,
        mimeType: "text/csv",
        organizationId: owner!.organizationId,
        sourcePath,
        sourceType: "uploaded",
        updatedAt: now,
        uploadedByUserId: owner!.id,
      });

      const resumeSummary = await recheckWaitingWorkflowRuns({
        organizationId: owner!.organizationId,
      });

      expect(resumeSummary.attemptedCount).toBeGreaterThanOrEqual(1);
      expect(resumeSummary.completedCount).toBeGreaterThanOrEqual(1);

      const resumedRun = await getWorkflowRunById({
        organizationId: owner!.organizationId,
        runId: run.id,
      });

      expect(resumedRun?.status).toBe("completed");
    } finally {
      await environment.cleanup();
    }
  });

  it("freezes asset versions per run and records snapshot summaries", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const sourcePath = "admin/frozen.csv";
      const companyDataRoot = await resolveCompanyDataRoot(owner!.organizationSlug);
      const absolutePath = path.join(companyDataRoot, sourcePath);

      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "vendor,payout\nAcme,1250\n", "utf8");

      const firstAssetState = await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Frozen Snapshot Workflow",
        organizationId: owner!.organizationId,
        status: "active",
        version: buildAssetBoundWorkflowVersion(owner!.id, firstAssetState.asset.id),
      });

      const firstRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const firstExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: firstRun.id,
      });

      expect(firstExecution.status).toBe("completed");

      const firstSnapshotRows = await (await getAppDatabase()).query.workflowRunResolvedInputs.findMany({
        where: and(
          eq(workflowRunResolvedInputs.organizationId, owner!.organizationId),
          eq(workflowRunResolvedInputs.runId, firstRun.id),
        ),
      });

      expect(firstSnapshotRows).toHaveLength(1);
      const firstSnapshot = firstSnapshotRows[0]!;
      expect(firstExecution.run.metadata.snapshot_summary).toEqual(
        expect.objectContaining({
          asset_ids: [firstAssetState.asset.id],
          asset_version_ids: [firstSnapshot.assetVersionId],
        }),
      );

      await writeFile(absolutePath, "vendor,payout\nAcme,9999\n", "utf8");

      const secondAssetState = await ensureFilesystemAssetVersion({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        relativePath: sourcePath,
      });

      expect(secondAssetState.version.id).not.toBe(firstSnapshot.assetVersionId);

      const secondRun = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const secondExecution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: secondRun.id,
      });

      expect(secondExecution.status).toBe("completed");

      const db = await getAppDatabase();
      const secondSnapshotRows = await db.query.workflowRunResolvedInputs.findMany({
        where: and(
          eq(workflowRunResolvedInputs.organizationId, owner!.organizationId),
          eq(workflowRunResolvedInputs.runId, secondRun.id),
        ),
      });

      expect(secondSnapshotRows).toHaveLength(1);
      expect(secondSnapshotRows[0]!.assetVersionId).toBe(secondAssetState.version.id);
      expect(secondSnapshotRows[0]!.assetVersionId).not.toBe(firstSnapshot.assetVersionId);

      const firstSnapshotRowsAfter = await db.query.workflowRunResolvedInputs.findMany({
        where: and(
          eq(workflowRunResolvedInputs.organizationId, owner!.organizationId),
          eq(workflowRunResolvedInputs.runId, firstRun.id),
        ),
      });

      expect(firstSnapshotRowsAfter[0]!.assetVersionId).toBe(firstSnapshot.assetVersionId);
      expect(firstSnapshotRowsAfter[0]!.contentHash).toBe(firstSnapshot.contentHash);
      expect(secondExecution.run.metadata.snapshot_summary).toEqual(
        expect.objectContaining({
          asset_ids: [firstAssetState.asset.id],
          asset_version_ids: [secondAssetState.version.id],
        }),
      );
    } finally {
      await environment.cleanup();
    }
  });

  it("fails closed when execution identity loses required membership state", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Identity Guard Workflow",
        organizationId: owner!.organizationId,
        status: "active",
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const db = await getAppDatabase();
      const now = Date.now();

      await db
        .update(organizationMemberships)
        .set({
          status: "suspended",
          updatedAt: now,
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, owner!.organizationId),
            eq(organizationMemberships.userId, owner!.id),
          ),
        );

      const execution = await executeWorkflowRun({
        organizationId: owner!.organizationId,
        organizationSlug: owner!.organizationSlug,
        runId: run.id,
      });

      expect(execution.status).toBe("failed");
      expect(execution.run.failureReason ?? "").toContain("identity_invalid_membership_status");
    } finally {
      await environment.cleanup();
    }
  });

  it("reconciles stale running runs and preserves frozen input snapshots", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      expect(owner).not.toBeNull();

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Reconciliation Workflow",
        organizationId: owner!.organizationId,
        status: "active",
      });

      const run = await createManualWorkflowRun({
        organizationId: owner!.organizationId,
        runAsRole: "owner",
        runAsUserId: owner!.id,
        workflowId: detail!.workflow.id,
      });

      const db = await getAppDatabase();
      const staleTimestamp = Date.now() - 2 * 60 * 60 * 1000;

      await db
        .update(workflowRuns)
        .set({
          startedAt: staleTimestamp,
          status: "running",
          updatedAt: staleTimestamp,
        })
        .where(
          and(
            eq(workflowRuns.organizationId, owner!.organizationId),
            eq(workflowRuns.id, run.id),
          ),
        );

      await db.insert(workflowRunSteps).values({
        completedAt: null,
        createdAt: staleTimestamp,
        errorMessage: null,
        id: randomUUID(),
        inputJson: JSON.stringify({ stale: true }),
        organizationId: owner!.organizationId,
        outputJson: JSON.stringify({}),
        runId: run.id,
        sandboxRunId: null,
        startedAt: staleTimestamp,
        status: "running",
        stepKey: "stale_step",
        stepOrder: 0,
        toolName: "run_data_analysis",
        updatedAt: staleTimestamp,
      });

      await db.insert(workflowRunInputChecks).values({
        createdAt: staleTimestamp,
        id: randomUUID(),
        inputKey: "stale_input",
        organizationId: owner!.organizationId,
        reportJson: JSON.stringify({ stale: true }),
        runId: run.id,
        status: "fail",
        updatedAt: staleTimestamp,
      });

      const staleAssetId = randomUUID();
      const staleAssetVersionId = randomUUID();

      await db.insert(dataAssets).values({
        accessScope: "public",
        activeVersionId: staleAssetVersionId,
        assetKey: "public/uploads/stale.csv",
        createdAt: staleTimestamp,
        dataKind: "table",
        displayName: "stale.csv",
        id: staleAssetId,
        metadataJson: JSON.stringify({ relative_path: "public/uploads/stale.csv" }),
        organizationId: owner!.organizationId,
        status: "active",
        updatedAt: staleTimestamp,
      });

      await db.insert(dataAssetVersions).values({
        assetId: staleAssetId,
        byteSize: 24,
        contentHash: `sha-${randomUUID()}`,
        createdAt: staleTimestamp,
        id: staleAssetVersionId,
        ingestionError: null,
        ingestionStatus: "ready",
        materializedPath: "public/uploads/stale.csv",
        metadataJson: JSON.stringify({ source_type: "asset" }),
        mimeType: "text/csv",
        organizationId: owner!.organizationId,
        sourceModifiedAt: staleTimestamp,
        updatedAt: staleTimestamp,
      });

      await db.insert(workflowRunResolvedInputs).values({
        assetId: staleAssetId,
        assetVersionId: staleAssetVersionId,
        contentHash: `sha-${randomUUID()}`,
        createdAt: staleTimestamp,
        displayName: "stale.csv",
        id: randomUUID(),
        inputItemIndex: 0,
        inputKey: "stale_input",
        materializedPath: "public/uploads/stale.csv",
        metadataJson: JSON.stringify({ source_type: "asset" }),
        organizationId: owner!.organizationId,
        resolvedAt: staleTimestamp,
        runId: run.id,
        schemaHash: null,
        updatedAt: staleTimestamp,
      });

      await db.insert(workflowInputRequests).values({
        createdAt: staleTimestamp,
        expiresAt: staleTimestamp + 3600_000,
        fulfilledAt: null,
        id: randomUUID(),
        message: "stale",
        notificationChannelsJson: JSON.stringify(["in_app"]),
        organizationId: owner!.organizationId,
        requestedInputKeysJson: JSON.stringify(["stale_input"]),
        runId: run.id,
        sentAt: staleTimestamp,
        status: "open",
        updatedAt: staleTimestamp,
        workflowId: detail!.workflow.id,
      });

      await db.insert(workflowDeliveries).values({
        artifactManifestJson: JSON.stringify([]),
        attemptNumber: 1,
        channelKind: "webhook",
        createdAt: staleTimestamp,
        errorMessage: null,
        id: randomUUID(),
        nextRetryAt: staleTimestamp,
        organizationId: owner!.organizationId,
        payloadSnapshotJson: JSON.stringify({}),
        responseBody: null,
        responseStatusCode: null,
        runId: run.id,
        sentAt: null,
        status: "pending",
        updatedAt: staleTimestamp,
        workflowId: detail!.workflow.id,
      });

      const summary = await processWorkflowRunQueueOnce({
        limit: 1,
        organizationId: owner!.organizationId,
      });

      expect(summary.reclaimedCount).toBe(1);

      const runAfter = await getWorkflowRunById({
        organizationId: owner!.organizationId,
        runId: run.id,
      });
      const staleSteps = await db.query.workflowRunSteps.findMany({
        where: and(
          eq(workflowRunSteps.organizationId, owner!.organizationId),
          eq(workflowRunSteps.runId, run.id),
        ),
      });
      const staleChecks = await db.query.workflowRunInputChecks.findMany({
        where: and(
          eq(workflowRunInputChecks.organizationId, owner!.organizationId),
          eq(workflowRunInputChecks.runId, run.id),
        ),
      });
      const pendingDeliveries = await db.query.workflowDeliveries.findMany({
        where: and(
          eq(workflowDeliveries.organizationId, owner!.organizationId),
          eq(workflowDeliveries.runId, run.id),
          eq(workflowDeliveries.status, "pending"),
        ),
      });
      const resolvedSnapshots = await db.query.workflowRunResolvedInputs.findMany({
        where: and(
          eq(workflowRunResolvedInputs.organizationId, owner!.organizationId),
          eq(workflowRunResolvedInputs.runId, run.id),
        ),
      });
      const inputRequests = await db.query.workflowInputRequests.findMany({
        where: and(
          eq(workflowInputRequests.organizationId, owner!.organizationId),
          eq(workflowInputRequests.runId, run.id),
        ),
      });

      expect(runAfter?.status).not.toBe("running");
      expect(staleSteps).toHaveLength(0);
      expect(staleChecks).toHaveLength(0);
      expect(pendingDeliveries).toHaveLength(0);
      expect(resolvedSnapshots).toHaveLength(1);
      expect(inputRequests[0]?.status).toBe("cancelled");
    } finally {
      await environment.cleanup();
    }
  });
});
