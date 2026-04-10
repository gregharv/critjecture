import "server-only";

import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  organizationMemberships,
  users,
  workflowRuns,
  workflowVersions,
  workflows,
} from "@/lib/app-schema";
import { getWorkflowSchedulerGateStatus } from "@/lib/workflow-flags";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import {
  addSchedulerRecoveryDelay,
  buildScheduledWindowKey,
  clampSchedulerLimit,
  computeNextScheduledRunAt,
  getWorkflowSchedulerSettings,
  isRecurringSchedule,
} from "@/lib/workflow-schedule";
import {
  parseWorkflowExecutionIdentityJson,
  parseWorkflowScheduleJson,
  type WorkflowExecutionIdentityV1,
} from "@/lib/workflow-types";
import { ensureWorkflowRunWorkerRunning } from "@/lib/workflow-worker";

type SchedulerIdentityValidation =
  | {
      runAsRole: "admin" | "owner";
      status: "valid";
    }
  | {
      code:
        | "identity_invalid_missing_user"
        | "identity_invalid_user_status"
        | "identity_invalid_membership_missing"
        | "identity_invalid_membership_status"
        | "identity_invalid_role";
      message: string;
      runAsRole: "admin" | "owner";
      status: "invalid";
    };

type DueWorkflowCandidate = {
  executionIdentityJson: string;
  nextRunAt: number;
  organizationId: string;
  scheduleJson: string;
  workflowId: string;
  workflowVersionId: string;
};

type ScheduledWindow = {
  triggerWindowKey: string;
  windowEndAt: number;
  windowStartAt: number;
};

export type WorkflowSchedulerTickSummary = {
  backpressureApplied: boolean;
  claimedWorkflowCount: number;
  duplicateWindowCount: number;
  failedWindowCount: number;
  identityBlockedWindowCount: number;
  initializedNextRunCount: number;
  limit: number;
  nextRunAdvanceCount: number;
  queuedRunCount: number;
  scannedWorkflowCount: number;
  skippedDisabled: boolean;
  skippedReason: string | null;
  wakeRequested: boolean;
  windowCount: number;
};

function getMutationChanges(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return 0;
  }

  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }

  return 0;
}

function getFallbackRunAsRole(identity: WorkflowExecutionIdentityV1) {
  return identity.required_membership_roles[0] ?? "admin";
}

async function validateSchedulerExecutionIdentity(input: {
  executionIdentity: WorkflowExecutionIdentityV1;
  organizationId: string;
}) {
  const fallbackRole = getFallbackRunAsRole(input.executionIdentity);
  const db = await getAppDatabase();
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.executionIdentity.run_as_user_id),
  });

  if (!user) {
    return {
      code: "identity_invalid_missing_user",
      message: "Workflow execution identity user no longer exists.",
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  if (user.status !== "active") {
    return {
      code: "identity_invalid_user_status",
      message: "Workflow execution identity user must be active.",
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  const membership = await db.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, input.organizationId),
      eq(organizationMemberships.userId, input.executionIdentity.run_as_user_id),
    ),
  });

  if (!membership) {
    return {
      code: "identity_invalid_membership_missing",
      message: "Workflow execution identity is no longer a member of the organization.",
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  if (membership.status !== input.executionIdentity.require_membership_status) {
    return {
      code: "identity_invalid_membership_status",
      message: `Workflow execution identity must be ${input.executionIdentity.require_membership_status}.`,
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  if (membership.role !== "admin" && membership.role !== "owner") {
    return {
      code: "identity_invalid_role",
      message: "Workflow execution identity no longer has a required role.",
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  if (!input.executionIdentity.required_membership_roles.includes(membership.role)) {
    return {
      code: "identity_invalid_role",
      message: "Workflow execution identity no longer has a required role.",
      runAsRole: fallbackRole,
      status: "invalid",
    } satisfies SchedulerIdentityValidation;
  }

  return {
    runAsRole: membership.role,
    status: "valid",
  } satisfies SchedulerIdentityValidation;
}

async function countQueuedWorkflowRuns(organizationId?: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(workflowRuns)
    .where(
      organizationId
        ? and(eq(workflowRuns.organizationId, organizationId), eq(workflowRuns.status, "queued"))
        : eq(workflowRuns.status, "queued"),
    )
    .limit(1);

  return Number(rows[0]?.count ?? 0);
}

async function listDueWorkflowCandidates(input: {
  limit: number;
  now: number;
  organizationId?: string;
}) {
  const db = await getAppDatabase();

  return db
    .select({
      executionIdentityJson: workflowVersions.executionIdentityJson,
      nextRunAt: workflows.nextRunAt,
      organizationId: workflows.organizationId,
      scheduleJson: workflowVersions.scheduleJson,
      workflowId: workflows.id,
      workflowVersionId: workflowVersions.id,
    })
    .from(workflows)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(
      input.organizationId
        ? and(
            eq(workflows.organizationId, input.organizationId),
            eq(workflows.status, "active"),
            isNotNull(workflows.nextRunAt),
            lte(workflows.nextRunAt, input.now),
          )
        : and(eq(workflows.status, "active"), isNotNull(workflows.nextRunAt), lte(workflows.nextRunAt, input.now)),
    )
    .orderBy(asc(workflows.nextRunAt), asc(workflows.updatedAt), asc(workflows.createdAt))
    .limit(input.limit);
}

async function initializeMissingNextRunAt(input: {
  limit: number;
  now: number;
  organizationId?: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      organizationId: workflows.organizationId,
      scheduleJson: workflowVersions.scheduleJson,
      workflowId: workflows.id,
      workflowVersionId: workflowVersions.id,
    })
    .from(workflows)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
    .where(
      input.organizationId
        ? and(
            eq(workflows.organizationId, input.organizationId),
            eq(workflows.status, "active"),
            isNull(workflows.nextRunAt),
          )
        : and(eq(workflows.status, "active"), isNull(workflows.nextRunAt)),
    )
    .orderBy(asc(workflows.updatedAt), asc(workflows.createdAt))
    .limit(input.limit);

  let initializedNextRunCount = 0;

  for (const row of rows) {
    try {
      const schedule = parseWorkflowScheduleJson(row.scheduleJson);

      if (!isRecurringSchedule(schedule)) {
        continue;
      }

      const nextRunAt = computeNextScheduledRunAt(schedule, input.now);

      if (nextRunAt === null) {
        continue;
      }

      const updateResult = await db
        .update(workflows)
        .set({
          nextRunAt,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(workflows.id, row.workflowId),
            eq(workflows.organizationId, row.organizationId),
            eq(workflows.status, "active"),
            eq(workflows.currentVersionId, row.workflowVersionId),
            isNull(workflows.nextRunAt),
          ),
        )
        .run();

      if (getMutationChanges(updateResult) > 0) {
        initializedNextRunCount += 1;
      }
    } catch (caughtError) {
      logStructuredError("workflow.scheduler_initialize_next_run_failed", caughtError, {
        organizationId: row.organizationId,
        routeGroup: "workflow",
        routeKey: "workflow.scheduler.tick",
        workflowId: row.workflowId,
      });
    }
  }

  return initializedNextRunCount;
}

function buildDueWindows(input: {
  maxWindows: number;
  now: number;
  schedule: ReturnType<typeof parseWorkflowScheduleJson>;
  workflowId: string;
  workflowVersionId: string;
  workflowWindowStartAt: number;
}) {
  const windows: ScheduledWindow[] = [];
  let cursor = input.workflowWindowStartAt;

  while (cursor <= input.now && windows.length < input.maxWindows) {
    const windowEndAt = computeNextScheduledRunAt(input.schedule, cursor);

    if (!windowEndAt || windowEndAt <= cursor) {
      throw new Error("Failed to compute next workflow schedule window.");
    }

    windows.push({
      triggerWindowKey: buildScheduledWindowKey({
        windowEndAt,
        windowStartAt: cursor,
        workflowId: input.workflowId,
        workflowVersionId: input.workflowVersionId,
      }),
      windowEndAt,
      windowStartAt: cursor,
    });

    cursor = windowEndAt;
  }

  return {
    nextRunAt: cursor,
    windows,
  };
}

async function moveWorkflowNextRunAfterFailure(input: {
  candidate: DueWorkflowCandidate;
  now: number;
}) {
  const db = await getAppDatabase();
  const deferredRunAt = addSchedulerRecoveryDelay(input.now);

  await db
    .update(workflows)
    .set({
      nextRunAt: deferredRunAt,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(workflows.id, input.candidate.workflowId),
        eq(workflows.organizationId, input.candidate.organizationId),
        eq(workflows.status, "active"),
        eq(workflows.currentVersionId, input.candidate.workflowVersionId),
        eq(workflows.nextRunAt, input.candidate.nextRunAt),
      ),
    )
    .run();
}

async function claimAndEnqueueScheduledWorkflow(input: {
  candidate: DueWorkflowCandidate;
  maxWindowsPerWorkflow: number;
  now: number;
  requestId: string | null;
}) {
  const schedule = parseWorkflowScheduleJson(input.candidate.scheduleJson);

  if (!isRecurringSchedule(schedule)) {
    const db = await getAppDatabase();
    const resetResult = await db
      .update(workflows)
      .set({
        nextRunAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(workflows.id, input.candidate.workflowId),
          eq(workflows.organizationId, input.candidate.organizationId),
          eq(workflows.status, "active"),
          eq(workflows.currentVersionId, input.candidate.workflowVersionId),
          eq(workflows.nextRunAt, input.candidate.nextRunAt),
        ),
      )
      .run();

    return {
      claimed: getMutationChanges(resetResult) > 0,
      duplicateWindowCount: 0,
      failedWindowCount: 0,
      identityBlockedWindowCount: 0,
      nextRunAdvanced: getMutationChanges(resetResult) > 0,
      queuedRunCount: 0,
      windowCount: 0,
    };
  }

  const { nextRunAt, windows } = buildDueWindows({
    maxWindows: input.maxWindowsPerWorkflow,
    now: input.now,
    schedule,
    workflowId: input.candidate.workflowId,
    workflowVersionId: input.candidate.workflowVersionId,
    workflowWindowStartAt: input.candidate.nextRunAt,
  });

  if (windows.length === 0) {
    return {
      claimed: false,
      duplicateWindowCount: 0,
      failedWindowCount: 0,
      identityBlockedWindowCount: 0,
      nextRunAdvanced: false,
      queuedRunCount: 0,
      windowCount: 0,
    };
  }

  const executionIdentity = parseWorkflowExecutionIdentityJson(input.candidate.executionIdentityJson);
  const identityValidation = await validateSchedulerExecutionIdentity({
    executionIdentity,
    organizationId: input.candidate.organizationId,
  });

  let claimed = false;
  let queuedRunCount = 0;
  let failedWindowCount = 0;
  let duplicateWindowCount = 0;
  let identityBlockedWindowCount = 0;
  const db = await getAppDatabase();

  await db.transaction((transaction) => {
    const claimResult = transaction
      .update(workflows)
      .set({
        nextRunAt,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(workflows.id, input.candidate.workflowId),
          eq(workflows.organizationId, input.candidate.organizationId),
          eq(workflows.status, "active"),
          eq(workflows.currentVersionId, input.candidate.workflowVersionId),
          eq(workflows.nextRunAt, input.candidate.nextRunAt),
        ),
      )
      .run();

    if (getMutationChanges(claimResult) <= 0) {
      return;
    }

    claimed = true;

    for (const window of windows) {
      const isIdentityValid = identityValidation.status === "valid";
      const runInsertResult = transaction
        .insert(workflowRuns)
        .values({
          completedAt: isIdentityValid ? null : input.now,
          createdAt: input.now,
          failureReason: isIdentityValid
            ? null
            : `${identityValidation.code}: ${identityValidation.message}`,
          id: randomUUID(),
          metadataJson: JSON.stringify({
            execution_identity_check:
              identityValidation.status === "valid"
                ? {
                    status: "pass",
                  }
                : {
                    code: identityValidation.code,
                    message: identityValidation.message,
                    status: "fail",
                  },
            scheduled_window: {
              end_at: window.windowEndAt,
              start_at: window.windowStartAt,
            },
            scheduler: {
              enqueued_at: input.now,
              request_id: input.requestId,
            },
          }),
          organizationId: input.candidate.organizationId,
          requestId: input.requestId,
          runAsRole: identityValidation.runAsRole,
          runAsUserId: executionIdentity.run_as_user_id,
          startedAt: null,
          status: isIdentityValid ? "queued" : "failed",
          triggerKind: "scheduled",
          triggerWindowKey: window.triggerWindowKey,
          updatedAt: input.now,
          workflowId: input.candidate.workflowId,
          workflowVersionId: input.candidate.workflowVersionId,
        })
        .onConflictDoNothing({
          target: [
            workflowRuns.workflowId,
            workflowRuns.triggerKind,
            workflowRuns.triggerWindowKey,
          ],
        })
        .run();

      if (getMutationChanges(runInsertResult) <= 0) {
        duplicateWindowCount += 1;
        continue;
      }

      if (isIdentityValid) {
        queuedRunCount += 1;
      } else {
        failedWindowCount += 1;
        identityBlockedWindowCount += 1;
      }
    }
  });

  return {
    claimed,
    duplicateWindowCount,
    failedWindowCount,
    identityBlockedWindowCount,
    nextRunAdvanced: claimed,
    queuedRunCount,
    windowCount: windows.length,
  };
}

export async function tickDueWorkflowSchedules(input?: {
  limit?: number;
  now?: number;
  organizationId?: string;
  requestId?: string | null;
}) {
  const gate = getWorkflowSchedulerGateStatus();

  if (!gate.enabled) {
    return {
      backpressureApplied: false,
      claimedWorkflowCount: 0,
      duplicateWindowCount: 0,
      failedWindowCount: 0,
      identityBlockedWindowCount: 0,
      initializedNextRunCount: 0,
      limit: 0,
      nextRunAdvanceCount: 0,
      queuedRunCount: 0,
      scannedWorkflowCount: 0,
      skippedDisabled: true,
      skippedReason: gate.reason,
      wakeRequested: false,
      windowCount: 0,
    } satisfies WorkflowSchedulerTickSummary;
  }

  const now = input?.now ?? Date.now();
  const settings = getWorkflowSchedulerSettings();
  const limit = clampSchedulerLimit(input?.limit, settings.maxWorkflowsPerTick);
  const queuedBefore = await countQueuedWorkflowRuns(input?.organizationId);

  if (queuedBefore >= settings.queueBackpressureLimit) {
    logStructuredEvent("workflow.scheduler_backpressure_applied", {
      organizationId: input?.organizationId ?? null,
      queue_backpressure_limit: settings.queueBackpressureLimit,
      queued_count: queuedBefore,
      routeGroup: "workflow",
      routeKey: "workflow.scheduler.tick",
    });

    return {
      backpressureApplied: true,
      claimedWorkflowCount: 0,
      duplicateWindowCount: 0,
      failedWindowCount: 0,
      identityBlockedWindowCount: 0,
      initializedNextRunCount: 0,
      limit,
      nextRunAdvanceCount: 0,
      queuedRunCount: 0,
      scannedWorkflowCount: 0,
      skippedDisabled: false,
      skippedReason: null,
      wakeRequested: false,
      windowCount: 0,
    } satisfies WorkflowSchedulerTickSummary;
  }

  const initializedNextRunCount = await initializeMissingNextRunAt({
    limit,
    now,
    organizationId: input?.organizationId,
  });
  const dueCandidates = await listDueWorkflowCandidates({
    limit,
    now,
    organizationId: input?.organizationId,
  });

  let claimedWorkflowCount = 0;
  let nextRunAdvanceCount = 0;
  let windowCount = 0;
  let queuedRunCount = 0;
  let failedWindowCount = 0;
  let duplicateWindowCount = 0;
  let identityBlockedWindowCount = 0;

  for (const candidate of dueCandidates) {
    if (candidate.nextRunAt === null) {
      continue;
    }

    try {
      const claimSummary = await claimAndEnqueueScheduledWorkflow({
        candidate: {
          ...candidate,
          nextRunAt: candidate.nextRunAt,
        },
        maxWindowsPerWorkflow: settings.maxWindowsPerWorkflow,
        now,
        requestId: input?.requestId ?? null,
      });

      if (claimSummary.claimed) {
        claimedWorkflowCount += 1;
      }

      if (claimSummary.nextRunAdvanced) {
        nextRunAdvanceCount += 1;
      }

      windowCount += claimSummary.windowCount;
      queuedRunCount += claimSummary.queuedRunCount;
      failedWindowCount += claimSummary.failedWindowCount;
      duplicateWindowCount += claimSummary.duplicateWindowCount;
      identityBlockedWindowCount += claimSummary.identityBlockedWindowCount;
    } catch (caughtError) {
      await moveWorkflowNextRunAfterFailure({
        candidate: {
          ...candidate,
          nextRunAt: candidate.nextRunAt,
        },
        now,
      }).catch(() => undefined);

      logStructuredError("workflow.scheduler_candidate_failed", caughtError, {
        organizationId: candidate.organizationId,
        routeGroup: "workflow",
        routeKey: "workflow.scheduler.tick",
        workflowId: candidate.workflowId,
      });
    }
  }

  const wakeRequested = queuedRunCount > 0;

  if (wakeRequested) {
    ensureWorkflowRunWorkerRunning();
  }

  const summary = {
    backpressureApplied: false,
    claimedWorkflowCount,
    duplicateWindowCount,
    failedWindowCount,
    identityBlockedWindowCount,
    initializedNextRunCount,
    limit,
    nextRunAdvanceCount,
    queuedRunCount,
    scannedWorkflowCount: dueCandidates.length,
    skippedDisabled: false,
    skippedReason: null,
    wakeRequested,
    windowCount,
  } satisfies WorkflowSchedulerTickSummary;

  logStructuredEvent("workflow.scheduler_tick_completed", {
    backpressure_applied: summary.backpressureApplied,
    claimed_workflow_count: summary.claimedWorkflowCount,
    duplicate_window_count: summary.duplicateWindowCount,
    failed_window_count: summary.failedWindowCount,
    identity_blocked_window_count: summary.identityBlockedWindowCount,
    initialized_next_run_count: summary.initializedNextRunCount,
    organizationId: input?.organizationId ?? null,
    queued_run_count: summary.queuedRunCount,
    routeGroup: "workflow",
    routeKey: "workflow.scheduler.tick",
    scanned_workflow_count: summary.scannedWorkflowCount,
    window_count: summary.windowCount,
  });

  return summary;
}
