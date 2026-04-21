import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { workflowDeliveries } from "@/lib/legacy-app-schema";
import { processDueWorkflowDeliveryRetries } from "@/lib/workflow-delivery";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { createManualWorkflowRun } from "@/lib/workflow-runs";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createWorkflow } from "@/lib/workflows";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("workflow delivery integration", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("marks retry attempts as failed when the delivery channel is no longer configured", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");

      expect(owner).not.toBeNull();

      const detail = await createWorkflow({
        createdByUserId: owner!.id,
        name: "Delivery Retry Workflow",
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

      const db = await getAppDatabase();
      const now = Date.now();

      await db.insert(workflowDeliveries).values({
        artifactManifestJson: JSON.stringify([]),
        attemptNumber: 1,
        channelKind: "webhook",
        createdAt: now,
        errorMessage: null,
        id: randomUUID(),
        nextRetryAt: now - 1000,
        organizationId: owner!.organizationId,
        payloadSnapshotJson: JSON.stringify({ stale: true }),
        responseBody: null,
        responseStatusCode: null,
        runId: run.id,
        sentAt: null,
        status: "pending",
        updatedAt: now,
        workflowId: detail!.workflow.id,
      });

      const summary = await processDueWorkflowDeliveryRetries({
        organizationId: owner!.organizationId,
        runId: run.id,
      });

      expect(summary.processedCount).toBe(1);
      expect(summary.failedCount).toBe(1);
      expect(summary.sentCount).toBe(0);

      const rows = await db.query.workflowDeliveries.findMany({
        where: and(
          eq(workflowDeliveries.organizationId, owner!.organizationId),
          eq(workflowDeliveries.runId, run.id),
          eq(workflowDeliveries.attemptNumber, 1),
        ),
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("failed");
      expect(rows[0]?.errorMessage ?? "").toContain("no longer available");
    } finally {
      await environment.cleanup();
    }
  });
});
