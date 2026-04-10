import "server-only";

import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  organizations,
  workflowDeliveries,
  workflowInputRequests,
  workflowRunInputChecks,
  workflowRuns,
  workflowRunSteps,
} from "@/lib/app-schema";
import { getWorkflowSchedulerGateStatus } from "@/lib/workflow-flags";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import { parseWorkflowJsonRecord } from "@/lib/workflow-types";

type ClaimedWorkflowRun = {
  organizationId: string;
  organizationSlug: string;
  runId: string;
};

export type WorkflowRunWorkerSweepSummary = {
  claimedCount: number;
  failedCount: number;
  idle: boolean;
  limit: number;
  maxConcurrency: number;
  reclaimedCount: number;
  succeededCount: number;
};

type WorkerSettings = {
  maxConcurrency: number;
  maxRunsPerSweep: number;
  staleRunMs: number;
};

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_RUNS_PER_SWEEP = 20;
const DEFAULT_STALE_RUN_MINUTES = 45;
const OPEN_INPUT_REQUEST_STATUSES = ["open", "sent"] as const;

let workflowWorkerPromise: Promise<void> | null = null;
let workflowWorkerWakeRequested = false;

function parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getWorkerSettings(): WorkerSettings {
  const maxConcurrency = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_WORKER_MAX_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY,
  );
  const maxRunsPerSweep = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_WORKER_MAX_RUNS_PER_SWEEP,
    DEFAULT_MAX_RUNS_PER_SWEEP,
  );
  const staleRunMinutes = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_WORKER_STALE_RUN_MINUTES,
    DEFAULT_STALE_RUN_MINUTES,
  );

  return {
    maxConcurrency,
    maxRunsPerSweep: Math.max(maxConcurrency, maxRunsPerSweep),
    staleRunMs: staleRunMinutes * 60 * 1000,
  };
}

function getMutationChanges(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return 0;
  }

  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }

  return 0;
}

function buildReconciledMetadata(input: {
  metadataJson: string;
  reason: string;
}) {
  const metadata = parseWorkflowJsonRecord(input.metadataJson);

  return JSON.stringify({
    ...metadata,
    worker_reconciliation: {
      reason: input.reason,
      reconciled_at: Date.now(),
    },
  });
}

async function reclaimStaleRunningWorkflowRuns(input?: {
  organizationId?: string;
  staleRunMs?: number;
}) {
  const db = await getAppDatabase();
  const staleRunMs = input?.staleRunMs ?? getWorkerSettings().staleRunMs;
  const staleCutoff = Date.now() - staleRunMs;
  const staleRows = await db.query.workflowRuns.findMany({
    where: input?.organizationId
      ? and(
          eq(workflowRuns.status, "running"),
          eq(workflowRuns.organizationId, input.organizationId),
          lt(workflowRuns.updatedAt, staleCutoff),
        )
      : and(eq(workflowRuns.status, "running"), lt(workflowRuns.updatedAt, staleCutoff)),
  });

  let reclaimedCount = 0;

  for (const staleRow of staleRows) {
    const now = Date.now();
    const metadataJson = buildReconciledMetadata({
      metadataJson: staleRow.metadataJson,
      reason: "stale_running_requeued",
    });

    await db.transaction((transaction) => {
      const updateResult = transaction
        .update(workflowRuns)
        .set({
          completedAt: null,
          failureReason: null,
          metadataJson,
          startedAt: null,
          status: "queued",
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowRuns.organizationId, staleRow.organizationId),
            eq(workflowRuns.id, staleRow.id),
            eq(workflowRuns.status, "running"),
          ),
        )
        .run();

      if (getMutationChanges(updateResult) <= 0) {
        return;
      }

      transaction
        .delete(workflowRunSteps)
        .where(
          and(
            eq(workflowRunSteps.organizationId, staleRow.organizationId),
            eq(workflowRunSteps.runId, staleRow.id),
          ),
        )
        .run();

      transaction
        .delete(workflowRunInputChecks)
        .where(
          and(
            eq(workflowRunInputChecks.organizationId, staleRow.organizationId),
            eq(workflowRunInputChecks.runId, staleRow.id),
          ),
        )
        .run();

      transaction
        .update(workflowInputRequests)
        .set({
          message: "Cancelled by workflow worker reconciliation after stale running state.",
          status: "cancelled",
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowInputRequests.organizationId, staleRow.organizationId),
            eq(workflowInputRequests.runId, staleRow.id),
            inArray(workflowInputRequests.status, OPEN_INPUT_REQUEST_STATUSES),
          ),
        )
        .run();

      transaction
        .delete(workflowDeliveries)
        .where(
          and(
            eq(workflowDeliveries.organizationId, staleRow.organizationId),
            eq(workflowDeliveries.runId, staleRow.id),
            eq(workflowDeliveries.status, "pending"),
          ),
        )
        .run();

      reclaimedCount += 1;
    });
  }

  if (reclaimedCount > 0) {
    logStructuredEvent("workflow.worker_reclaimed_stale_runs", {
      reclaimed_count: reclaimedCount,
      routeGroup: "workflow",
      routeKey: "workflow.worker.reconcile",
    });
  }

  return reclaimedCount;
}

async function claimNextQueuedWorkflowRun(input?: {
  organizationId?: string;
}) {
  const schedulerGate = getWorkflowSchedulerGateStatus();
  const allowedTriggerKinds = schedulerGate.enabled
    ? (["manual", "scheduled", "resume"] as const)
    : (["manual", "resume"] as const);
  const db = await getAppDatabase();
  const rows = await db
    .select({
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      organizationSlug: organizations.slug,
      runId: workflowRuns.id,
    })
    .from(workflowRuns)
    .innerJoin(organizations, eq(organizations.id, workflowRuns.organizationId))
    .where(
      input?.organizationId
        ? and(
            eq(workflowRuns.status, "queued"),
            eq(workflowRuns.organizationId, input.organizationId),
            inArray(workflowRuns.triggerKind, allowedTriggerKinds),
          )
        : and(
            eq(workflowRuns.status, "queued"),
            inArray(workflowRuns.triggerKind, allowedTriggerKinds),
          ),
    )
    .orderBy(asc(workflowRuns.createdAt), asc(workflowRuns.updatedAt))
    .limit(5);

  if (rows.length === 0) {
    return null;
  }

  for (const row of rows) {
    const now = Date.now();
    const metadata = parseWorkflowJsonRecord(row.metadataJson);
    const updateResult = await db
      .update(workflowRuns)
      .set({
        metadataJson: JSON.stringify({
          ...metadata,
          worker_claim: {
            claimed_at: now,
            worker_instance: process.pid,
          },
        }),
        startedAt: now,
        status: "running",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.organizationId, row.organizationId),
          eq(workflowRuns.id, row.runId),
          eq(workflowRuns.status, "queued"),
        ),
      )
      .run();

    if (getMutationChanges(updateResult) > 0) {
      return {
        organizationId: row.organizationId,
        organizationSlug: row.organizationSlug,
        runId: row.runId,
      } satisfies ClaimedWorkflowRun;
    }
  }

  return null;
}

async function processClaimedWorkflowRun(claimedRun: ClaimedWorkflowRun) {
  try {
    const execution = await executeWorkflowRun({
      organizationId: claimedRun.organizationId,
      organizationSlug: claimedRun.organizationSlug,
      runId: claimedRun.runId,
    });

    logStructuredEvent("workflow.worker_run_processed", {
      routeGroup: "workflow",
      routeKey: "workflow.worker.execute",
      status: execution.status,
      workflowRunId: claimedRun.runId,
    });

    return {
      ok: execution.status !== "failed",
      status: execution.status,
    } as const;
  } catch (caughtError) {
    logStructuredError("workflow.worker_run_failed", caughtError, {
      organizationId: claimedRun.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.worker.execute",
      workflowRunId: claimedRun.runId,
    });

    const db = await getAppDatabase();
    const now = Date.now();

    await db
      .update(workflowRuns)
      .set({
        completedAt: now,
        failureReason:
          caughtError instanceof Error
            ? `worker_execution_failed: ${caughtError.message}`
            : "worker_execution_failed",
        status: "failed",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowRuns.organizationId, claimedRun.organizationId),
          eq(workflowRuns.id, claimedRun.runId),
          inArray(workflowRuns.status, ["running", "queued"]),
        ),
      );

    return {
      ok: false,
      status: "failed",
    } as const;
  }
}

export async function processWorkflowRunQueueOnce(input?: {
  limit?: number;
  organizationId?: string;
}) {
  const settings = getWorkerSettings();
  const limit =
    typeof input?.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(1, Math.trunc(input.limit))
      : settings.maxRunsPerSweep;
  const reclaimedCount = await reclaimStaleRunningWorkflowRuns({
    organizationId: input?.organizationId,
    staleRunMs: settings.staleRunMs,
  });

  let claimedCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  while (claimedCount < limit) {
    const remainingSlots = Math.max(0, settings.maxConcurrency);

    if (remainingSlots <= 0) {
      break;
    }

    const batch: ClaimedWorkflowRun[] = [];

    while (batch.length < remainingSlots && claimedCount + batch.length < limit) {
      const claimedRun = await claimNextQueuedWorkflowRun({
        organizationId: input?.organizationId,
      });

      if (!claimedRun) {
        break;
      }

      batch.push(claimedRun);
    }

    if (batch.length === 0) {
      break;
    }

    claimedCount += batch.length;
    const results = await Promise.all(batch.map((run) => processClaimedWorkflowRun(run)));

    for (const result of results) {
      if (result.ok) {
        succeededCount += 1;
      } else {
        failedCount += 1;
      }
    }
  }

  return {
    claimedCount,
    failedCount,
    idle: claimedCount === 0,
    limit,
    maxConcurrency: settings.maxConcurrency,
    reclaimedCount,
    succeededCount,
  } satisfies WorkflowRunWorkerSweepSummary;
}

async function runWorkflowWorkerLoop() {
  try {
    while (true) {
      workflowWorkerWakeRequested = false;
      const summary = await processWorkflowRunQueueOnce();

      if (summary.idle && !workflowWorkerWakeRequested) {
        break;
      }
    }
  } finally {
    workflowWorkerPromise = null;

    if (workflowWorkerWakeRequested) {
      ensureWorkflowRunWorkerRunning();
    }
  }
}

export function ensureWorkflowRunWorkerRunning() {
  workflowWorkerWakeRequested = true;

  if (!workflowWorkerPromise) {
    workflowWorkerPromise = runWorkflowWorkerLoop().catch((caughtError) => {
      logStructuredError("workflow.worker_loop_failed", caughtError, {
        routeGroup: "workflow",
        routeKey: "workflow.worker.loop",
      });
    });
  }
}
