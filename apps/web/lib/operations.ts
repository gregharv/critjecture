import "server-only";

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth-state";
import { ensureStorageRoot, resolveRepositoryRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  operationalAlerts,
  knowledgeImportJobFiles,
  rateLimitBuckets,
  requestLogs,
  usageEvents,
  users,
} from "@/lib/app-schema";
import {
  BUDGET_WARNING_RATIO,
  CHAT_MAX_TOKENS_HARD_CAP,
  DAILY_MODEL_COST_CAP_USD_ORGANIZATION,
  DAILY_MODEL_COST_CAP_USD_USER,
  DAILY_SANDBOX_RUN_CAP_ORGANIZATION,
  DAILY_SANDBOX_RUN_CAP_USER,
  getBudgetWarningThreshold,
  getOperationsPoliciesSnapshot,
  getRetentionWindowMs,
  getRouteGroupPolicy,
  OPERATIONS_ALERT_RETENTION_DAYS,
  OPERATIONS_REQUEST_LOG_RETENTION_DAYS,
  OPERATIONS_USAGE_RETENTION_DAYS,
  type OperationsRouteGroup,
} from "@/lib/operations-policy";
import type {
  HealthCheckResult,
  HealthSummary,
  OperationsSummaryResponse,
  UsageActorSummary,
} from "@/lib/operations-types";
import { SANDBOX_BWRAP_PATH, SANDBOX_PRLIMIT_PATH } from "@/lib/sandbox-policy";

type RequestOutcome = "blocked" | "error" | "ok" | "rate_limited";

type RequestMetadata = Record<string, unknown>;

type UsageEventInput = {
  costUsd?: number;
  durationMs?: number | null;
  eventType: string;
  inputTokens?: number;
  metadata?: RequestMetadata;
  outputTokens?: number;
  quantity?: number;
  status: string;
  subjectName?: string | null;
  totalTokens?: number;
};

type ObservedRequestContext = {
  method: string;
  requestId: string;
  routeGroup: OperationsRouteGroup;
  routeKey: string;
  startedAt: number;
  user: SessionUser | null;
};

type FinalizeObservedRequestInput = {
  errorCode?: string | null;
  metadata?: RequestMetadata;
  modelName?: string | null;
  outcome: RequestOutcome;
  response: Response;
  sandboxRunId?: string | null;
  toolName?: string | null;
  totalCostUsd?: number | null;
  totalTokens?: number | null;
  usageEvents?: UsageEventInput[];
};

type RateLimitDecision = {
  errorCode: string;
  limit: number;
  scope: "organization" | "user";
  windowMs: number;
};

type BudgetDecision = {
  errorCode: string;
  message: string;
  metadata: RequestMetadata;
};

const ONE_MINUTE_MS = 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * ONE_MINUTE_MS;

let lastMaintenanceAt = 0;

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "failed-to-serialize" });
  }
}

function roundCurrency(value: number) {
  return Number(value.toFixed(6));
}

function buildLogEnvelope(event: string, fields: Record<string, unknown>) {
  return {
    ...fields,
    event,
    timestamp: new Date().toISOString(),
  };
}

function logStructured(event: string, fields: Record<string, unknown>) {
  console.info(safeJsonStringify(buildLogEnvelope(event, fields)));
}

function parseWindowParam(value: string | null | undefined): "24h" | "7d" {
  return value === "7d" ? "7d" : "24h";
}

function getWindowMs(window: "24h" | "7d") {
  return window === "7d" ? 7 * TWENTY_FOUR_HOURS_MS : TWENTY_FOUR_HOURS_MS;
}

function getBucketStartAt(timestamp: number, bucketWidthMs = ONE_MINUTE_MS) {
  return Math.floor(timestamp / bucketWidthMs) * bucketWidthMs;
}

async function pathExists(targetPath: string, mode = fsConstants.F_OK) {
  try {
    await access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}

async function resolvePythonSandboxExecutablePath() {
  const repositoryRoot = await resolveRepositoryRoot();

  return path.join(repositoryRoot, "packages/python-sandbox/.venv/bin/python");
}

async function sendAlertWebhook(payload: Record<string, unknown>) {
  const webhookUrl = (process.env.CRITJECTURE_ALERT_WEBHOOK_URL ?? "").trim();

  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (caughtError) {
    logStructured("operations.alert_webhook_failed", {
      error: caughtError instanceof Error ? caughtError.message : "alert-webhook-failed",
    });
  }
}

async function upsertOperationalAlert(input: {
  alertType: string;
  dedupeKey: string;
  message: string;
  metadata?: RequestMetadata;
  organizationId?: string | null;
  severity: "warning" | "critical";
  title: string;
  userId?: string | null;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const existing = await db.query.operationalAlerts.findFirst({
    where: eq(operationalAlerts.dedupeKey, input.dedupeKey),
  });

  if (!existing) {
    const nextAlert = {
      alertType: input.alertType,
      dedupeKey: input.dedupeKey,
      firstSeenAt: now,
      id: randomUUID(),
      lastSeenAt: now,
      message: input.message,
      metadataJson,
      occurrenceCount: 1,
      organizationId: input.organizationId ?? null,
      resolvedAt: null,
      severity: input.severity,
      status: "open" as const,
      title: input.title,
      userId: input.userId ?? null,
    };

    await db.insert(operationalAlerts).values(nextAlert);
    await sendAlertWebhook({
      action: "opened",
      alert: nextAlert,
    });
    return;
  }

  const shouldNotify = existing.status !== "open" || existing.severity !== input.severity;

  await db
    .update(operationalAlerts)
    .set({
      alertType: input.alertType,
      lastSeenAt: now,
      message: input.message,
      metadataJson,
      occurrenceCount: existing.occurrenceCount + 1,
      organizationId: input.organizationId ?? existing.organizationId ?? null,
      resolvedAt: null,
      severity: input.severity,
      status: "open",
      title: input.title,
      userId: input.userId ?? existing.userId ?? null,
    })
    .where(eq(operationalAlerts.id, existing.id));

  if (shouldNotify) {
    await sendAlertWebhook({
      action: "reopened",
      alertType: input.alertType,
      dedupeKey: input.dedupeKey,
      message: input.message,
      organizationId: input.organizationId ?? null,
      severity: input.severity,
      title: input.title,
      userId: input.userId ?? null,
    });
  }
}

async function resolveOperationalAlert(dedupeKey: string) {
  const db = await getAppDatabase();
  const existing = await db.query.operationalAlerts.findFirst({
    where: eq(operationalAlerts.dedupeKey, dedupeKey),
  });

  if (!existing || existing.status === "resolved") {
    return;
  }

  await db
    .update(operationalAlerts)
    .set({
      resolvedAt: Date.now(),
      status: "resolved",
    })
    .where(eq(operationalAlerts.id, existing.id));
}

async function createRateLimitBucketRecord(input: {
  bucketStartAt: number;
  routeGroup: OperationsRouteGroup;
  scopeId: string;
  scopeType: "organization" | "user";
}) {
  const db = await getAppDatabase();
  const existing = await db.query.rateLimitBuckets.findFirst({
    where: and(
      eq(rateLimitBuckets.routeGroup, input.routeGroup),
      eq(rateLimitBuckets.scopeType, input.scopeType),
      eq(rateLimitBuckets.scopeId, input.scopeId),
      eq(rateLimitBuckets.bucketStartAt, input.bucketStartAt),
      eq(rateLimitBuckets.bucketWidthSeconds, 60),
    ),
  });

  if (!existing) {
    await db.insert(rateLimitBuckets).values({
      bucketStartAt: input.bucketStartAt,
      bucketWidthSeconds: 60,
      id: randomUUID(),
      requestCount: 1,
      routeGroup: input.routeGroup,
      scopeId: input.scopeId,
      scopeType: input.scopeType,
      updatedAt: Date.now(),
    });

    return;
  }

  await db
    .update(rateLimitBuckets)
    .set({
      requestCount: existing.requestCount + 1,
      updatedAt: Date.now(),
    })
    .where(eq(rateLimitBuckets.id, existing.id));
}

async function sumRateLimitRequests(input: {
  routeGroup: OperationsRouteGroup;
  scopeId: string;
  scopeType: "organization" | "user";
  windowMs: number;
}) {
  const db = await getAppDatabase();
  const since = getBucketStartAt(Date.now() - input.windowMs + ONE_MINUTE_MS);
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${rateLimitBuckets.requestCount}), 0)`,
    })
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.routeGroup, input.routeGroup),
        eq(rateLimitBuckets.scopeType, input.scopeType),
        eq(rateLimitBuckets.scopeId, input.scopeId),
        eq(rateLimitBuckets.bucketWidthSeconds, 60),
        gte(rateLimitBuckets.bucketStartAt, since),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}

async function getModelUsageTotals(input: {
  organizationId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const since = Date.now() - TWENTY_FOUR_HOURS_MS;
  const [userRows, organizationRows] = await Promise.all([
    db
      .select({
        costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.eventType, "model_completion"),
          eq(usageEvents.userId, input.userId),
          gte(usageEvents.createdAt, since),
        ),
      ),
    db
      .select({
        costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.eventType, "model_completion"),
          eq(usageEvents.organizationId, input.organizationId),
          gte(usageEvents.createdAt, since),
        ),
      ),
  ]);

  return {
    organizationCostUsd: Number(organizationRows[0]?.costUsd ?? 0),
    userCostUsd: Number(userRows[0]?.costUsd ?? 0),
  };
}

async function getSandboxUsageTotals(input: {
  organizationId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const since = Date.now() - TWENTY_FOUR_HOURS_MS;
  const [userRows, organizationRows] = await Promise.all([
    db
      .select({
        quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.eventType, "sandbox_run"),
          eq(usageEvents.userId, input.userId),
          gte(usageEvents.createdAt, since),
        ),
      ),
    db
      .select({
        quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.eventType, "sandbox_run"),
          eq(usageEvents.organizationId, input.organizationId),
          gte(usageEvents.createdAt, since),
        ),
      ),
  ]);

  return {
    organizationQuantity: Number(organizationRows[0]?.quantity ?? 0),
    userQuantity: Number(userRows[0]?.quantity ?? 0),
  };
}

async function evaluateBudgetAlerts(user: SessionUser) {
  const modelTotals = await getModelUsageTotals({
    organizationId: user.organizationId,
    userId: user.id,
  });
  const sandboxTotals = await getSandboxUsageTotals({
    organizationId: user.organizationId,
    userId: user.id,
  });

  const modelUserWarningKey = `budget:model:user:${user.id}:warning`;
  const modelUserCriticalKey = `budget:model:user:${user.id}:critical`;
  const modelOrgWarningKey = `budget:model:org:${user.organizationId}:warning`;
  const modelOrgCriticalKey = `budget:model:org:${user.organizationId}:critical`;
  const sandboxUserWarningKey = `budget:sandbox:user:${user.id}:warning`;
  const sandboxUserCriticalKey = `budget:sandbox:user:${user.id}:critical`;
  const sandboxOrgWarningKey = `budget:sandbox:org:${user.organizationId}:warning`;
  const sandboxOrgCriticalKey = `budget:sandbox:org:${user.organizationId}:critical`;

  const modelUserWarning = modelTotals.userCostUsd >= getBudgetWarningThreshold(DAILY_MODEL_COST_CAP_USD_USER);
  const modelUserCritical = modelTotals.userCostUsd >= DAILY_MODEL_COST_CAP_USD_USER;
  const modelOrgWarning =
    modelTotals.organizationCostUsd >=
    getBudgetWarningThreshold(DAILY_MODEL_COST_CAP_USD_ORGANIZATION);
  const modelOrgCritical =
    modelTotals.organizationCostUsd >= DAILY_MODEL_COST_CAP_USD_ORGANIZATION;
  const sandboxUserWarning =
    sandboxTotals.userQuantity >= getBudgetWarningThreshold(DAILY_SANDBOX_RUN_CAP_USER);
  const sandboxUserCritical = sandboxTotals.userQuantity >= DAILY_SANDBOX_RUN_CAP_USER;
  const sandboxOrgWarning =
    sandboxTotals.organizationQuantity >=
    getBudgetWarningThreshold(DAILY_SANDBOX_RUN_CAP_ORGANIZATION);
  const sandboxOrgCritical =
    sandboxTotals.organizationQuantity >= DAILY_SANDBOX_RUN_CAP_ORGANIZATION;

  if (modelUserWarning) {
    await upsertOperationalAlert({
      alertType: "budget-warning",
      dedupeKey: modelUserWarningKey,
      message: `User daily model spend is ${roundCurrency(modelTotals.userCostUsd)} USD against a ${DAILY_MODEL_COST_CAP_USD_USER} USD cap.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "User Model Budget Warning",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(modelUserWarningKey);
  }

  if (modelUserCritical) {
    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: modelUserCriticalKey,
      message: `User daily model spend reached ${roundCurrency(modelTotals.userCostUsd)} USD.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "User Model Budget Exhausted",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(modelUserCriticalKey);
  }

  if (modelOrgWarning) {
    await upsertOperationalAlert({
      alertType: "budget-warning",
      dedupeKey: modelOrgWarningKey,
      message: `Organization daily model spend is ${roundCurrency(modelTotals.organizationCostUsd)} USD against a ${DAILY_MODEL_COST_CAP_USD_ORGANIZATION} USD cap.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "Organization Model Budget Warning",
    });
  } else {
    await resolveOperationalAlert(modelOrgWarningKey);
  }

  if (modelOrgCritical) {
    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: modelOrgCriticalKey,
      message: `Organization daily model spend reached ${roundCurrency(modelTotals.organizationCostUsd)} USD.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "Organization Model Budget Exhausted",
    });
  } else {
    await resolveOperationalAlert(modelOrgCriticalKey);
  }

  if (sandboxUserWarning) {
    await upsertOperationalAlert({
      alertType: "budget-warning",
      dedupeKey: sandboxUserWarningKey,
      message: `User daily sandbox runs are ${sandboxTotals.userQuantity} against a ${DAILY_SANDBOX_RUN_CAP_USER} run cap.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "User Sandbox Budget Warning",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(sandboxUserWarningKey);
  }

  if (sandboxUserCritical) {
    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: sandboxUserCriticalKey,
      message: `User daily sandbox runs reached ${sandboxTotals.userQuantity}.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "User Sandbox Budget Exhausted",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(sandboxUserCriticalKey);
  }

  if (sandboxOrgWarning) {
    await upsertOperationalAlert({
      alertType: "budget-warning",
      dedupeKey: sandboxOrgWarningKey,
      message: `Organization daily sandbox runs are ${sandboxTotals.organizationQuantity} against a ${DAILY_SANDBOX_RUN_CAP_ORGANIZATION} run cap.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "Organization Sandbox Budget Warning",
    });
  } else {
    await resolveOperationalAlert(sandboxOrgWarningKey);
  }

  if (sandboxOrgCritical) {
    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: sandboxOrgCriticalKey,
      message: `Organization daily sandbox runs reached ${sandboxTotals.organizationQuantity}.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "Organization Sandbox Budget Exhausted",
    });
  } else {
    await resolveOperationalAlert(sandboxOrgCriticalKey);
  }
}

async function evaluateDynamicAlerts(input: {
  errorCode: string | null;
  routeGroup: OperationsRouteGroup;
  user: SessionUser | null;
}) {
  const db = await getAppDatabase();
  const since = Date.now() - 10 * ONE_MINUTE_MS;
  const organizationId = input.user?.organizationId ?? null;

  const fiveHundredRows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.routeGroup, input.routeGroup),
        organizationId
          ? eq(requestLogs.organizationId, organizationId)
          : isNull(requestLogs.organizationId),
        gte(requestLogs.completedAt, since),
        gte(requestLogs.statusCode, 500),
      ),
    );
  const fiveHundredCount = Number(fiveHundredRows[0]?.count ?? 0);
  const fiveHundredAlertKey = `burst:5xx:${organizationId ?? "anonymous"}:${input.routeGroup}`;

  if (fiveHundredCount >= 3) {
    await upsertOperationalAlert({
      alertType: "error-burst",
      dedupeKey: fiveHundredAlertKey,
      message: `${fiveHundredCount} server failures were recorded for ${input.routeGroup} in the last 10 minutes.`,
      organizationId,
      severity: "critical",
      title: "Server Error Burst",
      userId: input.user?.id ?? null,
    });
  } else {
    await resolveOperationalAlert(fiveHundredAlertKey);
  }

  const rateLimitedRows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.routeGroup, input.routeGroup),
        organizationId
          ? eq(requestLogs.organizationId, organizationId)
          : isNull(requestLogs.organizationId),
        gte(requestLogs.completedAt, since),
        eq(requestLogs.statusCode, 429),
      ),
    );
  const rateLimitedCount = Number(rateLimitedRows[0]?.count ?? 0);
  const rateLimitedAlertKey = `burst:429:${organizationId ?? "anonymous"}:${input.routeGroup}`;

  if (rateLimitedCount >= 5) {
    await upsertOperationalAlert({
      alertType: "rate-limit-burst",
      dedupeKey: rateLimitedAlertKey,
      message: `${rateLimitedCount} rate-limited requests were recorded for ${input.routeGroup} in the last 10 minutes.`,
      organizationId,
      severity: "warning",
      title: "Rate Limit Burst",
      userId: input.user?.id ?? null,
    });
  } else {
    await resolveOperationalAlert(rateLimitedAlertKey);
  }

  if (input.routeGroup !== "sandbox") {
    return;
  }

  const sandboxBurstRows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.routeGroup, "sandbox"),
        organizationId
          ? eq(requestLogs.organizationId, organizationId)
          : isNull(requestLogs.organizationId),
        gte(requestLogs.completedAt, since),
        or(
          eq(requestLogs.errorCode, "sandbox_timed_out"),
          eq(requestLogs.errorCode, "sandbox_admission_rejected"),
        ),
      ),
    );
  const sandboxBurstCount = Number(sandboxBurstRows[0]?.count ?? 0);
  const sandboxAlertKey = `burst:sandbox:${organizationId ?? "anonymous"}`;

  if (sandboxBurstCount >= 3) {
    await upsertOperationalAlert({
      alertType: "sandbox-burst",
      dedupeKey: sandboxAlertKey,
      message: `${sandboxBurstCount} sandbox timeout or rejection events were recorded in the last 10 minutes.`,
      organizationId,
      severity: "critical",
      title: "Sandbox Failure Burst",
      userId: input.user?.id ?? null,
    });
  } else {
    await resolveOperationalAlert(sandboxAlertKey);
  }
}

export async function runOperationsMaintenance() {
  const now = Date.now();

  if (now - lastMaintenanceAt < ONE_MINUTE_MS) {
    return;
  }

  lastMaintenanceAt = now;
  const db = await getAppDatabase();
  const requestLogCutoff = now - getRetentionWindowMs(OPERATIONS_REQUEST_LOG_RETENTION_DAYS);
  const usageCutoff = now - getRetentionWindowMs(OPERATIONS_USAGE_RETENTION_DAYS);
  const bucketCutoff = now - 2 * TWENTY_FOUR_HOURS_MS;
  const alertCutoff = now - getRetentionWindowMs(OPERATIONS_ALERT_RETENTION_DAYS);

  await Promise.all([
    db.delete(requestLogs).where(lt(requestLogs.completedAt, requestLogCutoff)),
    db.delete(usageEvents).where(lt(usageEvents.createdAt, usageCutoff)),
    db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.updatedAt, bucketCutoff)),
    db
      .delete(operationalAlerts)
      .where(
        and(
          eq(operationalAlerts.status, "resolved"),
          lt(operationalAlerts.lastSeenAt, alertCutoff),
        ),
      ),
  ]);
}

export function beginObservedRequest(input: {
  method: string;
  routeGroup: OperationsRouteGroup;
  routeKey: string;
  user: SessionUser | null;
}) {
  const context: ObservedRequestContext = {
    method: input.method,
    requestId: randomUUID(),
    routeGroup: input.routeGroup,
    routeKey: input.routeKey,
    startedAt: Date.now(),
    user: input.user,
  };

  logStructured("operations.request_start", {
    method: context.method,
    organizationId: context.user?.organizationId ?? null,
    requestId: context.requestId,
    routeGroup: context.routeGroup,
    routeKey: context.routeKey,
    userId: context.user?.id ?? null,
  });

  return context;
}

export function attachRequestId(response: Response, requestId: string) {
  response.headers.set("x-critjecture-request-id", requestId);
  return response;
}

export async function finalizeObservedRequest(
  context: ObservedRequestContext,
  input: FinalizeObservedRequestInput,
) {
  const db = await getAppDatabase();
  const completedAt = Date.now();
  const durationMs = completedAt - context.startedAt;
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const requestLogId = randomUUID();

  await db.insert(requestLogs).values({
    completedAt,
    durationMs,
    errorCode: input.errorCode ?? null,
    id: requestLogId,
    metadataJson,
    method: context.method,
    modelName: input.modelName ?? null,
    organizationId: context.user?.organizationId ?? null,
    outcome: input.outcome,
    requestId: context.requestId,
    routeGroup: context.routeGroup,
    routeKey: context.routeKey,
    sandboxRunId: input.sandboxRunId ?? null,
    startedAt: context.startedAt,
    statusCode: input.response.status,
    toolName: input.toolName ?? null,
    totalCostUsd: input.totalCostUsd ?? null,
    totalTokens: input.totalTokens ?? null,
    userId: context.user?.id ?? null,
  });

  for (const usageEvent of input.usageEvents ?? []) {
    await db.insert(usageEvents).values({
      costUsd: usageEvent.costUsd ?? 0,
      createdAt: completedAt,
      durationMs: usageEvent.durationMs ?? null,
      eventType: usageEvent.eventType,
      id: randomUUID(),
      inputTokens: usageEvent.inputTokens ?? 0,
      metadataJson: JSON.stringify(usageEvent.metadata ?? {}),
      organizationId: context.user?.organizationId ?? null,
      outputTokens: usageEvent.outputTokens ?? 0,
      quantity: usageEvent.quantity ?? 0,
      requestLogId,
      routeGroup: context.routeGroup,
      routeKey: context.routeKey,
      status: usageEvent.status,
      subjectName: usageEvent.subjectName ?? null,
      totalTokens: usageEvent.totalTokens ?? 0,
      userId: context.user?.id ?? null,
    });
  }

  logStructured("operations.request_finish", {
    durationMs,
    errorCode: input.errorCode ?? null,
    method: context.method,
    modelName: input.modelName ?? null,
    organizationId: context.user?.organizationId ?? null,
    outcome: input.outcome,
    requestId: context.requestId,
    routeGroup: context.routeGroup,
    routeKey: context.routeKey,
    sandboxRunId: input.sandboxRunId ?? null,
    statusCode: input.response.status,
    toolName: input.toolName ?? null,
    totalCostUsd: input.totalCostUsd ?? null,
    totalTokens: input.totalTokens ?? null,
    userId: context.user?.id ?? null,
  });

  if (context.user) {
    await evaluateBudgetAlerts(context.user);
  }

  await evaluateDynamicAlerts({
    errorCode: input.errorCode ?? null,
    routeGroup: context.routeGroup,
    user: context.user,
  });

  attachRequestId(input.response, context.requestId);

  return input.response;
}

export async function enforceRateLimitPolicy(input: {
  routeGroup: OperationsRouteGroup;
  user: SessionUser;
}) {
  const policy = getRouteGroupPolicy(input.routeGroup);
  const now = Date.now();
  let blockedDecision: RateLimitDecision | null = null;

  for (const rateLimit of policy.rateLimits) {
    const scopeId =
      rateLimit.scope === "user" ? input.user.id : input.user.organizationId;
    const currentCount = await sumRateLimitRequests({
      routeGroup: input.routeGroup,
      scopeId,
      scopeType: rateLimit.scope,
      windowMs: rateLimit.windowMs,
    });

    if (currentCount >= rateLimit.maxRequests) {
      blockedDecision = {
        errorCode: `rate_limit_${rateLimit.scope}_${Math.floor(rateLimit.windowMs / ONE_MINUTE_MS)}m`,
        limit: rateLimit.maxRequests,
        scope: rateLimit.scope,
        windowMs: rateLimit.windowMs,
      };
      break;
    }
  }

  if (blockedDecision) {
    return blockedDecision;
  }

  for (const rateLimit of policy.rateLimits) {
    const scopeId =
      rateLimit.scope === "user" ? input.user.id : input.user.organizationId;
    await createRateLimitBucketRecord({
      bucketStartAt: getBucketStartAt(now),
      routeGroup: input.routeGroup,
      scopeId,
      scopeType: rateLimit.scope,
    });
  }

  return null;
}

export async function enforceBudgetPolicy(input: {
  routeGroup: OperationsRouteGroup;
  user: SessionUser;
}) {
  if (input.routeGroup === "chat") {
    const totals = await getModelUsageTotals({
      organizationId: input.user.organizationId,
      userId: input.user.id,
    });

    if (totals.userCostUsd >= DAILY_MODEL_COST_CAP_USD_USER) {
      const decision: BudgetDecision = {
        errorCode: "budget_model_user_exhausted",
        message: "Daily user model budget exhausted. Try again after the rolling 24-hour window drops below the cap.",
        metadata: {
          capUsd: DAILY_MODEL_COST_CAP_USD_USER,
          currentUsd: roundCurrency(totals.userCostUsd),
          warningRatio: BUDGET_WARNING_RATIO,
        },
      };

      await upsertOperationalAlert({
        alertType: "budget-exhausted",
        dedupeKey: `budget:model:user:${input.user.id}:critical`,
        message: `User daily model spend reached ${roundCurrency(totals.userCostUsd)} USD.`,
        organizationId: input.user.organizationId,
        severity: "critical",
        title: "User Model Budget Exhausted",
        userId: input.user.id,
      });

      return decision;
    }

    if (totals.organizationCostUsd >= DAILY_MODEL_COST_CAP_USD_ORGANIZATION) {
      const decision: BudgetDecision = {
        errorCode: "budget_model_organization_exhausted",
        message: "Organization daily model budget exhausted. Try again after the rolling 24-hour window drops below the cap.",
        metadata: {
          capUsd: DAILY_MODEL_COST_CAP_USD_ORGANIZATION,
          currentUsd: roundCurrency(totals.organizationCostUsd),
          warningRatio: BUDGET_WARNING_RATIO,
        },
      };

      await upsertOperationalAlert({
        alertType: "budget-exhausted",
        dedupeKey: `budget:model:org:${input.user.organizationId}:critical`,
        message: `Organization daily model spend reached ${roundCurrency(totals.organizationCostUsd)} USD.`,
        organizationId: input.user.organizationId,
        severity: "critical",
        title: "Organization Model Budget Exhausted",
      });

      return decision;
    }

    return null;
  }

  if (input.routeGroup !== "sandbox") {
    return null;
  }

  const totals = await getSandboxUsageTotals({
    organizationId: input.user.organizationId,
    userId: input.user.id,
  });

  if (totals.userQuantity >= DAILY_SANDBOX_RUN_CAP_USER) {
    const decision: BudgetDecision = {
      errorCode: "budget_sandbox_user_exhausted",
      message: "Daily user sandbox run budget exhausted. Try again after the rolling 24-hour window drops below the cap.",
      metadata: {
        capRuns: DAILY_SANDBOX_RUN_CAP_USER,
        currentRuns: totals.userQuantity,
        warningRatio: BUDGET_WARNING_RATIO,
      },
    };

    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: `budget:sandbox:user:${input.user.id}:critical`,
      message: `User daily sandbox runs reached ${totals.userQuantity}.`,
      organizationId: input.user.organizationId,
      severity: "critical",
      title: "User Sandbox Budget Exhausted",
      userId: input.user.id,
    });

    return decision;
  }

  if (totals.organizationQuantity >= DAILY_SANDBOX_RUN_CAP_ORGANIZATION) {
    const decision: BudgetDecision = {
      errorCode: "budget_sandbox_organization_exhausted",
      message: "Organization daily sandbox run budget exhausted. Try again after the rolling 24-hour window drops below the cap.",
      metadata: {
        capRuns: DAILY_SANDBOX_RUN_CAP_ORGANIZATION,
        currentRuns: totals.organizationQuantity,
        warningRatio: BUDGET_WARNING_RATIO,
      },
    };

    await upsertOperationalAlert({
      alertType: "budget-exhausted",
      dedupeKey: `budget:sandbox:org:${input.user.organizationId}:critical`,
      message: `Organization daily sandbox runs reached ${totals.organizationQuantity}.`,
      organizationId: input.user.organizationId,
      severity: "critical",
      title: "Organization Sandbox Budget Exhausted",
    });

    return decision;
  }

  return null;
}

export function buildObservedErrorResponse(
  message: string,
  status: number,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      error: message,
      ...(details ?? {}),
    },
    { status },
  );
}

export function clampChatMaxTokens(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return undefined;
  }

  return Math.min(Math.trunc(value), CHAT_MAX_TOKENS_HARD_CAP);
}

export async function getHealthSummary(): Promise<HealthSummary> {
  const checks: HealthCheckResult[] = [];
  const now = Date.now();

  try {
    const db = await getAppDatabase();
    await db.run(sql`select 1`);
    checks.push({
      detail: "SQLite database is reachable.",
      name: "database",
      status: "ok",
    });
  } catch (caughtError) {
    checks.push({
      detail:
        caughtError instanceof Error ? caughtError.message : "Failed to open SQLite database.",
      name: "database",
      status: "fail",
    });
  }

  try {
    const storageRoot = await ensureStorageRoot();
    await access(storageRoot, fsConstants.R_OK | fsConstants.W_OK);
    checks.push({
      detail: `Storage root is writable at ${storageRoot}.`,
      name: "storage",
      status: "ok",
    });
  } catch (caughtError) {
    checks.push({
      detail:
        caughtError instanceof Error ? caughtError.message : "Storage root is unavailable.",
      name: "storage",
      status: "fail",
    });
  }

  const pythonExecutable = await resolvePythonSandboxExecutablePath();
  const sandboxDeps = [
    SANDBOX_BWRAP_PATH,
    SANDBOX_PRLIMIT_PATH,
    pythonExecutable,
  ];
  const missingSandboxDeps: string[] = [];

  for (const dependencyPath of sandboxDeps) {
    if (!(await pathExists(dependencyPath, fsConstants.X_OK))) {
      missingSandboxDeps.push(dependencyPath);
    }
  }

  if (missingSandboxDeps.length > 0) {
    checks.push({
      detail: `Sandbox dependencies missing: ${missingSandboxDeps.join(", ")}.`,
      name: "sandbox",
      status: "degraded",
    });
  } else {
    checks.push({
      detail: "Sandbox host dependencies are present.",
      name: "sandbox",
      status: "ok",
    });
  }

  try {
    const db = await getAppDatabase();
    const staleCutoff = now - 5 * ONE_MINUTE_MS;
    const [queuedRows, staleRows] = await Promise.all([
      db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(knowledgeImportJobFiles)
        .where(eq(knowledgeImportJobFiles.stage, "queued")),
      db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(knowledgeImportJobFiles)
        .where(
          and(
            inArray(knowledgeImportJobFiles.stage, ["validating", "extracting", "chunking", "indexing"]),
            lt(knowledgeImportJobFiles.updatedAt, staleCutoff),
          ),
        ),
    ]);
    const queuedCount = Number(queuedRows[0]?.count ?? 0);
    const staleCount = Number(staleRows[0]?.count ?? 0);

    if (staleCount > 0) {
      checks.push({
        detail: `${staleCount} import file${staleCount === 1 ? "" : "s"} appear stalled.`,
        name: "knowledge-imports",
        status: "degraded",
      });
    } else {
      checks.push({
        detail:
          queuedCount > 0
            ? `${queuedCount} import file${queuedCount === 1 ? "" : "s"} queued for ingestion.`
            : "No queued or stale knowledge imports.",
        name: "knowledge-imports",
        status: "ok",
      });
    }
  } catch (caughtError) {
    checks.push({
      detail:
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to inspect knowledge import status.",
      name: "knowledge-imports",
      status: "degraded",
    });
  }

  const hasFail = checks.some((check) => check.status === "fail");
  const hasDegraded = checks.some((check) => check.status === "degraded");

  return {
    checks,
    status: hasFail ? "fail" : hasDegraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
  };
}

export async function getOperationsSummary(input: {
  organizationId: string;
  windowParam: string | null | undefined;
}): Promise<OperationsSummaryResponse> {
  const db = await getAppDatabase();
  const window = parseWindowParam(input.windowParam);
  const since = Date.now() - getWindowMs(window);
  const health = await getHealthSummary();

  const [alerts, routeMetrics, usageByRouteGroup, usageByEventType, byUser, recentFailures, rateLimitActivity] =
    await Promise.all([
      db.query.operationalAlerts.findMany({
        limit: 20,
        orderBy: [desc(operationalAlerts.severity), desc(operationalAlerts.lastSeenAt)],
        where: and(
          eq(operationalAlerts.status, "open"),
          or(
            eq(operationalAlerts.organizationId, input.organizationId),
            isNull(operationalAlerts.organizationId),
          ),
        ),
      }),
      db
        .select({
          avgDurationMs: sql<number>`coalesce(avg(${requestLogs.durationMs}), 0)`,
          errorCount: sql<number>`coalesce(sum(case when ${requestLogs.statusCode} >= 500 then 1 else 0 end), 0)`,
          rateLimitedCount: sql<number>`coalesce(sum(case when ${requestLogs.statusCode} = 429 then 1 else 0 end), 0)`,
          requestCount: sql<number>`count(*)`,
          routeGroup: requestLogs.routeGroup,
          successCount: sql<number>`coalesce(sum(case when ${requestLogs.statusCode} between 200 and 399 then 1 else 0 end), 0)`,
        })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.organizationId, input.organizationId),
            gte(requestLogs.startedAt, since),
          ),
        )
        .groupBy(requestLogs.routeGroup),
      db
        .select({
          costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
          eventType: sql<string>`'all'`,
          outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
          quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
          requestCount: sql<number>`count(*)`,
          routeGroup: usageEvents.routeGroup,
          totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)`,
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, input.organizationId),
            gte(usageEvents.createdAt, since),
          ),
        )
        .groupBy(usageEvents.routeGroup),
      db
        .select({
          costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
          eventType: usageEvents.eventType,
          outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
          quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
          requestCount: sql<number>`count(*)`,
          routeGroup: usageEvents.routeGroup,
          totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)`,
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, input.organizationId),
            gte(usageEvents.createdAt, since),
          ),
        )
        .groupBy(usageEvents.routeGroup, usageEvents.eventType),
      db
        .select({
          costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
          email: users.email,
          name: users.name,
          outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
          quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
          requestCount: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)`,
          userId: usageEvents.userId,
        })
        .from(usageEvents)
        .leftJoin(users, eq(users.id, usageEvents.userId))
        .where(
          and(
            eq(usageEvents.organizationId, input.organizationId),
            gte(usageEvents.createdAt, since),
          ),
        )
        .groupBy(usageEvents.userId, users.email, users.name),
      db
        .select({
          completedAt: requestLogs.completedAt,
          errorCode: requestLogs.errorCode,
          outcome: requestLogs.outcome,
          requestId: requestLogs.requestId,
          routeGroup: requestLogs.routeGroup,
          routeKey: requestLogs.routeKey,
          statusCode: requestLogs.statusCode,
          toolName: requestLogs.toolName,
          userEmail: users.email,
        })
        .from(requestLogs)
        .leftJoin(users, eq(users.id, requestLogs.userId))
        .where(
          and(
            eq(requestLogs.organizationId, input.organizationId),
            gte(requestLogs.startedAt, since),
            or(eq(requestLogs.statusCode, 429), gte(requestLogs.statusCode, 500)),
          ),
        )
        .orderBy(desc(requestLogs.completedAt))
        .limit(12),
      db
        .select({
          count: sql<number>`count(*)`,
          routeGroup: requestLogs.routeGroup,
        })
        .from(requestLogs)
        .where(
          and(
            eq(requestLogs.organizationId, input.organizationId),
            gte(requestLogs.startedAt, since),
            eq(requestLogs.statusCode, 429),
          ),
        )
        .groupBy(requestLogs.routeGroup),
    ]);

  const byUserSummary: UsageActorSummary[] = byUser
    .filter((row) => typeof row.userId === "string" && row.userId.length > 0)
    .map((row) => ({
      costUsd: Number(row.costUsd ?? 0),
      name: row.name || row.email || "Unknown user",
      outputTokens: Number(row.outputTokens ?? 0),
      quantity: Number(row.quantity ?? 0),
      requestCount: Number(row.requestCount ?? 0),
      totalTokens: Number(row.totalTokens ?? 0),
      userId: row.userId as string,
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens);

  return {
    alerts: alerts.map((alert) => ({
      alertType: alert.alertType,
      id: alert.id,
      lastSeenAt: alert.lastSeenAt,
      message: alert.message,
      occurrenceCount: alert.occurrenceCount,
      severity: alert.severity as "warning" | "critical",
      status: alert.status as "open" | "resolved",
      title: alert.title,
    })),
    health,
    policies: getOperationsPoliciesSnapshot(),
    rateLimitActivity: rateLimitActivity.map((row) => ({
      count: Number(row.count ?? 0),
      routeGroup: row.routeGroup as OperationsRouteGroup,
    })),
    recentFailures: recentFailures.map((row) => ({
      completedAt: row.completedAt,
      errorCode: row.errorCode,
      outcome: row.outcome,
      requestId: row.requestId,
      routeGroup: row.routeGroup as OperationsRouteGroup,
      routeKey: row.routeKey,
      statusCode: row.statusCode,
      toolName: row.toolName,
      userEmail: row.userEmail,
    })),
    routeMetrics: routeMetrics.map((row) => ({
      avgDurationMs: Number(row.avgDurationMs ?? 0),
      errorCount: Number(row.errorCount ?? 0),
      rateLimitedCount: Number(row.rateLimitedCount ?? 0),
      requestCount: Number(row.requestCount ?? 0),
      routeGroup: row.routeGroup as OperationsRouteGroup,
      successCount: Number(row.successCount ?? 0),
    })),
    usageSummary: {
      byEventType: usageByEventType.map((row) => ({
        costUsd: Number(row.costUsd ?? 0),
        eventType: row.eventType,
        outputTokens: Number(row.outputTokens ?? 0),
        quantity: Number(row.quantity ?? 0),
        requestCount: Number(row.requestCount ?? 0),
        routeGroup: row.routeGroup as OperationsRouteGroup,
        totalTokens: Number(row.totalTokens ?? 0),
      })),
      byRouteGroup: usageByRouteGroup.map((row) => ({
        costUsd: Number(row.costUsd ?? 0),
        eventType: row.eventType,
        outputTokens: Number(row.outputTokens ?? 0),
        quantity: Number(row.quantity ?? 0),
        requestCount: Number(row.requestCount ?? 0),
        routeGroup: row.routeGroup as OperationsRouteGroup,
        totalTokens: Number(row.totalTokens ?? 0),
      })),
      byUser: byUserSummary,
      window,
    },
  };
}

export function buildRateLimitMessage(decision: RateLimitDecision) {
  return `Rate limit exceeded for ${decision.scope} scope. Allowed ${decision.limit} request(s) every ${Math.round(
    decision.windowMs / ONE_MINUTE_MS,
  )} minute(s).`;
}

export function buildBudgetExceededResponse(decision: BudgetDecision) {
  return buildObservedErrorResponse(decision.message, 429, {
    ...decision.metadata,
    status: "blocked",
  });
}

export function buildRateLimitedResponse(decision: RateLimitDecision) {
  return buildObservedErrorResponse(buildRateLimitMessage(decision), 429, {
    limit: decision.limit,
    scope: decision.scope,
    status: "rate_limited",
    windowMs: decision.windowMs,
  });
}
