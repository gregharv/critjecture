import "server-only";

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth-state";
import { ensureStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/legacy-app-db";
import { cleanupExpiredAnalysisResults } from "@/lib/analysis-results";
import {
  operationalAlerts,
  knowledgeImportJobFiles,
  organizationMemberships,
  organizations,
  rateLimitBuckets,
  requestLogs,
  usageEvents,
  users,
  workflowDeliveries,
  workflowRuns,
  workflowVersions,
  workflows,
  workspaceCommercialLedger,
} from "@/lib/legacy-app-schema";
import {
  getFallbackOperationsRetentionDefaults,
  getOrganizationRetentionOverrides,
  runGovernanceMaintenance,
} from "@/lib/governance";
import { getHostedDeploymentValidation } from "@/lib/hosted-deployment";
import {
  getKnowledgeSearchToolchainHealth,
  getPdfIngestionToolchainHealth,
} from "@/lib/runtime-toolchain";
import {
  CHAT_MAX_TOKENS_HARD_CAP,
  getOperationsPoliciesSnapshot,
  getRetentionWindowMs,
  getRouteGroupPolicy,
  type RateLimitedRouteGroup,
  type OperationsRouteGroup,
} from "@/lib/operations-policy";
import { getRuntimePersistenceSnapshot } from "@/lib/persistence-policy";
import type {
  CommercialBlockSummary,
  HealthCheckResult,
  HealthSummary,
  OperationsSummaryResponse,
  UsageActorSummary,
} from "@/lib/operations-types";
import {
  logStructuredError,
  logStructuredEvent,
  mergeCorrelationFields,
  type CorrelationFields,
} from "@/lib/observability";
import { getSandboxBackendHealth } from "@/lib/python-sandbox";
import { getSandboxHealthSnapshot } from "@/lib/sandbox-runs";
import { parseWorkflowScheduleJson } from "@/lib/workflow-types";
import {
  getCommercialUsageClassForRoute,
  getOrganizationMembershipCommercialPolicy,
  getWorkspaceCommercialUsageSnapshot,
  getWorkspacePlanSummary,
  type CommercialUsageClass,
} from "@/lib/workspace-plans";

type RequestOutcome = "blocked" | "error" | "ok" | "rate_limited";

type RequestMetadata = Record<string, unknown>;

type UsageEventInput = {
  commercialCredits?: number;
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
  usageClass?: CommercialUsageClass | "search" | "system";
};

type ObservedRequestContext = {
  correlation: CorrelationFields;
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
  governanceJobId?: string | null;
  knowledgeImportJobId?: string | null;
  runtimeToolCallId?: string | null;
  sandboxRunId?: string | null;
  toolName?: string | null;
  turnId?: string | null;
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
  metadata: CommercialBlockSummary;
};

const ONE_MINUTE_MS = 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * ONE_MINUTE_MS;

let lastMaintenanceAt = 0;

function parseWindowParam(value: string | null | undefined): "24h" | "7d" {
  return value === "7d" ? "7d" : "24h";
}

function parseMetadataJson(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getWindowMs(window: "24h" | "7d") {
  return window === "7d" ? 7 * TWENTY_FOUR_HOURS_MS : TWENTY_FOUR_HOURS_MS;
}

function getBucketStartAt(timestamp: number, bucketWidthMs = ONE_MINUTE_MS) {
  return Math.floor(timestamp / bucketWidthMs) * bucketWidthMs;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
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
    logStructuredError("operations.alert_webhook_failed", caughtError);
  }
}

function getAlertWebhookPayload(input: {
  action: "opened" | "reopened" | "resolved";
  alertType: string;
  dedupeKey: string;
  message: string;
  metadata?: RequestMetadata;
  organizationId?: string | null;
  severity: "warning" | "critical";
  title: string;
  userId?: string | null;
}) {
  const correlation = mergeCorrelationFields(
    input.metadata as CorrelationFields | undefined,
    {
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
    },
  );

  return {
    action: input.action,
    alertType: input.alertType,
    dedupeKey: input.dedupeKey,
    message: input.message,
    metadata: input.metadata ?? {},
    severity: input.severity,
    timestamp: new Date().toISOString(),
    title: input.title,
    ...correlation,
  };
}

export async function upsertOperationalAlert(input: {
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
    await sendAlertWebhook(
      getAlertWebhookPayload({
        action: "opened",
        ...input,
      }),
    );
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
    await sendAlertWebhook(
      getAlertWebhookPayload({
        action: "reopened",
        ...input,
      }),
    );
  }
}

export async function resolveOperationalAlert(
  dedupeKey: string,
  metadata?: RequestMetadata,
) {
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

  await sendAlertWebhook(
    getAlertWebhookPayload({
      action: "resolved",
      alertType: existing.alertType,
      dedupeKey,
      message: existing.message,
      metadata: metadata ?? parseMetadataJson(existing.metadataJson),
      organizationId: existing.organizationId ?? null,
      severity: existing.severity as "warning" | "critical",
      title: existing.title,
      userId: existing.userId ?? null,
    }),
  );
}

async function createRateLimitBucketRecord(input: {
  bucketStartAt: number;
  routeGroup: RateLimitedRouteGroup;
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
  routeGroup: RateLimitedRouteGroup;
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

const COMMERCIAL_WARNING_RATIO = 0.8;

function getCommercialWarningThreshold(limit: number) {
  return Math.max(0, Math.floor(limit * COMMERCIAL_WARNING_RATIO));
}

function inferUsageClassForRequest(input: {
  routeGroup: OperationsRouteGroup;
  routeKey: string;
}) {
  const commercialUsageClass = getCommercialUsageClassForRoute(input);

  if (commercialUsageClass) {
    return commercialUsageClass;
  }

  if (input.routeGroup === "search") {
    return "search" as const;
  }

  return "system" as const;
}

function buildCreditExhaustedErrorCode(scope: "user" | "workspace", usageClass: CommercialUsageClass) {
  return `credit_${usageClass}_${scope}_exhausted`;
}

async function createCommercialLedgerEntry(input: {
  creditsDelta: number;
  metadata?: RequestMetadata;
  organizationId: string;
  requestId: string;
  routeGroup: OperationsRouteGroup;
  status: "blocked" | "reserved";
  usageClass: CommercialUsageClass;
  userId: string;
  windowEndAt: number;
  windowStartAt: number;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(workspaceCommercialLedger).values({
    createdAt: now,
    creditsDelta: input.creditsDelta,
    id: randomUUID(),
    metadataJson: JSON.stringify(input.metadata ?? {}),
    organizationId: input.organizationId,
    requestId: input.requestId,
    requestLogId: null,
    routeGroup: input.routeGroup,
    status: input.status,
    updatedAt: now,
    usageClass: input.usageClass,
    userId: input.userId,
    windowEndAt: input.windowEndAt,
    windowStartAt: input.windowStartAt,
  });
}

async function getCommercialLedgerEntry(requestId: string) {
  const db = await getAppDatabase();
  return db.query.workspaceCommercialLedger.findFirst({
    where: eq(workspaceCommercialLedger.requestId, requestId),
  });
}

async function finalizeCommercialLedgerEntry(input: {
  outcome: RequestOutcome;
  requestId: string;
  requestLogId: string;
}) {
  const db = await getAppDatabase();
  const existing = await getCommercialLedgerEntry(input.requestId);

  if (!existing) {
    return null;
  }

  const nextStatus =
    existing.status === "reserved"
      ? input.outcome === "ok"
        ? "committed"
        : "released"
      : existing.status;

  await db
    .update(workspaceCommercialLedger)
    .set({
      requestLogId: input.requestLogId,
      status: nextStatus,
      updatedAt: Date.now(),
    })
    .where(eq(workspaceCommercialLedger.id, existing.id));

  return {
    creditsDelta: existing.creditsDelta,
    status: nextStatus,
    usageClass: existing.usageClass,
  };
}

async function evaluateBudgetAlerts(user: SessionUser) {
  const plan = await getWorkspacePlanSummary(user.organizationId);
  const workspaceUsage = await getWorkspaceCommercialUsageSnapshot({
    organizationId: user.organizationId,
  });
  const membershipPolicy = await getOrganizationMembershipCommercialPolicy({
    organizationId: user.organizationId,
    userId: user.id,
  });
  const userUsage = await getWorkspaceCommercialUsageSnapshot({
    organizationId: user.organizationId,
    userId: user.id,
  });

  const workspaceWarningKey = `credits:workspace:${user.organizationId}:warning`;
  const workspaceCriticalKey = `credits:workspace:${user.organizationId}:critical`;
  const workspaceWarning =
    workspaceUsage.usedCredits + workspaceUsage.pendingCredits >=
    getCommercialWarningThreshold(plan.monthlyIncludedCredits);
  const workspaceCritical =
    workspaceUsage.usedCredits + workspaceUsage.pendingCredits >= plan.monthlyIncludedCredits;

  if (workspaceWarning) {
    await upsertOperationalAlert({
      alertType: "credit-warning",
      dedupeKey: workspaceWarningKey,
      message: `Workspace credit usage is ${workspaceUsage.usedCredits + workspaceUsage.pendingCredits} of ${plan.monthlyIncludedCredits} credits for ${plan.planName}.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "Workspace Credit Warning",
    });
  } else {
    await resolveOperationalAlert(workspaceWarningKey);
  }

  if (workspaceCritical) {
    await upsertOperationalAlert({
      alertType: "credit-exhausted",
      dedupeKey: workspaceCriticalKey,
      message: `Workspace credits are exhausted for ${plan.planName}.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "Workspace Credit Exhausted",
    });
  } else {
    await resolveOperationalAlert(workspaceCriticalKey);
  }

  const memberCap = membershipPolicy?.monthlyCreditCap ?? null;
  const memberWarningKey = `credits:user:${user.id}:warning`;
  const memberCriticalKey = `credits:user:${user.id}:critical`;
  const userConsumed = userUsage.usedCredits + userUsage.pendingCredits;
  const memberWarning = typeof memberCap === "number" && userConsumed >= getCommercialWarningThreshold(memberCap);
  const memberCritical = typeof memberCap === "number" && userConsumed >= memberCap;

  if (memberWarning && typeof memberCap === "number") {
    await upsertOperationalAlert({
      alertType: "credit-warning",
      dedupeKey: memberWarningKey,
      message: `Member credit usage is ${userConsumed} of ${memberCap} credits this billing window.`,
      organizationId: user.organizationId,
      severity: "warning",
      title: "Member Credit Warning",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(memberWarningKey);
  }

  if (memberCritical && typeof memberCap === "number") {
    await upsertOperationalAlert({
      alertType: "credit-exhausted",
      dedupeKey: memberCriticalKey,
      message: `Member monthly credit cap of ${memberCap} has been exhausted.`,
      organizationId: user.organizationId,
      severity: "critical",
      title: "Member Credit Exhausted",
      userId: user.id,
    });
  } else {
    await resolveOperationalAlert(memberCriticalKey);
  }
}

async function evaluateDynamicAlerts(input: {
  errorCode: string | null;
  metadata?: RequestMetadata;
  requestId: string;
  routeKey: string;
  routeGroup: OperationsRouteGroup;
  sandboxRunId?: string | null;
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
      metadata: {
        requestId: input.requestId,
        routeGroup: input.routeGroup,
        routeKey: input.routeKey,
        sandboxRunId: input.sandboxRunId ?? null,
        ...(input.metadata ?? {}),
      },
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
      metadata: {
        requestId: input.requestId,
        routeGroup: input.routeGroup,
        routeKey: input.routeKey,
        sandboxRunId: input.sandboxRunId ?? null,
        ...(input.metadata ?? {}),
      },
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
      metadata: {
        requestId: input.requestId,
        routeGroup: input.routeGroup,
        routeKey: input.routeKey,
        sandboxRunId: input.sandboxRunId ?? null,
        ...(input.metadata ?? {}),
      },
      organizationId,
      severity: "critical",
      title: "Sandbox Failure Burst",
      userId: input.user?.id ?? null,
    });
  } else {
    await resolveOperationalAlert(sandboxAlertKey);
  }
}

async function evaluateSandboxOperationalAlerts() {
  const [backendHealth, hostedValidation, sandboxHealth] = await Promise.all([
    getSandboxBackendHealth(),
    getHostedDeploymentValidation(),
    getSandboxHealthSnapshot(),
  ]);

  if (!backendHealth.available) {
    await upsertOperationalAlert({
      alertType: "sandbox-unavailable",
      dedupeKey: "sandbox:backend:unavailable",
      message: backendHealth.detail,
      severity: "critical",
      title: "Sandbox Backend Unavailable",
    });
  } else {
    await resolveOperationalAlert("sandbox:backend:unavailable");
  }

  if (backendHealth.errorCode === "auth-failed") {
    await upsertOperationalAlert({
      alertType: "sandbox-auth-failed",
      dedupeKey: "sandbox:backend:auth-failed",
      message: backendHealth.detail,
      severity: "critical",
      title: "Sandbox Supervisor Auth Failed",
    });
  } else {
    await resolveOperationalAlert("sandbox:backend:auth-failed");
  }

  if (!hostedValidation.valid && hostedValidation.code !== "disabled") {
    await upsertOperationalAlert({
      alertType: "hosted-organization-binding-mismatch",
      dedupeKey: "hosted:organization:binding",
      message: hostedValidation.detail,
      severity: "critical",
      title: "Hosted Organization Binding Invalid",
    });
  } else {
    await resolveOperationalAlert("hosted:organization:binding");
  }

  if (sandboxHealth.staleRuns > 0 || sandboxHealth.abandonedRuns > 0) {
    await upsertOperationalAlert({
      alertType: "sandbox-reconciliation",
      dedupeKey: "sandbox:reconciliation:stale",
      message: `${sandboxHealth.staleRuns} stale sandbox runs and ${sandboxHealth.abandonedRuns} abandoned runs are currently recorded.`,
      severity: "critical",
      title: "Sandbox Reconciliation Needed",
    });
  } else {
    await resolveOperationalAlert("sandbox:reconciliation:stale");
  }

  if (sandboxHealth.rejectedRuns >= 3) {
    await upsertOperationalAlert({
      alertType: "sandbox-capacity",
      dedupeKey: "sandbox:capacity:rejections",
      message: `${sandboxHealth.rejectedRuns} sandbox runs were rejected in the current retained window.`,
      severity: "warning",
      title: "Sandbox Capacity Pressure",
    });
  } else {
    await resolveOperationalAlert("sandbox:capacity:rejections");
  }
}

function estimateScheduledRunsPerWindowFromScheduleJson(scheduleJson: string | null | undefined) {
  if (!scheduleJson) {
    return 0;
  }

  try {
    const schedule = parseWorkflowScheduleJson(scheduleJson);

    if (schedule.kind !== "recurring") {
      return 0;
    }

    return schedule.cadence.kind === "weekly" ? 5 : 1;
  } catch {
    return 0;
  }
}

async function evaluateWorkflowOperationalAlerts() {
  const db = await getAppDatabase();
  const now = Date.now();
  const burstWindowMs = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_ALERT_BURST_WINDOW_MINUTES,
    10,
  ) * ONE_MINUTE_MS;
  const workflowFailureThreshold = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_FAILURE_BURST_THRESHOLD,
    3,
  );
  const deliveryFailureThreshold = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_DELIVERY_FAILURE_BURST_THRESHOLD,
    5,
  );
  const waitingStaleThreshold = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_WAITING_STALE_THRESHOLD,
    1,
  );
  const waitingStaleHours = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_WAITING_STALE_HOURS,
    6,
  );
  const burstSince = now - burstWindowMs;
  const staleWaitingCutoff = now - waitingStaleHours * 60 * ONE_MINUTE_MS;

  const [failureRows, waitingRows, deliveryFailureRows, existingOpenAlerts] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)`,
        organizationId: workflowRuns.organizationId,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.status, "failed"),
          gte(workflowRuns.completedAt, burstSince),
        ),
      )
      .groupBy(workflowRuns.organizationId),
    db
      .select({
        count: sql<number>`count(*)`,
        organizationId: workflowRuns.organizationId,
      })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.status, "waiting_for_input"),
          lt(workflowRuns.updatedAt, staleWaitingCutoff),
        ),
      )
      .groupBy(workflowRuns.organizationId),
    db
      .select({
        count: sql<number>`count(*)`,
        organizationId: workflowDeliveries.organizationId,
      })
      .from(workflowDeliveries)
      .where(
        and(
          eq(workflowDeliveries.status, "failed"),
          gte(workflowDeliveries.updatedAt, burstSince),
        ),
      )
      .groupBy(workflowDeliveries.organizationId),
    db.query.operationalAlerts.findMany({
      where: and(
        eq(operationalAlerts.status, "open"),
        inArray(operationalAlerts.alertType, [
          "workflow-failure-burst",
          "workflow-waiting-stale",
          "workflow-delivery-failure-burst",
        ]),
      ),
    }),
  ]);

  const activeDedupeKeys = new Set<string>();

  for (const row of failureRows) {
    const organizationId = row.organizationId;

    if (!organizationId) {
      continue;
    }

    const count = Number(row.count ?? 0);
    const dedupeKey = `workflow:failures:${organizationId}:burst`;

    if (count >= workflowFailureThreshold) {
      activeDedupeKeys.add(dedupeKey);

      await upsertOperationalAlert({
        alertType: "workflow-failure-burst",
        dedupeKey,
        message: `${count} workflow runs failed in the last ${Math.round(burstWindowMs / ONE_MINUTE_MS)} minutes.`,
        metadata: {
          count,
          routeGroup: "workflow",
          threshold: workflowFailureThreshold,
          windowMinutes: Math.round(burstWindowMs / ONE_MINUTE_MS),
        },
        organizationId,
        severity: count >= workflowFailureThreshold * 2 ? "critical" : "warning",
        title: "Workflow Failure Burst",
      });
    }
  }

  for (const row of waitingRows) {
    const organizationId = row.organizationId;

    if (!organizationId) {
      continue;
    }

    const count = Number(row.count ?? 0);
    const dedupeKey = `workflow:waiting:${organizationId}:stale`;

    if (count >= waitingStaleThreshold) {
      activeDedupeKeys.add(dedupeKey);

      await upsertOperationalAlert({
        alertType: "workflow-waiting-stale",
        dedupeKey,
        message: `${count} workflow run${count === 1 ? "" : "s"} have been waiting for input longer than ${waitingStaleHours} hours.`,
        metadata: {
          count,
          routeGroup: "workflow",
          staleHours: waitingStaleHours,
          threshold: waitingStaleThreshold,
        },
        organizationId,
        severity: count >= Math.max(3, waitingStaleThreshold + 1) ? "critical" : "warning",
        title: "Stale Waiting Workflow Runs",
      });
    }
  }

  for (const row of deliveryFailureRows) {
    const organizationId = row.organizationId;

    if (!organizationId) {
      continue;
    }

    const count = Number(row.count ?? 0);
    const dedupeKey = `workflow:delivery_failures:${organizationId}:burst`;

    if (count >= deliveryFailureThreshold) {
      activeDedupeKeys.add(dedupeKey);

      await upsertOperationalAlert({
        alertType: "workflow-delivery-failure-burst",
        dedupeKey,
        message: `${count} workflow delivery attempts failed in the last ${Math.round(burstWindowMs / ONE_MINUTE_MS)} minutes.`,
        metadata: {
          count,
          routeGroup: "workflow",
          threshold: deliveryFailureThreshold,
          windowMinutes: Math.round(burstWindowMs / ONE_MINUTE_MS),
        },
        organizationId,
        severity: count >= deliveryFailureThreshold * 2 ? "critical" : "warning",
        title: "Workflow Delivery Failure Burst",
      });
    }
  }

  for (const alert of existingOpenAlerts) {
    if (!activeDedupeKeys.has(alert.dedupeKey)) {
      await resolveOperationalAlert(alert.dedupeKey);
    }
  }
}

export async function runOperationsMaintenance() {
  const now = Date.now();

  if (now - lastMaintenanceAt < ONE_MINUTE_MS) {
    return;
  }

  lastMaintenanceAt = now;
  const db = await getAppDatabase();
  const retentionDefaults = getFallbackOperationsRetentionDefaults();
  const requestLogCutoff = now - getRetentionWindowMs(retentionDefaults.requestLogRetentionDays);
  const usageCutoff = now - getRetentionWindowMs(retentionDefaults.usageRetentionDays);
  const bucketCutoff = now - 2 * TWENTY_FOUR_HOURS_MS;
  const alertCutoff = now - getRetentionWindowMs(retentionDefaults.alertRetentionDays);
  const organizationIdsWithOverrides = await db
    .select({
      id: organizations.id,
    })
    .from(organizations);
  const requestLogOverrideOrgIds: string[] = [];
  const usageOverrideOrgIds: string[] = [];
  const alertOverrideOrgIds: string[] = [];

  for (const row of organizationIdsWithOverrides) {
    const overrides = await getOrganizationRetentionOverrides({
      organizationId: row.id,
    });

    if (overrides.requestLogRetentionDays !== null) {
      requestLogOverrideOrgIds.push(row.id);
    }

    if (overrides.usageRetentionDays !== null) {
      usageOverrideOrgIds.push(row.id);
    }

    if (overrides.alertRetentionDays !== null) {
      alertOverrideOrgIds.push(row.id);
    }
  }

  const requestLogsCleanupWhere =
    requestLogOverrideOrgIds.length > 0
      ? and(
          lt(requestLogs.completedAt, requestLogCutoff),
          or(
            isNull(requestLogs.organizationId),
            notInArray(requestLogs.organizationId, requestLogOverrideOrgIds),
          ),
        )
      : lt(requestLogs.completedAt, requestLogCutoff);

  const usageEventsCleanupWhere =
    usageOverrideOrgIds.length > 0
      ? and(
          lt(usageEvents.createdAt, usageCutoff),
          or(
            isNull(usageEvents.organizationId),
            notInArray(usageEvents.organizationId, usageOverrideOrgIds),
          ),
        )
      : lt(usageEvents.createdAt, usageCutoff);

  const alertsCleanupWhere =
    alertOverrideOrgIds.length > 0
      ? and(
          eq(operationalAlerts.status, "resolved"),
          lt(operationalAlerts.lastSeenAt, alertCutoff),
          or(
            isNull(operationalAlerts.organizationId),
            notInArray(operationalAlerts.organizationId, alertOverrideOrgIds),
          ),
        )
      : and(
          eq(operationalAlerts.status, "resolved"),
          lt(operationalAlerts.lastSeenAt, alertCutoff),
        );

  await Promise.all([
    db.delete(requestLogs).where(requestLogsCleanupWhere),
    db.delete(usageEvents).where(usageEventsCleanupWhere),
    db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.updatedAt, bucketCutoff)),
    db.delete(operationalAlerts).where(alertsCleanupWhere),
  ]);
  await cleanupExpiredAnalysisResults();

  await evaluateSandboxOperationalAlerts().catch((caughtError) => {
    logStructuredError("operations.sandbox_alert_evaluation_failed", caughtError);
  });
  await evaluateWorkflowOperationalAlerts().catch((caughtError) => {
    logStructuredError("operations.workflow_alert_evaluation_failed", caughtError);
  });
  await runGovernanceMaintenance();
}

export function beginObservedRequest(input: {
  correlation?: CorrelationFields;
  method: string;
  routeGroup: OperationsRouteGroup;
  routeKey: string;
  user: SessionUser | null;
}) {
  const context: ObservedRequestContext = {
    correlation: mergeCorrelationFields(input.correlation, {
      organizationId: input.user?.organizationId ?? null,
      routeGroup: input.routeGroup,
      routeKey: input.routeKey,
      userId: input.user?.id ?? null,
    }),
    method: input.method,
    requestId: randomUUID(),
    routeGroup: input.routeGroup,
    routeKey: input.routeKey,
    startedAt: Date.now(),
    user: input.user,
  };

  logStructuredEvent("operations.request_start", {
    method: context.method,
    requestId: context.requestId,
    ...context.correlation,
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
  const correlation = mergeCorrelationFields(context.correlation, {
    governanceJobId: input.governanceJobId ?? null,
    knowledgeImportJobId: input.knowledgeImportJobId ?? null,
    requestId: context.requestId,
    routeGroup: context.routeGroup,
    routeKey: context.routeKey,
    runtimeToolCallId: input.runtimeToolCallId ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    turnId: input.turnId ?? null,
  });

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
    runtimeToolCallId: correlation.runtimeToolCallId ?? null,
    sandboxRunId: input.sandboxRunId ?? null,
    governanceJobId: correlation.governanceJobId ?? null,
    knowledgeImportJobId: correlation.knowledgeImportJobId ?? null,
    startedAt: context.startedAt,
    statusCode: input.response.status,
    toolName: input.toolName ?? null,
    totalCostUsd: input.totalCostUsd ?? null,
    totalTokens: input.totalTokens ?? null,
    turnId: correlation.turnId ?? null,
    userId: context.user?.id ?? null,
  });

  const commercialEntry = await finalizeCommercialLedgerEntry({
    outcome: input.outcome,
    requestId: context.requestId,
    requestLogId,
  });
  const inferredUsageClass = inferUsageClassForRequest({
    routeGroup: context.routeGroup,
    routeKey: context.routeKey,
  });

  for (const usageEvent of input.usageEvents ?? []) {
    await db.insert(usageEvents).values({
      commercialCredits:
        usageEvent.commercialCredits ?? (commercialEntry?.status === "committed" ? commercialEntry.creditsDelta : 0),
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
      usageClass:
        usageEvent.usageClass ??
        commercialEntry?.usageClass ??
        inferredUsageClass,
      userId: context.user?.id ?? null,
    });
  }

  logStructuredEvent("operations.request_finish", {
    durationMs,
    errorCode: input.errorCode ?? null,
    method: context.method,
    modelName: input.modelName ?? null,
    outcome: input.outcome,
    statusCode: input.response.status,
    toolName: input.toolName ?? null,
    totalCostUsd: input.totalCostUsd ?? null,
    totalTokens: input.totalTokens ?? null,
    ...correlation,
  });

  if (context.user) {
    await evaluateBudgetAlerts(context.user);
  }

  await evaluateDynamicAlerts({
    errorCode: input.errorCode ?? null,
    metadata: input.metadata,
    requestId: context.requestId,
    routeKey: context.routeKey,
    routeGroup: context.routeGroup,
    sandboxRunId: input.sandboxRunId ?? null,
    user: context.user,
  });

  attachRequestId(input.response, context.requestId);

  return input.response;
}

export async function enforceRateLimitPolicy(input: {
  routeGroup: RateLimitedRouteGroup;
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
  quantity?: number;
  routeGroup: RateLimitedRouteGroup;
  routeKey: string;
  requestId: string;
  user: SessionUser;
}) {
  const usageClass = getCommercialUsageClassForRoute({
    routeGroup: input.routeGroup,
    routeKey: input.routeKey,
  });

  if (!usageClass) {
    return null;
  }

  const plan = await getWorkspacePlanSummary(input.user.organizationId);
  const membershipPolicy = await getOrganizationMembershipCommercialPolicy({
    organizationId: input.user.organizationId,
    userId: input.user.id,
  });

  if (!membershipPolicy || membershipPolicy.status !== "active") {
    return null;
  }

  const quantity = Math.max(1, Math.trunc(input.quantity ?? 1));
  const requiredCredits = Math.max(0, plan.rateCard[usageClass] * quantity);

  if (requiredCredits <= 0) {
    return null;
  }

  const workspaceUsage = await getWorkspaceCommercialUsageSnapshot({
    organizationId: input.user.organizationId,
  });
  const remainingWorkspaceCredits = workspaceUsage.remainingCredits;

  if (remainingWorkspaceCredits < requiredCredits) {
    const metadata: CommercialBlockSummary = {
      planName: plan.planName,
      remainingUserCredits:
        typeof membershipPolicy.monthlyCreditCap === "number"
          ? Math.max(
              0,
              membershipPolicy.monthlyCreditCap -
                (
                  await getWorkspaceCommercialUsageSnapshot({
                    organizationId: input.user.organizationId,
                    userId: input.user.id,
                  })
                ).usedCredits,
            )
          : null,
      remainingWorkspaceCredits,
      requiredCredits,
      resetAt: workspaceUsage.resetAt,
      scope: "workspace",
      status: "credit_exhausted",
      usageClass,
    };

    await createCommercialLedgerEntry({
      creditsDelta: requiredCredits,
      metadata,
      organizationId: input.user.organizationId,
      requestId: input.requestId,
      routeGroup: input.routeGroup,
      status: "blocked",
      usageClass,
      userId: input.user.id,
      windowEndAt: workspaceUsage.windowEndAt,
      windowStartAt: workspaceUsage.windowStartAt,
    });

    await upsertOperationalAlert({
      alertType: "credit-exhausted",
      dedupeKey: `credits:workspace:${input.user.organizationId}:critical`,
      message: `Workspace credits are exhausted for ${plan.planName}.`,
      organizationId: input.user.organizationId,
      severity: "critical",
      title: "Workspace Credit Exhausted",
    });

    return {
      errorCode: buildCreditExhaustedErrorCode("workspace", usageClass),
      message: `Workspace credits are exhausted for ${plan.planName}.`,
      metadata,
    };
  }

  if (typeof membershipPolicy.monthlyCreditCap !== "number") {
    await createCommercialLedgerEntry({
      creditsDelta: requiredCredits,
      metadata: {
        planName: plan.planName,
        reservedCredits: requiredCredits,
      },
      organizationId: input.user.organizationId,
      requestId: input.requestId,
      routeGroup: input.routeGroup,
      status: "reserved",
      usageClass,
      userId: input.user.id,
      windowEndAt: workspaceUsage.windowEndAt,
      windowStartAt: workspaceUsage.windowStartAt,
    });

    return null;
  }

  const userUsage = await getWorkspaceCommercialUsageSnapshot({
    organizationId: input.user.organizationId,
    userId: input.user.id,
  });
  const remainingUserCredits = Math.max(
    0,
    membershipPolicy.monthlyCreditCap - userUsage.usedCredits - userUsage.pendingCredits,
  );

  if (remainingUserCredits < requiredCredits) {
    const metadata: CommercialBlockSummary = {
      planName: plan.planName,
      remainingUserCredits,
      remainingWorkspaceCredits,
      requiredCredits,
      resetAt: userUsage.resetAt,
      scope: "user",
      status: "credit_exhausted",
      usageClass,
    };

    await createCommercialLedgerEntry({
      creditsDelta: requiredCredits,
      metadata,
      organizationId: input.user.organizationId,
      requestId: input.requestId,
      routeGroup: input.routeGroup,
      status: "blocked",
      usageClass,
      userId: input.user.id,
      windowEndAt: userUsage.windowEndAt,
      windowStartAt: userUsage.windowStartAt,
    });

    await upsertOperationalAlert({
      alertType: "credit-exhausted",
      dedupeKey: `credits:user:${input.user.id}:critical`,
      message: `Member monthly credit cap of ${membershipPolicy.monthlyCreditCap} has been exhausted.`,
      organizationId: input.user.organizationId,
      severity: "critical",
      title: "Member Credit Exhausted",
      userId: input.user.id,
    });

    return {
      errorCode: buildCreditExhaustedErrorCode("user", usageClass),
      message: `This member has exhausted their monthly credit cap for ${plan.planName}.`,
      metadata,
    };
  }

  await createCommercialLedgerEntry({
    creditsDelta: requiredCredits,
    metadata: {
      planName: plan.planName,
      reservedCredits: requiredCredits,
    },
    organizationId: input.user.organizationId,
    requestId: input.requestId,
    routeGroup: input.routeGroup,
    status: "reserved",
    usageClass,
    userId: input.user.id,
    windowEndAt: workspaceUsage.windowEndAt,
    windowStartAt: workspaceUsage.windowStartAt,
  });

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
  let persistence: HealthSummary["persistence"] | null = null;
  const [
    hostedValidation,
    sandboxBackendHealth,
    sandboxSnapshot,
    knowledgeSearchToolchainHealth,
    pdfIngestionToolchainHealth,
  ] = await Promise.all([
    getHostedDeploymentValidation(),
    getSandboxBackendHealth(),
    getSandboxHealthSnapshot(),
    getKnowledgeSearchToolchainHealth(),
    getPdfIngestionToolchainHealth(),
  ]);

  if (hostedValidation.code !== "disabled") {
    checks.push({
      detail: hostedValidation.detail,
      name: "hosted-deployment",
      status: hostedValidation.valid ? "ok" : "fail",
    });
  }

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

  try {
    persistence = await getRuntimePersistenceSnapshot();

    if (persistence.journalMode !== "wal") {
      checks.push({
        detail: `SQLite persistence is using ${persistence.journalMode} journal mode at ${persistence.databasePath}. Hosted and single-writer recovery expectations require WAL.`,
        name: "persistence",
        status: "fail",
      });
    } else {
      checks.push({
        detail: `${persistence.engine} is configured at ${persistence.databasePath} with ${persistence.journalMode.toUpperCase()} journaling and ${persistence.topology} topology.`,
        name: "persistence",
        status: "ok",
      });
    }
  } catch (caughtError) {
    checks.push({
      detail:
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to inspect runtime persistence metadata.",
      name: "persistence",
      status: "fail",
    });
  }

  if (!sandboxBackendHealth.available) {
    checks.push({
      detail: sandboxBackendHealth.detail,
      name: "sandbox",
      status: "fail",
    });
  } else if (sandboxSnapshot.staleRuns > 0 || sandboxSnapshot.abandonedRuns > 0) {
    checks.push({
      detail: `${sandboxSnapshot.staleRuns} stale runs and ${sandboxSnapshot.abandonedRuns} abandoned runs are currently recorded.`,
      name: "sandbox",
      status: "degraded",
    });
  } else if (sandboxSnapshot.queuedRuns > 0) {
    checks.push({
      detail: `${sandboxSnapshot.queuedRuns} sandbox runs are waiting for supervisor capacity.`,
      name: "sandbox",
      status: "degraded",
    });
  } else {
    checks.push({
      detail: sandboxBackendHealth.detail,
      name: "sandbox",
      status: "ok",
    });
  }

  checks.push({
    detail: knowledgeSearchToolchainHealth.detail,
    name: "knowledge-search",
    status: knowledgeSearchToolchainHealth.ripgrepAvailable ? "ok" : "degraded",
  });

  checks.push({
    detail: pdfIngestionToolchainHealth.detail,
    name: "pdf-ingestion",
    status: pdfIngestionToolchainHealth.available ? "ok" : "degraded",
  });

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
    persistence:
      persistence ??
      ({
        backupCadenceHours: 24,
        backupBeforeSchemaChanges: true,
        databasePath: "unknown",
        deploymentMode: hostedValidation.code === "disabled" ? "single_org" : "hosted",
        engine: "sqlite",
        journalMode: "unknown",
        requestModel: "synchronous_requests_only",
        restoreDrillCadence: "before_first_cutover_and_quarterly",
        sandboxConcurrency: {
          globalActiveRuns: 4,
          perUserActiveRuns: 1,
        },
        storageRoot: "unknown",
        targetRpoHours: 24,
        targetRtoHours: 2,
        topology:
          hostedValidation.code === "disabled"
            ? "single_writer_customer_managed_cell"
            : "single_writer_dedicated_hosted_cell",
        writableAppInstances: 1,
      } satisfies HealthSummary["persistence"]),
    sandbox: {
      ...sandboxSnapshot,
      authMode: sandboxBackendHealth.authMode,
      available: sandboxBackendHealth.available,
      backend: sandboxBackendHealth.backend,
      boundOrganizationSlug: sandboxBackendHealth.boundOrganizationSlug,
      detail: sandboxBackendHealth.detail,
      errorCode: sandboxBackendHealth.errorCode ?? null,
      runner: sandboxBackendHealth.runner,
    },
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
  const [health, workspacePlan, workspaceUsage] = await Promise.all([
    getHealthSummary(),
    getWorkspacePlanSummary(input.organizationId),
    getWorkspaceCommercialUsageSnapshot({
      organizationId: input.organizationId,
    }),
  ]);

  const [
    alerts,
    routeMetrics,
    usageByRouteGroup,
    usageByEventType,
    byUser,
    recentFailures,
    rateLimitActivity,
    workflowRunStatusRows,
    activeWorkflowRows,
    workflowDeliveryFailureRows,
  ] = await Promise.all([
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
          commercialCredits: sql<number>`coalesce(sum(${usageEvents.commercialCredits}), 0)`,
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
          commercialCredits: sql<number>`coalesce(sum(${usageEvents.commercialCredits}), 0)`,
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
          creditCap: organizationMemberships.monthlyCreditCap,
          creditsUsed: sql<number>`coalesce(sum(${usageEvents.commercialCredits}), 0)`,
          costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`,
          email: users.email,
          name: users.name,
          outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
          quantity: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
          requestCount: sql<number>`count(*)`,
          status: organizationMemberships.status,
          totalTokens: sql<number>`coalesce(sum(${usageEvents.totalTokens}), 0)`,
          userId: usageEvents.userId,
        })
        .from(usageEvents)
        .leftJoin(users, eq(users.id, usageEvents.userId))
        .leftJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.userId, usageEvents.userId),
            eq(organizationMemberships.organizationId, input.organizationId),
          ),
        )
        .where(
          and(
            eq(usageEvents.organizationId, input.organizationId),
            gte(usageEvents.createdAt, since),
          ),
        )
        .groupBy(
          usageEvents.userId,
          users.email,
          users.name,
          organizationMemberships.monthlyCreditCap,
          organizationMemberships.status,
        ),
      db
        .select({
          completedAt: requestLogs.completedAt,
          errorCode: requestLogs.errorCode,
          governanceJobId: requestLogs.governanceJobId,
          knowledgeImportJobId: requestLogs.knowledgeImportJobId,
          outcome: requestLogs.outcome,
          requestId: requestLogs.requestId,
          runtimeToolCallId: requestLogs.runtimeToolCallId,
          routeGroup: requestLogs.routeGroup,
          routeKey: requestLogs.routeKey,
          sandboxRunId: requestLogs.sandboxRunId,
          statusCode: requestLogs.statusCode,
          toolName: requestLogs.toolName,
          turnId: requestLogs.turnId,
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
      db
        .select({
          count: sql<number>`count(*)`,
          status: workflowRuns.status,
        })
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.organizationId, input.organizationId),
            gte(workflowRuns.createdAt, since),
          ),
        )
        .groupBy(workflowRuns.status),
      db
        .select({
          scheduleJson: workflowVersions.scheduleJson,
          workflowId: workflows.id,
        })
        .from(workflows)
        .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.currentVersionId))
        .where(
          and(
            eq(workflows.organizationId, input.organizationId),
            eq(workflows.status, "active"),
          ),
        ),
      db
        .select({
          count: sql<number>`count(*)`,
        })
        .from(workflowDeliveries)
        .where(
          and(
            eq(workflowDeliveries.organizationId, input.organizationId),
            eq(workflowDeliveries.status, "failed"),
            gte(workflowDeliveries.updatedAt, since),
          ),
        ),
    ]);

  const byUserSummary: UsageActorSummary[] = byUser
    .filter((row) => typeof row.userId === "string" && row.userId.length > 0)
    .map((row) => ({
      creditCap:
        typeof row.creditCap === "number" && Number.isFinite(row.creditCap)
          ? Number(row.creditCap)
          : null,
      creditsUsed: Number(row.creditsUsed ?? 0),
      costUsd: Number(row.costUsd ?? 0),
      name: row.name || row.email || "Unknown user",
      outputTokens: Number(row.outputTokens ?? 0),
      quantity: Number(row.quantity ?? 0),
      remainingCreditCap:
        typeof row.creditCap === "number" && Number.isFinite(row.creditCap)
          ? Math.max(0, Number(row.creditCap) - Number(row.creditsUsed ?? 0))
          : null,
      requestCount: Number(row.requestCount ?? 0),
      status: (
        row.status === "suspended"
          ? "suspended"
          : row.status === "restricted"
            ? "restricted"
            : "active"
      ) as UsageActorSummary["status"],
      totalTokens: Number(row.totalTokens ?? 0),
      userId: row.userId as string,
    }))
    .sort(
      (left, right) =>
        right.creditsUsed - left.creditsUsed ||
        right.costUsd - left.costUsd ||
        right.totalTokens - left.totalTokens,
    );

  const workflowRunCounts = new Map<string, number>();

  for (const row of workflowRunStatusRows) {
    workflowRunCounts.set(String(row.status), Number(row.count ?? 0));
  }

  const workflowScheduledRunsPerWindowEstimate = activeWorkflowRows.reduce((sum, row) => {
    return sum + estimateScheduledRunsPerWindowFromScheduleJson(row.scheduleJson);
  }, 0);
  const workflowDeliveryFailedCount = Number(workflowDeliveryFailureRows[0]?.count ?? 0);

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
    workspace: {
      ...workspacePlan,
      exhausted: workspaceUsage.exhausted,
      pendingCredits: workspaceUsage.pendingCredits,
      remainingCredits: workspaceUsage.remainingCredits,
      resetAt: workspaceUsage.resetAt,
      usedCredits: workspaceUsage.usedCredits,
    },
    workflow: {
      activeWorkflowCount: activeWorkflowRows.length,
      deliveryFailedCount: workflowDeliveryFailedCount,
      maxActiveWorkflows: workspacePlan.workflowEntitlements.maxActiveWorkflows,
      maxScheduledRunsPerWindow:
        workspacePlan.workflowEntitlements.maxScheduledRunsPerWindow,
      runsCompleted: workflowRunCounts.get("completed") ?? 0,
      runsFailed: workflowRunCounts.get("failed") ?? 0,
      runsTotal: [...workflowRunCounts.values()].reduce((sum, count) => sum + count, 0),
      runsWaitingForInput: workflowRunCounts.get("waiting_for_input") ?? 0,
      scheduledRunsPerWindowEstimate: workflowScheduledRunsPerWindowEstimate,
    },
    rateLimitActivity: rateLimitActivity.map((row) => ({
      count: Number(row.count ?? 0),
      routeGroup: row.routeGroup as OperationsRouteGroup,
    })),
    recentFailures: recentFailures.map((row) => ({
      completedAt: row.completedAt,
      errorCode: row.errorCode,
      governanceJobId: row.governanceJobId,
      knowledgeImportJobId: row.knowledgeImportJobId,
      outcome: row.outcome,
      requestId: row.requestId,
      runtimeToolCallId: row.runtimeToolCallId,
      routeGroup: row.routeGroup as OperationsRouteGroup,
      routeKey: row.routeKey,
      sandboxRunId: row.sandboxRunId,
      statusCode: row.statusCode,
      toolName: row.toolName,
      turnId: row.turnId,
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
        commercialCredits: Number(row.commercialCredits ?? 0),
        costUsd: Number(row.costUsd ?? 0),
        eventType: row.eventType,
        outputTokens: Number(row.outputTokens ?? 0),
        quantity: Number(row.quantity ?? 0),
        requestCount: Number(row.requestCount ?? 0),
        routeGroup: row.routeGroup as OperationsRouteGroup,
        totalTokens: Number(row.totalTokens ?? 0),
      })),
      byRouteGroup: usageByRouteGroup.map((row) => ({
        commercialCredits: Number(row.commercialCredits ?? 0),
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
    status: "credit_exhausted",
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

export function resetOperationsMaintenanceStateForTests() {
  lastMaintenanceAt = 0;
}
