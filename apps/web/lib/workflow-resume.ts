import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { organizations, workflowRuns } from "@/lib/legacy-app-schema";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import { expireStaleWorkflowInputRequests } from "@/lib/workflow-notifications";

const DEFAULT_RECHECK_LIMIT = 25;
const DEFAULT_ENQUEUED_ORG_RECHECK_LIMIT = 10;

const pendingOrganizationRechecks = new Set<string>();
let queuedRecheckWorker: Promise<void> | null = null;

type WaitingRunCandidate = {
  organizationId: string;
  organizationSlug: string;
  runId: string;
};

export type WorkflowWaitingRunRecheckSummary = {
  attemptedCount: number;
  blockedValidationCount: number;
  completedCount: number;
  failedCount: number;
  limit: number;
  organizationId: string | null;
  scannedCount: number;
  skippedCount: number;
  waitingCount: number;
};

function parsePositiveInteger(input: number | undefined, fallback: number) {
  if (!Number.isFinite(input) || typeof input !== "number") {
    return fallback;
  }

  return Math.max(1, Math.trunc(input));
}

async function loadWaitingRuns(input: {
  limit: number;
  organizationId?: string;
}): Promise<WaitingRunCandidate[]> {
  const db = await getAppDatabase();
  const whereClause = input.organizationId
    ? and(
        eq(workflowRuns.status, "waiting_for_input"),
        eq(workflowRuns.organizationId, input.organizationId),
      )
    : eq(workflowRuns.status, "waiting_for_input");

  return db
    .select({
      organizationId: workflowRuns.organizationId,
      organizationSlug: organizations.slug,
      runId: workflowRuns.id,
    })
    .from(workflowRuns)
    .innerJoin(organizations, eq(organizations.id, workflowRuns.organizationId))
    .where(whereClause)
    .orderBy(asc(workflowRuns.updatedAt), asc(workflowRuns.createdAt))
    .limit(input.limit);
}

function getUpdateChanges(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return 0;
  }

  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }

  return 0;
}

async function claimWaitingRunForRecheck(run: WaitingRunCandidate) {
  const db = await getAppDatabase();
  const result = db
    .update(workflowRuns)
    .set({
      status: "queued",
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(workflowRuns.organizationId, run.organizationId),
        eq(workflowRuns.id, run.runId),
        eq(workflowRuns.status, "waiting_for_input"),
      ),
    )
    .run();

  return getUpdateChanges(result) > 0;
}

export async function recheckWaitingWorkflowRuns(input?: {
  limit?: number;
  organizationId?: string;
}) {
  const limit = parsePositiveInteger(input?.limit, DEFAULT_RECHECK_LIMIT);

  await expireStaleWorkflowInputRequests({
    organizationId: input?.organizationId,
  });

  const waitingRuns = await loadWaitingRuns({
    limit,
    organizationId: input?.organizationId,
  });
  const summary: WorkflowWaitingRunRecheckSummary = {
    attemptedCount: 0,
    blockedValidationCount: 0,
    completedCount: 0,
    failedCount: 0,
    limit,
    organizationId: input?.organizationId ?? null,
    scannedCount: waitingRuns.length,
    skippedCount: 0,
    waitingCount: 0,
  };

  for (const waitingRun of waitingRuns) {
    const claimed = await claimWaitingRunForRecheck(waitingRun);

    if (!claimed) {
      continue;
    }

    summary.attemptedCount += 1;

    try {
      const execution = await executeWorkflowRun({
        organizationId: waitingRun.organizationId,
        organizationSlug: waitingRun.organizationSlug,
        runId: waitingRun.runId,
      });

      if (execution.status === "completed") {
        summary.completedCount += 1;
      } else if (execution.status === "skipped") {
        summary.skippedCount += 1;
      } else if (execution.status === "waiting_for_input") {
        summary.waitingCount += 1;
      } else if (execution.status === "blocked_validation") {
        summary.blockedValidationCount += 1;
      } else {
        summary.failedCount += 1;
      }
    } catch (caughtError) {
      summary.failedCount += 1;

      logStructuredError("workflow.waiting_run_recheck_failed", caughtError, {
        organizationId: waitingRun.organizationId,
        routeGroup: "workflow",
        routeKey: "workflow.waiting_run.recheck",
        workflowRunId: waitingRun.runId,
      });
    }
  }

  logStructuredEvent("workflow.waiting_run_recheck_finished", {
    blocked_validation_count: summary.blockedValidationCount,
    completed_count: summary.completedCount,
    failed_count: summary.failedCount,
    organizationId: summary.organizationId,
    routeGroup: "workflow",
    routeKey: "workflow.waiting_run.recheck",
    scanned_count: summary.scannedCount,
    skipped_count: summary.skippedCount,
    waiting_count: summary.waitingCount,
  });

  return summary;
}

function ensureQueuedWorkflowRecheckWorkerRunning() {
  if (!queuedRecheckWorker) {
    queuedRecheckWorker = runQueuedWorkflowRechecks().catch((caughtError) => {
      logStructuredError("workflow.waiting_run_recheck_worker_failed", caughtError, {
        routeGroup: "workflow",
        routeKey: "workflow.waiting_run.recheck_worker",
      });
    });
  }
}

async function runQueuedWorkflowRechecks() {
  try {
    while (pendingOrganizationRechecks.size > 0) {
      const nextOrganizationIds = [...pendingOrganizationRechecks];
      pendingOrganizationRechecks.clear();

      for (const organizationId of nextOrganizationIds) {
        try {
          await recheckWaitingWorkflowRuns({
            limit: DEFAULT_ENQUEUED_ORG_RECHECK_LIMIT,
            organizationId,
          });
        } catch (caughtError) {
          logStructuredError("workflow.waiting_run_queued_recheck_failed", caughtError, {
            organizationId,
            routeGroup: "workflow",
            routeKey: "workflow.waiting_run.recheck_queue",
          });
        }
      }
    }
  } finally {
    queuedRecheckWorker = null;

    if (pendingOrganizationRechecks.size > 0) {
      ensureQueuedWorkflowRecheckWorkerRunning();
    }
  }
}

export function enqueueWorkflowWaitingRunRecheck(input: {
  organizationId: string;
}) {
  const normalizedOrganizationId = input.organizationId.trim();

  if (!normalizedOrganizationId) {
    return;
  }

  pendingOrganizationRechecks.add(normalizedOrganizationId);
  ensureQueuedWorkflowRecheckWorkerRunning();
}
