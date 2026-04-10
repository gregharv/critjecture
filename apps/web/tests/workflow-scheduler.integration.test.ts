import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getAppDatabase } from "@/lib/app-db";
import { organizationMemberships, workflowRuns, workflows } from "@/lib/app-schema";
import {
  buildScheduledWindowKey,
  computeNextScheduledRunAt,
} from "@/lib/workflow-schedule";
import { tickDueWorkflowSchedules } from "@/lib/workflow-scheduler";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createWorkflow } from "@/lib/workflows";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

const DUE_START_AT = Date.UTC(2026, 0, 5, 9, 0, 0);
const DUE_NOW = Date.UTC(2026, 0, 5, 9, 1, 0);
const RECURRING_WEEKLY_SCHEDULE = {
  cadence: {
    day_of_week: 1,
    hour: 9,
    kind: "weekly",
    minute: 0,
  },
  catch_up_policy: "enqueue_missed_windows",
  kind: "recurring",
  schema_version: 1,
  timezone: "UTC",
} as const;

const originalEnableScheduler = process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;
const originalEnableHostedScheduled = process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS;

afterEach(async () => {
  if (originalEnableScheduler === undefined) {
    delete process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;
  } else {
    process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = originalEnableScheduler;
  }

  if (originalEnableHostedScheduled === undefined) {
    delete process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS;
  } else {
    process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS = originalEnableHostedScheduled;
  }

  await resetTestAppState();
});

async function createRecurringWorkflowForOwner() {
  const owner = await getAuthenticatedUserByEmail("owner@example.com");

  expect(owner).not.toBeNull();

  const workflowDetail = await createWorkflow({
    createdByUserId: owner!.id,
    name: "Weekly Revenue Check",
    organizationId: owner!.organizationId,
    status: "active",
    version: {
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
        run_as_user_id: owner!.id,
        schema_version: 1,
      },
      inputBindings: {
        bindings: [],
        schema_version: 1,
      },
      inputContract: {
        inputs: [],
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
      schedule: RECURRING_WEEKLY_SCHEDULE,
      thresholds: {
        rules: [],
        schema_version: 1,
      },
    },
  });

  expect(workflowDetail).not.toBeNull();
  expect(workflowDetail!.workflow.currentVersionId).not.toBeNull();

  return {
    owner: owner!,
    workflow: workflowDetail!.workflow,
  };
}

describe("workflow scheduler", () => {
  it("stays disabled until the scheduler flag is enabled", async () => {
    const environment = await createTestAppEnvironment();

    try {
      delete process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;
      const summary = await tickDueWorkflowSchedules();

      expect(summary.skippedDisabled).toBe(true);
      expect(summary.skippedReason).toBe("scheduler_disabled");
      expect(summary.queuedRunCount).toBe(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("does not enqueue duplicate runs for the same scheduled window key", async () => {
    const environment = await createTestAppEnvironment();

    try {
      process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = "true";
      const { owner, workflow } = await createRecurringWorkflowForOwner();
      const workflowVersionId = workflow.currentVersionId!;
      const db = await getAppDatabase();
      const windowEndAt = computeNextScheduledRunAt(RECURRING_WEEKLY_SCHEDULE, DUE_START_AT);

      expect(windowEndAt).not.toBeNull();

      const triggerWindowKey = buildScheduledWindowKey({
        windowEndAt: windowEndAt!,
        windowStartAt: DUE_START_AT,
        workflowId: workflow.id,
        workflowVersionId,
      });

      await db
        .update(workflows)
        .set({
          nextRunAt: DUE_START_AT,
          updatedAt: DUE_START_AT,
        })
        .where(
          and(
            eq(workflows.id, workflow.id),
            eq(workflows.organizationId, owner.organizationId),
          ),
        );

      await db.insert(workflowRuns).values({
        completedAt: DUE_NOW,
        createdAt: DUE_START_AT,
        failureReason: "seeded_duplicate",
        id: randomUUID(),
        metadataJson: JSON.stringify({ seeded: true }),
        organizationId: owner.organizationId,
        requestId: "seed-request",
        runAsRole: "owner",
        runAsUserId: owner.id,
        startedAt: null,
        status: "failed",
        triggerKind: "scheduled",
        triggerWindowKey,
        updatedAt: DUE_NOW,
        workflowId: workflow.id,
        workflowVersionId,
      });

      const summary = await tickDueWorkflowSchedules({
        now: DUE_NOW,
        organizationId: owner.organizationId,
        requestId: "tick-request",
      });

      expect(summary.claimedWorkflowCount).toBe(1);
      expect(summary.duplicateWindowCount).toBe(1);
      expect(summary.queuedRunCount).toBe(0);
      expect(summary.windowCount).toBe(1);

      const matchingRuns = await db.query.workflowRuns.findMany({
        where: and(
          eq(workflowRuns.organizationId, owner.organizationId),
          eq(workflowRuns.workflowId, workflow.id),
          eq(workflowRuns.triggerKind, "scheduled"),
          eq(workflowRuns.triggerWindowKey, triggerWindowKey),
        ),
      });

      expect(matchingRuns).toHaveLength(1);
    } finally {
      await environment.cleanup();
    }
  });

  it("skips paused workflows even when next_run_at is due", async () => {
    const environment = await createTestAppEnvironment();

    try {
      process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = "true";
      const { owner, workflow } = await createRecurringWorkflowForOwner();
      const db = await getAppDatabase();

      await db
        .update(workflows)
        .set({
          nextRunAt: DUE_START_AT,
          status: "paused",
          updatedAt: DUE_START_AT,
        })
        .where(
          and(
            eq(workflows.id, workflow.id),
            eq(workflows.organizationId, owner.organizationId),
          ),
        );

      const summary = await tickDueWorkflowSchedules({
        now: DUE_NOW,
        organizationId: owner.organizationId,
      });

      expect(summary.scannedWorkflowCount).toBe(0);
      expect(summary.queuedRunCount).toBe(0);

      const scheduledRuns = await db.query.workflowRuns.findMany({
        where: and(
          eq(workflowRuns.organizationId, owner.organizationId),
          eq(workflowRuns.workflowId, workflow.id),
          eq(workflowRuns.triggerKind, "scheduled"),
        ),
      });

      expect(scheduledRuns).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("records scheduled runs as failed when execution identity is invalid at enqueue", async () => {
    const environment = await createTestAppEnvironment();

    try {
      process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = "true";
      const { owner, workflow } = await createRecurringWorkflowForOwner();
      const db = await getAppDatabase();

      await db
        .update(workflows)
        .set({
          nextRunAt: DUE_START_AT,
          updatedAt: DUE_START_AT,
        })
        .where(
          and(
            eq(workflows.id, workflow.id),
            eq(workflows.organizationId, owner.organizationId),
          ),
        );

      await db
        .update(organizationMemberships)
        .set({
          status: "suspended",
          updatedAt: DUE_START_AT,
        })
        .where(
          and(
            eq(organizationMemberships.organizationId, owner.organizationId),
            eq(organizationMemberships.userId, owner.id),
          ),
        );

      const summary = await tickDueWorkflowSchedules({
        now: DUE_NOW,
        organizationId: owner.organizationId,
      });

      expect(summary.windowCount).toBe(1);
      expect(summary.identityBlockedWindowCount).toBe(1);
      expect(summary.failedWindowCount).toBe(1);
      expect(summary.queuedRunCount).toBe(0);

      const scheduledRuns = await db.query.workflowRuns.findMany({
        where: and(
          eq(workflowRuns.organizationId, owner.organizationId),
          eq(workflowRuns.workflowId, workflow.id),
          eq(workflowRuns.triggerKind, "scheduled"),
        ),
      });

      expect(scheduledRuns).toHaveLength(1);
      expect(scheduledRuns[0]?.status).toBe("failed");
      expect(scheduledRuns[0]?.failureReason).toContain("identity_invalid_membership_status");
    } finally {
      await environment.cleanup();
    }
  });
});
