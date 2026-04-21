import "server-only";

import { and, asc, desc, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/legacy-app-db";
import {
  workflowDeliveries,
  workflowInputRequests,
  workflowRunInputChecks,
  workflowRuns,
  workflowRunSteps,
  workflowVersions,
  workflows,
} from "@/lib/legacy-app-schema";
import {
  parseWorkflowJsonRecord,
  parseWorkflowJsonStringArray,
  parseWorkflowRunInputCheckReportJson,
  type WorkflowDeliveryChannelKind,
  type WorkflowDeliveryStatus,
  type WorkflowInputRequestStatus,
  type WorkflowRunInputCheckReportV1,
  type WorkflowRunStatus,
  type WorkflowRunStepStatus,
  type WorkflowRunTriggerKind,
} from "@/lib/workflow-types";

export type WorkflowRunRecord = {
  completedAt: number | null;
  createdAt: number;
  failureReason: string | null;
  id: string;
  metadata: Record<string, unknown>;
  organizationId: string;
  requestId: string | null;
  runAsRole: "member" | "admin" | "owner";
  runAsUserId: string | null;
  startedAt: number | null;
  status: WorkflowRunStatus;
  triggerKind: WorkflowRunTriggerKind;
  triggerWindowKey: string | null;
  updatedAt: number;
  workflowId: string;
  workflowVersionId: string;
  workflowVersionNumber: number | null;
};

export type WorkflowRunInputCheckRecord = {
  createdAt: number;
  id: string;
  inputKey: string;
  report: WorkflowRunInputCheckReportV1;
  runId: string;
  status: "pass" | "warn" | "fail";
  updatedAt: number;
};

export type WorkflowInputRequestRecord = {
  createdAt: number;
  expiresAt: number | null;
  fulfilledAt: number | null;
  id: string;
  message: string | null;
  notificationChannels: string[];
  requestedInputKeys: string[];
  runId: string;
  sentAt: number | null;
  status: WorkflowInputRequestStatus;
  updatedAt: number;
  workflowId: string;
};

export type WorkflowRunStepRecord = {
  completedAt: number | null;
  createdAt: number;
  errorMessage: string | null;
  id: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  runId: string;
  sandboxRunId: string | null;
  startedAt: number | null;
  status: WorkflowRunStepStatus;
  stepKey: string;
  stepOrder: number;
  toolName: string;
  updatedAt: number;
};

export type WorkflowRunDeliveryRecord = {
  artifactManifest: unknown[];
  attemptNumber: number;
  channelKind: WorkflowDeliveryChannelKind;
  createdAt: number;
  errorMessage: string | null;
  id: string;
  nextRetryAt: number | null;
  payloadSnapshot: Record<string, unknown>;
  responseBody: string | null;
  responseStatusCode: number | null;
  runId: string;
  sentAt: number | null;
  status: WorkflowDeliveryStatus;
  updatedAt: number;
};

type WorkflowRunRow = {
  completedAt: number | null;
  createdAt: number;
  failureReason: string | null;
  id: string;
  metadataJson: string;
  organizationId: string;
  requestId: string | null;
  runAsRole: "member" | "admin" | "owner";
  runAsUserId: string | null;
  startedAt: number | null;
  status: WorkflowRunStatus;
  triggerKind: WorkflowRunTriggerKind;
  triggerWindowKey: string | null;
  updatedAt: number;
  workflowId: string;
  workflowVersionId: string;
  workflowVersionNumber: number | null;
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

function mapWorkflowRunRow(row: WorkflowRunRow) {
  return {
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    failureReason: row.failureReason,
    id: row.id,
    metadata: parseWorkflowJsonRecord(row.metadataJson),
    organizationId: row.organizationId,
    requestId: row.requestId,
    runAsRole: row.runAsRole,
    runAsUserId: row.runAsUserId,
    startedAt: row.startedAt,
    status: row.status,
    triggerKind: row.triggerKind,
    triggerWindowKey: row.triggerWindowKey,
    updatedAt: row.updatedAt,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    workflowVersionNumber: row.workflowVersionNumber,
  } satisfies WorkflowRunRecord;
}

function parseWorkflowJsonArray(value: string | null | undefined): unknown[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function listWorkflowRuns(input: {
  limit?: number;
  organizationId: string;
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      completedAt: workflowRuns.completedAt,
      createdAt: workflowRuns.createdAt,
      failureReason: workflowRuns.failureReason,
      id: workflowRuns.id,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      requestId: workflowRuns.requestId,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      startedAt: workflowRuns.startedAt,
      status: workflowRuns.status,
      triggerKind: workflowRuns.triggerKind,
      triggerWindowKey: workflowRuns.triggerWindowKey,
      updatedAt: workflowRuns.updatedAt,
      workflowId: workflowRuns.workflowId,
      workflowVersionId: workflowRuns.workflowVersionId,
      workflowVersionNumber: workflowVersions.versionNumber,
    })
    .from(workflowRuns)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
      ),
    )
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.updatedAt))
    .limit(limit);

  return {
    runs: rows.map(mapWorkflowRunRow),
  };
}

async function loadWorkflowRunRow(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      completedAt: workflowRuns.completedAt,
      createdAt: workflowRuns.createdAt,
      failureReason: workflowRuns.failureReason,
      id: workflowRuns.id,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      requestId: workflowRuns.requestId,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      startedAt: workflowRuns.startedAt,
      status: workflowRuns.status,
      triggerKind: workflowRuns.triggerKind,
      triggerWindowKey: workflowRuns.triggerWindowKey,
      updatedAt: workflowRuns.updatedAt,
      workflowId: workflowRuns.workflowId,
      workflowVersionId: workflowRuns.workflowVersionId,
      workflowVersionNumber: workflowVersions.versionNumber,
    })
    .from(workflowRuns)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function getWorkflowRunById(input: {
  organizationId: string;
  runId: string;
}) {
  const row = await loadWorkflowRunRow(input);
  return row ? mapWorkflowRunRow(row) : null;
}

export async function listWorkflowRunInputChecks(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db.query.workflowRunInputChecks.findMany({
    orderBy: [desc(workflowRunInputChecks.updatedAt), desc(workflowRunInputChecks.createdAt)],
    where: and(
      eq(workflowRunInputChecks.organizationId, input.organizationId),
      eq(workflowRunInputChecks.runId, input.runId),
    ),
  });

  return {
    checks: rows.map((row) => ({
      createdAt: row.createdAt,
      id: row.id,
      inputKey: row.inputKey,
      report: parseWorkflowRunInputCheckReportJson(row.reportJson),
      runId: row.runId,
      status: row.status,
      updatedAt: row.updatedAt,
    })) satisfies WorkflowRunInputCheckRecord[],
  };
}

export async function listWorkflowRunInputRequests(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db.query.workflowInputRequests.findMany({
    orderBy: [desc(workflowInputRequests.updatedAt), desc(workflowInputRequests.createdAt)],
    where: and(
      eq(workflowInputRequests.organizationId, input.organizationId),
      eq(workflowInputRequests.runId, input.runId),
    ),
  });

  return {
    requests: rows.map((row) => ({
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      fulfilledAt: row.fulfilledAt,
      id: row.id,
      message: row.message,
      notificationChannels: parseWorkflowJsonStringArray(row.notificationChannelsJson),
      requestedInputKeys: parseWorkflowJsonStringArray(row.requestedInputKeysJson),
      runId: row.runId,
      sentAt: row.sentAt,
      status: row.status,
      updatedAt: row.updatedAt,
      workflowId: row.workflowId,
    })) satisfies WorkflowInputRequestRecord[],
  };
}

export async function listWorkflowRunSteps(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db.query.workflowRunSteps.findMany({
    orderBy: [asc(workflowRunSteps.stepOrder), asc(workflowRunSteps.createdAt)],
    where: and(
      eq(workflowRunSteps.organizationId, input.organizationId),
      eq(workflowRunSteps.runId, input.runId),
    ),
  });

  return {
    steps: rows.map((row) => ({
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      errorMessage: row.errorMessage,
      id: row.id,
      input: parseWorkflowJsonRecord(row.inputJson),
      output: parseWorkflowJsonRecord(row.outputJson),
      runId: row.runId,
      sandboxRunId: row.sandboxRunId,
      startedAt: row.startedAt,
      status: row.status,
      stepKey: row.stepKey,
      stepOrder: row.stepOrder,
      toolName: row.toolName,
      updatedAt: row.updatedAt,
    })) satisfies WorkflowRunStepRecord[],
  };
}

export async function listWorkflowRunDeliveries(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db.query.workflowDeliveries.findMany({
    orderBy: [asc(workflowDeliveries.attemptNumber), asc(workflowDeliveries.createdAt)],
    where: and(
      eq(workflowDeliveries.organizationId, input.organizationId),
      eq(workflowDeliveries.runId, input.runId),
    ),
  });

  return {
    deliveries: rows.map((row) => ({
      artifactManifest: parseWorkflowJsonArray(row.artifactManifestJson),
      attemptNumber: row.attemptNumber,
      channelKind: row.channelKind,
      createdAt: row.createdAt,
      errorMessage: row.errorMessage,
      id: row.id,
      nextRetryAt: row.nextRetryAt,
      payloadSnapshot: parseWorkflowJsonRecord(row.payloadSnapshotJson),
      responseBody: row.responseBody,
      responseStatusCode: row.responseStatusCode,
      runId: row.runId,
      sentAt: row.sentAt,
      status: row.status,
      updatedAt: row.updatedAt,
    })) satisfies WorkflowRunDeliveryRecord[],
  };
}

export async function getPreviousWorkflowRun(input: {
  createdBefore: number;
  organizationId: string;
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      completedAt: workflowRuns.completedAt,
      createdAt: workflowRuns.createdAt,
      failureReason: workflowRuns.failureReason,
      id: workflowRuns.id,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      requestId: workflowRuns.requestId,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      startedAt: workflowRuns.startedAt,
      status: workflowRuns.status,
      triggerKind: workflowRuns.triggerKind,
      triggerWindowKey: workflowRuns.triggerWindowKey,
      updatedAt: workflowRuns.updatedAt,
      workflowId: workflowRuns.workflowId,
      workflowVersionId: workflowRuns.workflowVersionId,
      workflowVersionNumber: workflowVersions.versionNumber,
    })
    .from(workflowRuns)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        lt(workflowRuns.createdAt, input.createdBefore),
      ),
    )
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.updatedAt))
    .limit(1);

  const row = rows[0] ?? null;

  return row ? mapWorkflowRunRow(row) : null;
}

export async function enqueueScheduledWorkflowRun(input: {
  organizationId: string;
  requestId?: string | null;
  runAsRole: "member" | "admin" | "owner";
  runAsUserId: string;
  triggerWindowKey: string;
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, input.workflowId),
      eq(workflows.organizationId, input.organizationId),
    ),
  });

  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  if (workflow.status !== "active") {
    throw new Error("Only active workflows can enqueue scheduled runs.");
  }

  if (!workflow.currentVersionId) {
    throw new Error("Workflow does not have an active version to run.");
  }

  const now = Date.now();
  const runId = randomUUID();
  const insertResult = await db
    .insert(workflowRuns)
    .values({
      completedAt: null,
      createdAt: now,
      failureReason: null,
      id: runId,
      metadataJson: JSON.stringify({
        queued_by_role: input.runAsRole,
        queued_by_user_id: input.runAsUserId,
        trigger_window_key: input.triggerWindowKey,
      }),
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
      runAsRole: input.runAsRole,
      runAsUserId: input.runAsUserId,
      startedAt: null,
      status: "queued",
      triggerKind: "scheduled",
      triggerWindowKey: input.triggerWindowKey,
      updatedAt: now,
      workflowId: workflow.id,
      workflowVersionId: workflow.currentVersionId,
    })
    .onConflictDoNothing({
      target: [
        workflowRuns.workflowId,
        workflowRuns.triggerKind,
        workflowRuns.triggerWindowKey,
      ],
    })
    .run();

  const created = getMutationChanges(insertResult) > 0;
  const rows = await db
    .select({
      completedAt: workflowRuns.completedAt,
      createdAt: workflowRuns.createdAt,
      failureReason: workflowRuns.failureReason,
      id: workflowRuns.id,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      requestId: workflowRuns.requestId,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      startedAt: workflowRuns.startedAt,
      status: workflowRuns.status,
      triggerKind: workflowRuns.triggerKind,
      triggerWindowKey: workflowRuns.triggerWindowKey,
      updatedAt: workflowRuns.updatedAt,
      workflowId: workflowRuns.workflowId,
      workflowVersionId: workflowRuns.workflowVersionId,
      workflowVersionNumber: workflowVersions.versionNumber,
    })
    .from(workflowRuns)
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.triggerKind, "scheduled"),
        eq(workflowRuns.triggerWindowKey, input.triggerWindowKey),
      ),
    )
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.updatedAt))
    .limit(1);

  const row = rows[0] ?? null;

  if (!row) {
    throw new Error("Failed to load scheduled workflow run.");
  }

  return {
    created,
    run: mapWorkflowRunRow(row),
  };
}

export async function createManualWorkflowRun(input: {
  organizationId: string;
  requestId?: string | null;
  runAsRole: "admin" | "owner";
  runAsUserId: string;
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const workflow = await db.query.workflows.findFirst({
    where: and(
      eq(workflows.id, input.workflowId),
      eq(workflows.organizationId, input.organizationId),
    ),
  });

  if (!workflow) {
    throw new Error("Workflow not found.");
  }

  if (workflow.status === "archived") {
    throw new Error("Archived workflows cannot be run.");
  }

  if (!workflow.currentVersionId) {
    throw new Error("Workflow does not have an active version to run.");
  }

  const now = Date.now();
  const runId = randomUUID();

  await db.insert(workflowRuns).values({
    completedAt: null,
    createdAt: now,
    failureReason: null,
    id: runId,
    metadataJson: JSON.stringify({
      queued_by_role: input.runAsRole,
      queued_by_user_id: input.runAsUserId,
    }),
    organizationId: input.organizationId,
    requestId: input.requestId ?? null,
    runAsRole: input.runAsRole,
    runAsUserId: input.runAsUserId,
    startedAt: null,
    status: "queued",
    triggerKind: "manual",
    triggerWindowKey: null,
    updatedAt: now,
    workflowId: workflow.id,
    workflowVersionId: workflow.currentVersionId,
  });

  const row = await loadWorkflowRunRow({
    organizationId: input.organizationId,
    runId,
  });

  if (!row) {
    throw new Error("Failed to load created workflow run.");
  }

  return mapWorkflowRunRow(row);
}
