import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import {
  documents,
  organizationMemberships,
  workflowDeliveries,
  workflowInputRequests,
  workflowRunInputChecks,
  workflowRuns,
  workflowRunSteps,
} from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
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

function buildRequiredInputWorkflowVersion(ownerUserId: string) {
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

  it("reconciles stale running runs and clears stale execution rows", async () => {
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
      expect(inputRequests[0]?.status).toBe("cancelled");
    } finally {
      await environment.cleanup();
    }
  });
});
