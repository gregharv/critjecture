import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";

import type {
  GetGovernanceJobResponse,
  GovernanceJobRecord,
  GovernanceJobType,
  ListGovernanceJobsResponse,
  OrganizationComplianceSettings,
} from "@/lib/admin-types";
import { ensureOrganizationGovernanceRoot, resolveRepositoryRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  assistantMessages,
  chatTurns,
  conversations,
  documents,
  governanceJobs,
  knowledgeImportJobFiles,
  knowledgeImportJobs,
  operationalAlerts,
  organizationComplianceSettings,
  organizations,
  organizationMemberships,
  requestLogs,
  retrievalCandidates,
  retrievalRewrites,
  retrievalRuns,
  sandboxGeneratedAssets,
  sandboxRuns,
  toolCalls,
  usageEvents,
  users,
} from "@/lib/app-schema";
import type { SessionUser } from "@/lib/auth-state";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import {
  asErrorMessage,
  logStructuredError,
  logStructuredEvent,
} from "@/lib/observability";
import {
  getRetentionWindowMs,
  OPERATIONS_ALERT_RETENTION_DAYS,
  OPERATIONS_REQUEST_LOG_RETENTION_DAYS,
  OPERATIONS_USAGE_RETENTION_DAYS,
} from "@/lib/operations-policy";

const execFileAsync = promisify(execFile);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const GOVERNANCE_JOB_STALE_MS = 5 * 60 * 1000;

let governanceWorkerPromise: Promise<void> | null = null;
let governanceWorkerWakeRequested = false;
let lastGovernanceMaintenanceAt = 0;

type GovernanceSettingsRow = typeof organizationComplianceSettings.$inferSelect;
type GovernanceJobRow = typeof governanceJobs.$inferSelect;

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeOptionalRetentionDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

function mapComplianceSettings(
  row: (GovernanceSettingsRow & { updatedByUserEmail: string | null }) | null,
) {
  return {
    alertRetentionDays: normalizeOptionalRetentionDays(row?.alertRetentionDays ?? null),
    chatHistoryRetentionDays: normalizeOptionalRetentionDays(row?.chatHistoryRetentionDays ?? null),
    exportArtifactRetentionDays: Math.max(
      1,
      Math.trunc(row?.exportArtifactRetentionDays ?? 7),
    ),
    knowledgeImportRetentionDays: normalizeOptionalRetentionDays(
      row?.knowledgeImportRetentionDays ?? null,
    ),
    requestLogRetentionDays: normalizeOptionalRetentionDays(row?.requestLogRetentionDays ?? null),
    updatedAt: row?.updatedAt ?? null,
    updatedByUserEmail: row?.updatedByUserEmail ?? null,
    usageRetentionDays: normalizeOptionalRetentionDays(row?.usageRetentionDays ?? null),
  } satisfies OrganizationComplianceSettings;
}

function mapGovernanceJobRow(
  row: GovernanceJobRow & { requestedByUserEmail: string | null },
): GovernanceJobRecord {
  return {
    artifact: {
      byteSize: row.artifactByteSize ?? null,
      fileName: row.artifactFileName ?? null,
      hasArtifact: typeof row.artifactStoragePath === "string" && row.artifactStoragePath.length > 0,
    },
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    cutoffTimestamp: row.cutoffTimestamp,
    errorMessage: row.errorMessage,
    id: row.id,
    jobType: row.jobType,
    metadata: parseJsonRecord(row.metadataJson),
    requestedByUserEmail: row.requestedByUserEmail,
    result: parseJsonRecord(row.resultJson),
    startedAt: row.startedAt,
    status: row.status,
    targetLabel: row.targetLabel,
    triggerRequestId: row.triggerRequestId ?? null,
    triggerKind: row.triggerKind,
    updatedAt: row.updatedAt,
  };
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function removePathQuietly(targetPath: string | null | undefined) {
  if (!targetPath) {
    return;
  }

  await rm(targetPath, { force: true, recursive: true }).catch(() => undefined);
}

async function writeJsonFile(targetPath: string, value: unknown) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(value, null, 2));
}

async function getOrganizationContext(organizationId: string) {
  const db = await getAppDatabase();
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!row) {
    throw new Error("Organization not found.");
  }

  return row;
}

async function getComplianceSettingsRow(organizationId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: organizationComplianceSettings.id,
      organizationId: organizationComplianceSettings.organizationId,
      requestLogRetentionDays: organizationComplianceSettings.requestLogRetentionDays,
      usageRetentionDays: organizationComplianceSettings.usageRetentionDays,
      alertRetentionDays: organizationComplianceSettings.alertRetentionDays,
      chatHistoryRetentionDays: organizationComplianceSettings.chatHistoryRetentionDays,
      knowledgeImportRetentionDays: organizationComplianceSettings.knowledgeImportRetentionDays,
      exportArtifactRetentionDays: organizationComplianceSettings.exportArtifactRetentionDays,
      updatedByUserId: organizationComplianceSettings.updatedByUserId,
      createdAt: organizationComplianceSettings.createdAt,
      updatedAt: organizationComplianceSettings.updatedAt,
      updatedByUserEmail: users.email,
    })
    .from(organizationComplianceSettings)
    .leftJoin(users, eq(users.id, organizationComplianceSettings.updatedByUserId))
    .where(eq(organizationComplianceSettings.organizationId, organizationId))
    .limit(1);

  return rows[0] ?? null;
}

export async function getOrganizationComplianceSettings(
  organizationId: string,
): Promise<OrganizationComplianceSettings> {
  return mapComplianceSettings(await getComplianceSettingsRow(organizationId));
}

export async function saveOrganizationComplianceSettings(input: {
  organizationId: string;
  settings: {
    alertRetentionDays?: number | null;
    chatHistoryRetentionDays?: number | null;
    exportArtifactRetentionDays?: number | null;
    knowledgeImportRetentionDays?: number | null;
    requestLogRetentionDays?: number | null;
    usageRetentionDays?: number | null;
  };
  updatedByUserId: string;
}) {
  const db = await getAppDatabase();
  const existing = await getComplianceSettingsRow(input.organizationId);
  const now = Date.now();
  const nextValues = {
    alertRetentionDays: normalizeOptionalRetentionDays(input.settings.alertRetentionDays),
    chatHistoryRetentionDays: normalizeOptionalRetentionDays(
      input.settings.chatHistoryRetentionDays,
    ),
    exportArtifactRetentionDays: Math.max(
      1,
      Math.trunc(input.settings.exportArtifactRetentionDays ?? existing?.exportArtifactRetentionDays ?? 7),
    ),
    knowledgeImportRetentionDays: normalizeOptionalRetentionDays(
      input.settings.knowledgeImportRetentionDays,
    ),
    requestLogRetentionDays: normalizeOptionalRetentionDays(
      input.settings.requestLogRetentionDays,
    ),
    updatedAt: now,
    updatedByUserId: input.updatedByUserId,
    usageRetentionDays: normalizeOptionalRetentionDays(input.settings.usageRetentionDays),
  };

  if (!existing) {
    await db.insert(organizationComplianceSettings).values({
      ...nextValues,
      createdAt: now,
      id: randomUUID(),
      organizationId: input.organizationId,
    });
  } else {
    await db
      .update(organizationComplianceSettings)
      .set(nextValues)
      .where(eq(organizationComplianceSettings.id, existing.id));
  }

  return getOrganizationComplianceSettings(input.organizationId);
}

async function listGovernanceJobRows(organizationId: string) {
  const db = await getAppDatabase();
  return db
    .select({
      id: governanceJobs.id,
      organizationId: governanceJobs.organizationId,
      requestedByUserId: governanceJobs.requestedByUserId,
      jobType: governanceJobs.jobType,
      status: governanceJobs.status,
      triggerRequestId: governanceJobs.triggerRequestId,
      triggerKind: governanceJobs.triggerKind,
      targetLabel: governanceJobs.targetLabel,
      cutoffTimestamp: governanceJobs.cutoffTimestamp,
      artifactStoragePath: governanceJobs.artifactStoragePath,
      artifactFileName: governanceJobs.artifactFileName,
      artifactByteSize: governanceJobs.artifactByteSize,
      metadataJson: governanceJobs.metadataJson,
      resultJson: governanceJobs.resultJson,
      errorMessage: governanceJobs.errorMessage,
      createdAt: governanceJobs.createdAt,
      startedAt: governanceJobs.startedAt,
      completedAt: governanceJobs.completedAt,
      updatedAt: governanceJobs.updatedAt,
      requestedByUserEmail: users.email,
    })
    .from(governanceJobs)
    .leftJoin(users, eq(users.id, governanceJobs.requestedByUserId))
    .where(eq(governanceJobs.organizationId, organizationId))
    .orderBy(desc(governanceJobs.createdAt));
}

export async function listGovernanceJobs(
  organizationId: string,
): Promise<ListGovernanceJobsResponse> {
  const rows = await listGovernanceJobRows(organizationId);
  return {
    jobs: rows.map(mapGovernanceJobRow),
  };
}

export async function getGovernanceJob(
  organizationId: string,
  jobId: string,
): Promise<GetGovernanceJobResponse> {
  const rows = await listGovernanceJobRows(organizationId);
  const row = rows.find((entry) => entry.id === jobId) ?? null;

  if (!row) {
    throw new Error("Governance job not found.");
  }

  return {
    job: mapGovernanceJobRow(row),
  };
}

async function createGovernanceJob(input: {
  cutoffTimestamp?: number | null;
  jobType: GovernanceJobType;
  metadata?: Record<string, unknown>;
  organizationId: string;
  requestedByUserId: string | null;
  targetLabel: string;
  triggerRequestId?: string | null;
  triggerKind?: "manual" | "automatic";
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const row = {
    artifactByteSize: null,
    artifactFileName: null,
    artifactStoragePath: null,
    completedAt: null,
    createdAt: now,
    cutoffTimestamp: input.cutoffTimestamp ?? null,
    errorMessage: null,
    id: randomUUID(),
    jobType: input.jobType,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    organizationId: input.organizationId,
    requestedByUserId: input.requestedByUserId,
    resultJson: JSON.stringify({}),
    startedAt: null,
    status: "queued" as const,
    targetLabel: input.targetLabel,
    triggerRequestId: input.triggerRequestId ?? null,
    triggerKind: input.triggerKind ?? "manual",
    updatedAt: now,
  };

  await db.insert(governanceJobs).values(row);
  logStructuredEvent("governance.job_queued", {
    governanceJobId: row.id,
    jobType: row.jobType,
    organizationId: row.organizationId,
    requestId: row.triggerRequestId ?? null,
    targetLabel: row.targetLabel,
    triggerKind: row.triggerKind,
    userId: row.requestedByUserId ?? null,
  });
  wakeGovernanceWorker();

  return row.id;
}

export async function queueOrganizationExportJob(
  user: SessionUser,
  triggerRequestId?: string | null,
) {
  return createGovernanceJob({
    jobType: "organization_export",
    organizationId: user.organizationId,
    requestedByUserId: user.id,
    targetLabel: "full_organization",
    triggerRequestId,
  });
}

async function assertRecentCompletedExportJob(input: {
  exportJobId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const row = await db.query.governanceJobs.findFirst({
    where: and(
      eq(governanceJobs.id, input.exportJobId),
      eq(governanceJobs.organizationId, input.organizationId),
      eq(governanceJobs.jobType, "organization_export"),
      eq(governanceJobs.status, "completed"),
    ),
  });

  if (!row || !isRecentCompletedExport(row.completedAt)) {
    throw new Error("A completed organization export from the last 24 hours is required.");
  }
}

export function isRecentCompletedExport(
  completedAt: number | null | undefined,
  now = Date.now(),
) {
  return typeof completedAt === "number" && completedAt >= now - ONE_DAY_MS;
}

export async function queueHistoryPurgeJob(input: {
  cutoffTimestamp: number;
  exportJobId: string;
  triggerRequestId?: string | null;
  user: SessionUser;
}) {
  await assertRecentCompletedExportJob({
    exportJobId: input.exportJobId,
    organizationId: input.user.organizationId,
  });

  return createGovernanceJob({
    cutoffTimestamp: input.cutoffTimestamp,
    jobType: "history_purge",
    metadata: {
      confirmedByExportJobId: input.exportJobId,
    },
    organizationId: input.user.organizationId,
    requestedByUserId: input.user.id,
    targetLabel: "chat_history",
    triggerRequestId: input.triggerRequestId ?? null,
  });
}

export async function queueImportMetadataPurgeJob(input: {
  cutoffTimestamp: number;
  exportJobId: string;
  triggerRequestId?: string | null;
  user: SessionUser;
}) {
  await assertRecentCompletedExportJob({
    exportJobId: input.exportJobId,
    organizationId: input.user.organizationId,
  });

  return createGovernanceJob({
    cutoffTimestamp: input.cutoffTimestamp,
    jobType: "import_metadata_purge",
    metadata: {
      confirmedByExportJobId: input.exportJobId,
    },
    organizationId: input.user.organizationId,
    requestedByUserId: input.user.id,
    targetLabel: "knowledge_import_metadata",
    triggerRequestId: input.triggerRequestId ?? null,
  });
}

export async function queueKnowledgeDeletionJob(input: {
  cutoffTimestamp: number;
  exportJobId: string;
  triggerRequestId?: string | null;
  user: SessionUser;
}) {
  await assertRecentCompletedExportJob({
    exportJobId: input.exportJobId,
    organizationId: input.user.organizationId,
  });

  return createGovernanceJob({
    cutoffTimestamp: input.cutoffTimestamp,
    jobType: "knowledge_delete",
    metadata: {
      confirmedByExportJobId: input.exportJobId,
    },
    organizationId: input.user.organizationId,
    requestedByUserId: input.user.id,
    targetLabel: "managed_knowledge_files",
    triggerRequestId: input.triggerRequestId ?? null,
  });
}

function wakeGovernanceWorker() {
  governanceWorkerWakeRequested = true;

  if (!governanceWorkerPromise) {
    governanceWorkerPromise = runGovernanceWorker()
      .catch((caughtError) => {
        logStructuredError("governance.worker_loop_failed", caughtError);
      })
      .finally(() => {
        governanceWorkerPromise = null;
      });
  }
}

async function claimNextGovernanceJob() {
  const db = await getAppDatabase();
  const now = Date.now();
  const staleCutoff = now - GOVERNANCE_JOB_STALE_MS;
  const queuedJob = await db.query.governanceJobs.findFirst({
    where: or(
      eq(governanceJobs.status, "queued"),
      and(eq(governanceJobs.status, "running"), lt(governanceJobs.updatedAt, staleCutoff)),
    ),
    orderBy: [asc(governanceJobs.createdAt)],
  });

  if (!queuedJob) {
    return null;
  }

  await db
    .update(governanceJobs)
    .set({
      errorMessage: null,
      startedAt: queuedJob.startedAt ?? now,
      status: "running",
      updatedAt: now,
    })
    .where(eq(governanceJobs.id, queuedJob.id));

  logStructuredEvent("governance.job_started", {
    governanceJobId: queuedJob.id,
    jobType: queuedJob.jobType,
    organizationId: queuedJob.organizationId,
    requestId: queuedJob.triggerRequestId ?? null,
    targetLabel: queuedJob.targetLabel,
    userId: queuedJob.requestedByUserId ?? null,
  });

  return {
    ...queuedJob,
    startedAt: queuedJob.startedAt ?? now,
    status: "running" as const,
    updatedAt: now,
  };
}

async function updateGovernanceJobSuccess(input: {
  artifactByteSize?: number | null;
  artifactFileName?: string | null;
  artifactStoragePath?: string | null;
  jobId: string;
  result: Record<string, unknown>;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(governanceJobs)
    .set({
      artifactByteSize: input.artifactByteSize ?? null,
      artifactFileName: input.artifactFileName ?? null,
      artifactStoragePath: input.artifactStoragePath ?? null,
      completedAt: now,
      resultJson: JSON.stringify(input.result),
      status: "completed",
      updatedAt: now,
    })
    .where(eq(governanceJobs.id, input.jobId));

  const job = await db.query.governanceJobs.findFirst({
    where: eq(governanceJobs.id, input.jobId),
  });

  logStructuredEvent("governance.job_completed", {
    governanceJobId: input.jobId,
    jobType: job?.jobType ?? null,
    organizationId: job?.organizationId ?? null,
    requestId: job?.triggerRequestId ?? null,
    targetLabel: job?.targetLabel ?? null,
    userId: job?.requestedByUserId ?? null,
  });
}

async function updateGovernanceJobFailure(jobId: string, errorMessage: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(governanceJobs)
    .set({
      completedAt: now,
      errorMessage,
      status: "failed",
      updatedAt: now,
    })
    .where(eq(governanceJobs.id, jobId));

  const job = await db.query.governanceJobs.findFirst({
    where: eq(governanceJobs.id, jobId),
  });

  logStructuredEvent("governance.job_failed", {
    error: errorMessage,
    governanceJobId: jobId,
    jobType: job?.jobType ?? null,
    organizationId: job?.organizationId ?? null,
    requestId: job?.triggerRequestId ?? null,
    targetLabel: job?.targetLabel ?? null,
    userId: job?.requestedByUserId ?? null,
  });
}

async function buildExportBundle(job: GovernanceJobRow) {
  const organization = await getOrganizationContext(job.organizationId);
  const db = await getAppDatabase();
  const governanceRoot = await ensureOrganizationGovernanceRoot(organization.slug);
  const stagingDir = path.join(governanceRoot, `export-${job.id}`);
  const artifactPath = path.join(governanceRoot, `export-${job.id}.tar.gz`);
  const repositoryRoot = await resolveRepositoryRoot();

  await removePathQuietly(stagingDir);
  await unlink(artifactPath).catch(() => undefined);
  await mkdir(stagingDir, { recursive: true });

  const [
    membershipRows,
    documentRows,
    conversationRows,
    turnRows,
    requestLogRows,
    usageRows,
    alertRows,
    importJobRows,
    importJobFileRows,
    sandboxRunRows,
    sandboxAssetRows,
  ] = await Promise.all([
    db
      .select({
        membershipId: organizationMemberships.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: organizationMemberships.role,
        status: users.status,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, job.organizationId))
      .orderBy(asc(users.createdAt)),
    db.select().from(documents).where(eq(documents.organizationId, job.organizationId)),
    db.select().from(conversations).where(eq(conversations.organizationId, job.organizationId)),
    db.select().from(chatTurns).where(eq(chatTurns.organizationId, job.organizationId)),
    db.select().from(requestLogs).where(eq(requestLogs.organizationId, job.organizationId)),
    db.select().from(usageEvents).where(eq(usageEvents.organizationId, job.organizationId)),
    db.select().from(operationalAlerts).where(eq(operationalAlerts.organizationId, job.organizationId)),
    db.select().from(knowledgeImportJobs).where(eq(knowledgeImportJobs.organizationId, job.organizationId)),
    db
      .select()
      .from(knowledgeImportJobFiles)
      .where(eq(knowledgeImportJobFiles.organizationId, job.organizationId)),
    db.select().from(sandboxRuns).where(eq(sandboxRuns.organizationId, job.organizationId)),
    db
      .select()
      .from(sandboxGeneratedAssets)
      .where(
        inArray(
          sandboxGeneratedAssets.runId,
          db
            .select({ runId: sandboxRuns.runId })
            .from(sandboxRuns)
            .where(eq(sandboxRuns.organizationId, job.organizationId)),
        ),
      )
      .catch(() => []),
  ]);

  const turnIds = turnRows.map((row) => row.id);
  const assistantRows =
    turnIds.length > 0
      ? await db.select().from(assistantMessages).where(inArray(assistantMessages.turnId, turnIds))
      : [];
  const toolCallRows =
    turnIds.length > 0
      ? await db.select().from(toolCalls).where(inArray(toolCalls.turnId, turnIds))
      : [];
  const retrievalRunRows =
    turnIds.length > 0
      ? await db.select().from(retrievalRuns).where(inArray(retrievalRuns.turnId, turnIds))
      : [];
  const retrievalRunIds = retrievalRunRows.map((row) => row.id);
  const retrievalRewriteRows =
    retrievalRunIds.length > 0
      ? await db
          .select()
          .from(retrievalRewrites)
          .where(inArray(retrievalRewrites.retrievalRunId, retrievalRunIds))
      : [];
  const retrievalCandidateRows =
    retrievalRunIds.length > 0
      ? await db
          .select()
          .from(retrievalCandidates)
          .where(inArray(retrievalCandidates.retrievalRunId, retrievalRunIds))
      : [];

  await writeJsonFile(path.join(stagingDir, "manifest.json"), {
    exportedAt: new Date().toISOString(),
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    schemaVersion: 1,
    sourceRepositoryRoot: repositoryRoot,
    totals: {
      alerts: alertRows.length,
      conversations: conversationRows.length,
      documents: documentRows.length,
      governanceJobId: job.id,
      importJobFiles: importJobFileRows.length,
      importJobs: importJobRows.length,
      memberships: membershipRows.length,
      requestLogs: requestLogRows.length,
      sandboxAssets: sandboxAssetRows.length,
      sandboxRuns: sandboxRunRows.length,
      turns: turnRows.length,
      usageEvents: usageRows.length,
    },
  });

  await writeJsonFile(path.join(stagingDir, "db", "organization.json"), organization);
  await writeJsonFile(path.join(stagingDir, "db", "memberships.json"), membershipRows);
  await writeJsonFile(path.join(stagingDir, "db", "documents.json"), documentRows);
  await writeJsonFile(path.join(stagingDir, "db", "conversations.json"), conversationRows);
  await writeJsonFile(path.join(stagingDir, "db", "chat_turns.json"), turnRows);
  await writeJsonFile(path.join(stagingDir, "db", "assistant_messages.json"), assistantRows);
  await writeJsonFile(path.join(stagingDir, "db", "tool_calls.json"), toolCallRows);
  await writeJsonFile(path.join(stagingDir, "db", "retrieval_runs.json"), retrievalRunRows);
  await writeJsonFile(path.join(stagingDir, "db", "retrieval_rewrites.json"), retrievalRewriteRows);
  await writeJsonFile(
    path.join(stagingDir, "db", "retrieval_candidates.json"),
    retrievalCandidateRows,
  );
  await writeJsonFile(path.join(stagingDir, "db", "request_logs.json"), requestLogRows);
  await writeJsonFile(path.join(stagingDir, "db", "usage_events.json"), usageRows);
  await writeJsonFile(path.join(stagingDir, "db", "operational_alerts.json"), alertRows);
  await writeJsonFile(path.join(stagingDir, "db", "knowledge_import_jobs.json"), importJobRows);
  await writeJsonFile(
    path.join(stagingDir, "db", "knowledge_import_job_files.json"),
    importJobFileRows,
  );
  await writeJsonFile(path.join(stagingDir, "db", "sandbox_runs.json"), sandboxRunRows);
  await writeJsonFile(
    path.join(stagingDir, "db", "sandbox_generated_assets.json"),
    sandboxAssetRows,
  );

  const companyDataRoot = await resolveCompanyDataRoot(organization.slug);
  const copiedFiles: string[] = [];

  for (const documentRow of documentRows) {
    const sourceType = String(documentRow.sourceType);

    if (sourceType !== "uploaded" && sourceType !== "bulk_import") {
      continue;
    }

    const sourcePath = path.join(companyDataRoot, documentRow.sourcePath);

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const targetPath = path.join(stagingDir, "files", documentRow.sourcePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
    copiedFiles.push(documentRow.sourcePath);
  }

  await execFileAsync("tar", ["-czf", artifactPath, "-C", stagingDir, "."]);
  const artifactStats = await stat(artifactPath);
  await removePathQuietly(stagingDir);

  return {
    artifactByteSize: artifactStats.size,
    artifactFileName: path.basename(artifactPath),
    artifactStoragePath: artifactPath,
    result: {
      copiedFileCount: copiedFiles.length,
      exportedDocumentCount: documentRows.length,
      exportedMembershipCount: membershipRows.length,
    },
  };
}

async function purgeHistoryRows(organizationId: string, cutoffTimestamp: number) {
  const db = await getAppDatabase();
  const turnsToDelete = await db
    .select({ id: chatTurns.id })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.organizationId, organizationId),
        lt(chatTurns.createdAt, cutoffTimestamp),
      ),
    );
  const turnIds = turnsToDelete.map((row) => row.id);
  const conversationsToDelete = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        lt(conversations.createdAt, cutoffTimestamp),
      ),
    );
  const conversationIds = conversationsToDelete.map((row) => row.id);

  if (turnIds.length > 0) {
    await db.delete(chatTurns).where(inArray(chatTurns.id, turnIds));
  }

  if (conversationIds.length > 0) {
    await db.delete(conversations).where(inArray(conversations.id, conversationIds));
  }

  return {
    deletedConversationCount: conversationIds.length,
    deletedTurnCount: turnIds.length,
  };
}

async function purgeImportMetadataRows(organizationId: string, cutoffTimestamp: number) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: knowledgeImportJobs.id,
    })
    .from(knowledgeImportJobs)
    .where(
      and(
        eq(knowledgeImportJobs.organizationId, organizationId),
        inArray(knowledgeImportJobs.status, [
          "completed",
          "completed_with_errors",
          "failed",
        ]),
        lt(knowledgeImportJobs.updatedAt, cutoffTimestamp),
      ),
    );
  const jobIds = rows.map((row) => row.id);

  if (jobIds.length > 0) {
    const files = await db
      .select({
        stagingStoragePath: knowledgeImportJobFiles.stagingStoragePath,
      })
      .from(knowledgeImportJobFiles)
      .where(inArray(knowledgeImportJobFiles.jobId, jobIds));

    for (const file of files) {
      await removePathQuietly(file.stagingStoragePath);
    }

    await db.delete(knowledgeImportJobs).where(inArray(knowledgeImportJobs.id, jobIds));
  }

  return {
    deletedImportJobCount: jobIds.length,
  };
}

async function purgeKnowledgeFiles(organizationSlug: string, organizationId: string, cutoffTimestamp: number) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: documents.id,
      sourcePath: documents.sourcePath,
    })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        inArray(documents.sourceType, ["uploaded", "bulk_import"]),
        lt(documents.createdAt, cutoffTimestamp),
      ),
    );
  const documentIds = rows.map((row) => row.id);

  if (documentIds.length > 0) {
    const companyDataRoot = await resolveCompanyDataRoot(organizationSlug);

    for (const row of rows) {
      await unlink(path.join(companyDataRoot, row.sourcePath)).catch(() => undefined);
    }

    await db.delete(documents).where(inArray(documents.id, documentIds));
  }

  return {
    deletedKnowledgeFileCount: documentIds.length,
  };
}

async function processGovernanceJob(job: GovernanceJobRow) {
  const organization = await getOrganizationContext(job.organizationId);

  if (job.jobType === "organization_export") {
    return buildExportBundle(job);
  }

  if (!job.cutoffTimestamp) {
    throw new Error("Deletion and purge jobs require a cutoff timestamp.");
  }

  if (job.jobType === "history_purge") {
    return {
      result: await purgeHistoryRows(job.organizationId, job.cutoffTimestamp),
    };
  }

  if (job.jobType === "import_metadata_purge") {
    return {
      result: await purgeImportMetadataRows(job.organizationId, job.cutoffTimestamp),
    };
  }

  if (job.jobType === "knowledge_delete") {
    return {
      result: await purgeKnowledgeFiles(
        organization.slug,
        job.organizationId,
        job.cutoffTimestamp,
      ),
    };
  }

  throw new Error(`Unsupported governance job type: ${job.jobType}`);
}

async function runGovernanceWorker() {
  try {
    while (true) {
      governanceWorkerWakeRequested = false;
      const nextJob = await claimNextGovernanceJob();

      if (!nextJob) {
        if (!governanceWorkerWakeRequested) {
          break;
        }

        continue;
      }

      try {
        const outcome = await processGovernanceJob(nextJob);
        await updateGovernanceJobSuccess({
          artifactByteSize:
            "artifactByteSize" in outcome ? outcome.artifactByteSize : null,
          artifactFileName:
            "artifactFileName" in outcome ? outcome.artifactFileName : null,
          artifactStoragePath:
            "artifactStoragePath" in outcome ? outcome.artifactStoragePath : null,
          jobId: nextJob.id,
          result: outcome.result ?? {},
        });
      } catch (caughtError) {
        await updateGovernanceJobFailure(
          nextJob.id,
          asErrorMessage(caughtError, "Governance job failed."),
        );
      }
    }
  } catch (caughtError) {
    logStructuredError("governance.worker_failed", caughtError);
    throw caughtError;
  }
}

export async function getGovernanceArtifactDownload(input: {
  jobId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const row = await db.query.governanceJobs.findFirst({
    where: and(
      eq(governanceJobs.id, input.jobId),
      eq(governanceJobs.organizationId, input.organizationId),
    ),
  });

  if (!row || row.status !== "completed" || !row.artifactStoragePath || !row.artifactFileName) {
    throw new Error("Governance artifact not found.");
  }

  if (!(await pathExists(row.artifactStoragePath))) {
    throw new Error("Governance artifact is no longer available.");
  }

  return {
    fileName: row.artifactFileName,
    path: row.artifactStoragePath,
  };
}

async function createAutomaticRetentionJob(input: {
  cutoffTimestamp: number;
  jobType: GovernanceJobType;
  organizationId: string;
  result: Record<string, unknown>;
  targetLabel: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(governanceJobs).values({
    artifactByteSize: null,
    artifactFileName: null,
    artifactStoragePath: null,
    completedAt: now,
    createdAt: now,
    cutoffTimestamp: input.cutoffTimestamp,
    errorMessage: null,
    id: randomUUID(),
    jobType: input.jobType,
    metadataJson: JSON.stringify({
      source: "automatic_retention",
    }),
    organizationId: input.organizationId,
    requestedByUserId: null,
    resultJson: JSON.stringify(input.result),
    startedAt: now,
    status: "completed",
    targetLabel: input.targetLabel,
    triggerKind: "automatic",
    updatedAt: now,
  });
}

async function cleanupExpiredGovernanceArtifactsForOrganization(input: {
  organizationId: string;
  organizationSlug: string;
  retentionDays: number;
}) {
  const cutoffTimestamp = Date.now() - getRetentionWindowMs(input.retentionDays);
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(governanceJobs)
    .where(
      and(
        eq(governanceJobs.organizationId, input.organizationId),
        eq(governanceJobs.jobType, "organization_export"),
        lt(governanceJobs.completedAt, cutoffTimestamp),
      ),
    );

  let deletedArtifactCount = 0;

  for (const row of rows) {
    if (row.artifactStoragePath) {
      await unlink(row.artifactStoragePath).catch(() => undefined);
      deletedArtifactCount += 1;
    }

    await db
      .update(governanceJobs)
      .set({
        artifactByteSize: null,
        artifactFileName: null,
        artifactStoragePath: null,
        updatedAt: Date.now(),
      })
      .where(eq(governanceJobs.id, row.id));
  }

  if (deletedArtifactCount > 0) {
    await createAutomaticRetentionJob({
      cutoffTimestamp,
      jobType: "organization_export",
      organizationId: input.organizationId,
      result: {
        deletedArtifactCount,
      },
      targetLabel: "export_artifacts",
    });
  }
}

async function purgeOrgScopedRequestLogs(input: {
  cutoffTimestamp: number;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({ id: requestLogs.id })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.organizationId, input.organizationId),
        lt(requestLogs.completedAt, input.cutoffTimestamp),
      ),
    );

  if (rows.length > 0) {
    await db.delete(requestLogs).where(inArray(requestLogs.id, rows.map((row) => row.id)));
  }

  return rows.length;
}

async function purgeOrgScopedUsageEvents(input: {
  cutoffTimestamp: number;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, input.organizationId),
        lt(usageEvents.createdAt, input.cutoffTimestamp),
      ),
    );

  if (rows.length > 0) {
    await db.delete(usageEvents).where(inArray(usageEvents.id, rows.map((row) => row.id)));
  }

  return rows.length;
}

async function purgeOrgScopedAlerts(input: {
  cutoffTimestamp: number;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({ id: operationalAlerts.id })
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.organizationId, input.organizationId),
        lt(operationalAlerts.lastSeenAt, input.cutoffTimestamp),
      ),
    );

  if (rows.length > 0) {
    await db.delete(operationalAlerts).where(inArray(operationalAlerts.id, rows.map((row) => row.id)));
  }

  return rows.length;
}

export async function getOrganizationRetentionOverrides(input: {
  organizationId: string;
}) {
  const settings = await getOrganizationComplianceSettings(input.organizationId);

  return {
    alertRetentionDays: settings.alertRetentionDays,
    requestLogRetentionDays: settings.requestLogRetentionDays,
    usageRetentionDays: settings.usageRetentionDays,
  };
}

export async function runGovernanceMaintenance() {
  const now = Date.now();

  if (now - lastGovernanceMaintenanceAt < 60 * 1000) {
    return;
  }

  lastGovernanceMaintenanceAt = now;

  const db = await getAppDatabase();
  const settingsRows = await db
    .select({
      organizationId: organizations.id,
      organizationSlug: organizations.slug,
      requestLogRetentionDays: organizationComplianceSettings.requestLogRetentionDays,
      usageRetentionDays: organizationComplianceSettings.usageRetentionDays,
      alertRetentionDays: organizationComplianceSettings.alertRetentionDays,
      chatHistoryRetentionDays: organizationComplianceSettings.chatHistoryRetentionDays,
      knowledgeImportRetentionDays: organizationComplianceSettings.knowledgeImportRetentionDays,
      exportArtifactRetentionDays: organizationComplianceSettings.exportArtifactRetentionDays,
    })
    .from(organizations)
    .leftJoin(
      organizationComplianceSettings,
      eq(organizationComplianceSettings.organizationId, organizations.id),
    );

  for (const row of settingsRows) {
    const exportArtifactRetentionDays = Math.max(
      1,
      Math.trunc(row.exportArtifactRetentionDays ?? 7),
    );

    await cleanupExpiredGovernanceArtifactsForOrganization({
      organizationId: row.organizationId,
      organizationSlug: row.organizationSlug,
      retentionDays: exportArtifactRetentionDays,
    });

    if (row.chatHistoryRetentionDays) {
      const cutoffTimestamp = now - getRetentionWindowMs(row.chatHistoryRetentionDays);
      const result = await purgeHistoryRows(row.organizationId, cutoffTimestamp);

      if (result.deletedConversationCount > 0 || result.deletedTurnCount > 0) {
        await createAutomaticRetentionJob({
          cutoffTimestamp,
          jobType: "history_purge",
          organizationId: row.organizationId,
          result,
          targetLabel: "chat_history_retention",
        });
      }
    }

    if (row.knowledgeImportRetentionDays) {
      const cutoffTimestamp = now - getRetentionWindowMs(row.knowledgeImportRetentionDays);
      const result = await purgeImportMetadataRows(row.organizationId, cutoffTimestamp);

      if (result.deletedImportJobCount > 0) {
        await createAutomaticRetentionJob({
          cutoffTimestamp,
          jobType: "import_metadata_purge",
          organizationId: row.organizationId,
          result,
          targetLabel: "knowledge_import_retention",
        });
      }
    }

    if (row.requestLogRetentionDays) {
      const cutoffTimestamp = now - getRetentionWindowMs(row.requestLogRetentionDays);
      const deletedCount = await purgeOrgScopedRequestLogs({
        cutoffTimestamp,
        organizationId: row.organizationId,
      });

      if (deletedCount > 0) {
        await createAutomaticRetentionJob({
          cutoffTimestamp,
          jobType: "history_purge",
          organizationId: row.organizationId,
          result: { deletedRequestLogCount: deletedCount },
          targetLabel: "request_log_retention",
        });
      }
    }

    if (row.usageRetentionDays) {
      const cutoffTimestamp = now - getRetentionWindowMs(row.usageRetentionDays);
      const deletedCount = await purgeOrgScopedUsageEvents({
        cutoffTimestamp,
        organizationId: row.organizationId,
      });

      if (deletedCount > 0) {
        await createAutomaticRetentionJob({
          cutoffTimestamp,
          jobType: "history_purge",
          organizationId: row.organizationId,
          result: { deletedUsageEventCount: deletedCount },
          targetLabel: "usage_event_retention",
        });
      }
    }

    if (row.alertRetentionDays) {
      const cutoffTimestamp = now - getRetentionWindowMs(row.alertRetentionDays);
      const deletedCount = await purgeOrgScopedAlerts({
        cutoffTimestamp,
        organizationId: row.organizationId,
      });

      if (deletedCount > 0) {
        await createAutomaticRetentionJob({
          cutoffTimestamp,
          jobType: "history_purge",
          organizationId: row.organizationId,
          result: { deletedAlertCount: deletedCount },
          targetLabel: "operational_alert_retention",
        });
      }
    }
  }
}

export function getFallbackOperationsRetentionDefaults() {
  return {
    alertRetentionDays: OPERATIONS_ALERT_RETENTION_DAYS,
    requestLogRetentionDays: OPERATIONS_REQUEST_LOG_RETENTION_DAYS,
    usageRetentionDays: OPERATIONS_USAGE_RETENTION_DAYS,
  };
}
