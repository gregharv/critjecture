import "server-only";

import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { ensureOrganizationGeneratedAssetsRoot, resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/legacy-app-db";
import {
  organizations,
  sandboxGeneratedAssets,
  sandboxRuns,
  toolCalls,
  users,
} from "@/lib/legacy-app-schema";
import type { UserRole } from "@/lib/roles";
import {
  getSandboxExecutionBackend,
  getSandboxLimitsSnapshot,
  getSandboxRunnerForBackend,
  SANDBOX_MAX_ACTIVE_RUNS_GLOBAL,
  SANDBOX_MAX_ACTIVE_RUNS_PER_USER,
  SANDBOX_SUPERVISOR_LEASE_MS,
  SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS,
  SANDBOX_WORKSPACE_DIR,
  type SandboxExecutionBackend,
} from "@/lib/sandbox-policy";

export type SandboxRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "finalizing"
  | "completed"
  | "failed"
  | "timed_out"
  | "rejected"
  | "abandoned";

export type SandboxCleanupStatus = "pending" | "completed" | "failed" | "skipped";

export type SandboxTerminalStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "rejected"
  | "abandoned";

type PersistedGeneratedSandboxAsset = {
  byteSize: number;
  downloadUrl: string;
  expiresAt: number;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

export type SandboxInlineWorkspaceFile = {
  content: string;
  relativePath: string;
};

type SandboxRunRow = typeof sandboxRuns.$inferSelect;

const ACTIVE_SANDBOX_RUN_STATUSES = ["starting", "running", "finalizing"] as const;
const TERMINAL_SANDBOX_RUN_STATUSES = [
  "completed",
  "failed",
  "timed_out",
  "rejected",
  "abandoned",
] as const;
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseGeneratedAssetsJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseInputFilesJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseInlineWorkspaceFilesJson(value: string): SandboxInlineWorkspaceFile[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }

      const entryRecord = entry as Record<string, unknown>;
      const relativePath =
        typeof entryRecord.relativePath === "string" ? entryRecord.relativePath.trim() : "";
      const content = typeof entryRecord.content === "string" ? entryRecord.content : null;

      if (!relativePath || content === null) {
        return [];
      }

      return [{ content, relativePath }];
    });
  } catch {
    return [];
  }
}

function isTerminalSandboxRunStatus(status: SandboxRunStatus): status is SandboxTerminalStatus {
  return (TERMINAL_SANDBOX_RUN_STATUSES as readonly string[]).includes(status);
}

async function removeDirectoryIfPresent(targetPath: string) {
  await rm(targetPath, { force: true, recursive: true }).catch(() => {});
}

async function countActiveRuns(input: {
  backend: SandboxExecutionBackend;
  userId?: string;
}) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(sandboxRuns.backend, input.backend),
    inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES]),
  ];

  if (input.userId) {
    whereClauses.push(eq(sandboxRuns.userId, input.userId));
  }

  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(sandboxRuns)
    .where(and(...whereClauses));

  return Number(rows[0]?.count ?? 0);
}

async function cleanupOrphanedSandboxWorkspaces() {
  const db = await getAppDatabase();
  const entries = await readdir(SANDBOX_WORKSPACE_DIR, { withFileTypes: true }).catch(() => []);

  if (entries.length === 0) {
    return;
  }

  const liveRows = await db
    .select({
      runId: sandboxRuns.runId,
    })
    .from(sandboxRuns)
    .where(
      and(
        inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES]),
        isNotNull(sandboxRuns.workspacePath),
      ),
    );
  const liveRunIds = new Set(liveRows.map((row) => row.runId));

  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID_PATTERN.test(entry.name) || liveRunIds.has(entry.name)) {
      continue;
    }

    await removeDirectoryIfPresent(path.join(SANDBOX_WORKSPACE_DIR, entry.name));
  }
}

function mapSandboxRunRow(
  row: SandboxRunRow,
  assetRows: Array<typeof sandboxGeneratedAssets.$inferSelect>,
) {
  return {
    artifactMaxBytes: row.artifactMaxBytes,
    artifactTtlMs: row.artifactTtlMs,
    backend: row.backend,
    cleanupAttemptCount: row.cleanupAttemptCount,
    cleanupCompletedAt: row.cleanupCompletedAt,
    cleanupError: row.cleanupError,
    cleanupStatus: row.cleanupStatus,
    codeText: row.codeText,
    completedAt: row.completedAt,
    cpuLimitSeconds: row.cpuLimitSeconds,
    createdAt: row.createdAt,
    exitCode: row.exitCode,
    failureReason: row.failureReason,
    generatedAssets:
      assetRows.length > 0
        ? assetRows.map((assetRow) => ({
            byteSize: assetRow.byteSize,
            expiresAt: assetRow.expiresAt,
            fileName: assetRow.fileName,
            mimeType: assetRow.mimeType,
            relativePath: assetRow.relativePath,
            storagePath: assetRow.storagePath,
          }))
        : parseGeneratedAssetsJson(row.generatedAssetsJson),
    inputFiles: parseInputFilesJson(row.inputFilesJson),
    inlineWorkspaceFiles: parseInlineWorkspaceFilesJson(row.inlineWorkspaceFilesJson),
    lastHeartbeatAt: row.lastHeartbeatAt,
    leaseExpiresAt: row.leaseExpiresAt,
    maxProcesses: row.maxProcesses,
    memoryLimitBytes: row.memoryLimitBytes,
    organizationId: row.organizationId,
    reconciliationCount: row.reconciliationCount,
    runId: row.runId,
    runner: row.runner,
    runtimeToolCallId: row.runtimeToolCallId,
    startedAt: row.startedAt,
    status: row.status as SandboxRunStatus,
    stderrText: row.stderrText,
    stdoutMaxBytes: row.stdoutMaxBytes,
    stdoutText: row.stdoutText,
    supervisorId: row.supervisorId,
    timeoutMs: row.timeoutMs,
    toolName: row.toolName,
    turnId: row.turnId,
    userId: row.userId,
    workspacePath: row.workspacePath,
  };
}

async function getSandboxRunRow(runId: string) {
  const db = await getAppDatabase();

  return db.query.sandboxRuns.findFirst({
    where: eq(sandboxRuns.runId, runId),
  });
}

export async function cleanupExpiredSandboxArtifacts(input: {
  now?: number;
  organizationId: string;
  organizationSlug: string;
}) {
  const now = input.now ?? Date.now();
  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: sandboxGeneratedAssets.id,
      storagePath: sandboxGeneratedAssets.storagePath,
    })
    .from(sandboxGeneratedAssets)
    .innerJoin(sandboxRuns, eq(sandboxRuns.runId, sandboxGeneratedAssets.runId))
    .where(
      and(
        eq(sandboxRuns.organizationId, input.organizationId),
        lt(sandboxGeneratedAssets.expiresAt, now),
      ),
    )
    .orderBy(asc(sandboxGeneratedAssets.expiresAt));

  if (rows.length === 0) {
    return;
  }

  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);

  for (const row of rows) {
    await removeDirectoryIfPresent(path.join(organizationRoot, row.storagePath));
    await db.delete(sandboxGeneratedAssets).where(eq(sandboxGeneratedAssets.id, row.id));
  }
}

export async function queueSandboxRun(input: {
  code: string;
  inputFiles?: string[];
  inlineWorkspaceFiles?: SandboxInlineWorkspaceFile[];
  organizationId: string;
  runtimeToolCallId?: string;
  toolName: string;
  turnId?: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const limits = getSandboxLimitsSnapshot();
  const backend = getSandboxExecutionBackend();
  const runId = randomUUID();

  await db.insert(sandboxRuns).values({
    artifactMaxBytes: limits.artifactMaxBytes,
    artifactTtlMs: limits.artifactTtlMs,
    backend,
    cleanupStatus: backend === "local_supervisor" ? "pending" : "skipped",
    codeText: input.code,
    cpuLimitSeconds: limits.cpuLimitSeconds,
    createdAt: now,
    inputFilesJson: JSON.stringify(input.inputFiles ?? []),
    inlineWorkspaceFilesJson: JSON.stringify(input.inlineWorkspaceFiles ?? []),
    maxProcesses: limits.maxProcesses,
    memoryLimitBytes: limits.memoryLimitBytes,
    organizationId: input.organizationId,
    runId,
    runner: getSandboxRunnerForBackend(backend),
    runtimeToolCallId: input.runtimeToolCallId ?? null,
    startedAt: 0,
    status: "queued",
    stdoutMaxBytes: limits.stdoutMaxBytes,
    timeoutMs: limits.timeoutMs,
    toolName: input.toolName,
    turnId: input.turnId ?? null,
    userId: input.userId,
  });

  return {
    backend,
    limits,
    runId,
  };
}

export async function rejectSandboxRun(input: {
  completedAt?: number;
  failureReason: string;
  runId: string;
  stderrText?: string | null;
  stdoutText?: string | null;
}) {
  const db = await getAppDatabase();
  const completedAt = input.completedAt ?? Date.now();

  await db
    .update(sandboxRuns)
    .set({
      cleanupCompletedAt: completedAt,
      cleanupStatus: "skipped",
      completedAt,
      failureReason: input.failureReason,
      startedAt: sql`CASE WHEN ${sandboxRuns.startedAt} = 0 THEN ${completedAt} ELSE ${sandboxRuns.startedAt} END`,
      status: "rejected",
      stderrText: input.stderrText ?? null,
      stdoutText: input.stdoutText ?? null,
    })
    .where(eq(sandboxRuns.runId, input.runId));
}

export async function claimNextQueuedSandboxRun(input: {
  backend: SandboxExecutionBackend;
  supervisorId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  while (true) {
    const candidate = await db.query.sandboxRuns.findFirst({
      where: and(
        eq(sandboxRuns.backend, input.backend),
        eq(sandboxRuns.status, "queued"),
      ),
      orderBy: [asc(sandboxRuns.createdAt)],
    });

    if (!candidate) {
      return null;
    }

    const [activeUserRuns, activeGlobalRuns] = await Promise.all([
      countActiveRuns({
        backend: input.backend,
        userId: candidate.userId,
      }),
      countActiveRuns({
        backend: input.backend,
      }),
    ]);

    const rejectionReason =
      activeUserRuns >= SANDBOX_MAX_ACTIVE_RUNS_PER_USER
        ? "per-user-concurrency-limit"
        : activeGlobalRuns >= SANDBOX_MAX_ACTIVE_RUNS_GLOBAL
          ? "global-concurrency-limit"
          : null;

    if (rejectionReason) {
      await db
        .update(sandboxRuns)
        .set({
          cleanupCompletedAt: now,
          cleanupStatus: "skipped",
          completedAt: now,
          failureReason: rejectionReason,
          status: "rejected",
        })
        .where(
          and(eq(sandboxRuns.runId, candidate.runId), eq(sandboxRuns.status, "queued")),
        );
      continue;
    }

    await db
      .update(sandboxRuns)
      .set({
        lastHeartbeatAt: now,
        leaseExpiresAt: now + SANDBOX_SUPERVISOR_LEASE_MS,
        startedAt: now,
        status: "starting",
        supervisorId: input.supervisorId,
      })
      .where(and(eq(sandboxRuns.runId, candidate.runId), eq(sandboxRuns.status, "queued")));

    const claimed = await getSandboxRunRow(candidate.runId);

    if (claimed?.status === "starting") {
      return claimed;
    }
  }
}

export async function markSandboxRunRunning(input: {
  runId: string;
  runner?: string;
  workspacePath?: string | null;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(sandboxRuns)
    .set({
      lastHeartbeatAt: now,
      leaseExpiresAt: now + SANDBOX_SUPERVISOR_LEASE_MS,
      runner: input.runner ?? undefined,
      startedAt: sql`CASE WHEN ${sandboxRuns.startedAt} = 0 THEN ${now} ELSE ${sandboxRuns.startedAt} END`,
      status: "running",
      workspacePath: input.workspacePath ?? null,
    })
    .where(eq(sandboxRuns.runId, input.runId));
}

export async function markSandboxRunFinalizing(runId: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(sandboxRuns)
    .set({
      lastHeartbeatAt: now,
      leaseExpiresAt: now + SANDBOX_SUPERVISOR_LEASE_MS,
      status: "finalizing",
    })
    .where(eq(sandboxRuns.runId, runId));
}

export async function heartbeatSandboxRun(runId: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(sandboxRuns)
    .set({
      lastHeartbeatAt: now,
      leaseExpiresAt: now + SANDBOX_SUPERVISOR_LEASE_MS,
    })
    .where(eq(sandboxRuns.runId, runId));
}

export async function reconcileStaleSandboxRuns(now = Date.now()) {
  const db = await getAppDatabase();
  const staleRuns = await db.query.sandboxRuns.findMany({
    where: and(
      inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES]),
      or(
        lt(sandboxRuns.leaseExpiresAt, now),
        and(
          eq(sandboxRuns.status, "running"),
          lt(sandboxRuns.startedAt, now - SANDBOX_SUPERVISOR_LEASE_MS),
        ),
      ),
    ),
  });

  for (const staleRun of staleRuns) {
    const workspacePath =
      staleRun.workspacePath ?? path.join(SANDBOX_WORKSPACE_DIR, staleRun.runId);
    let cleanupStatus: SandboxCleanupStatus = "completed";
    let cleanupError: string | null = null;

    try {
      await removeDirectoryIfPresent(workspacePath);
    } catch (caughtError) {
      cleanupStatus = "failed";
      cleanupError = caughtError instanceof Error ? caughtError.message : String(caughtError);
    }

    await db
      .update(sandboxRuns)
      .set({
        cleanupAttemptCount: sql`${sandboxRuns.cleanupAttemptCount} + 1`,
        cleanupCompletedAt: now,
        cleanupError,
        cleanupStatus,
        completedAt: now,
        failureReason: staleRun.failureReason ?? "stale-run-reconciled",
        leaseExpiresAt: null,
        reconciliationCount: sql`${sandboxRuns.reconciliationCount} + 1`,
        status: "abandoned",
        workspacePath: null,
      })
      .where(
        and(
          eq(sandboxRuns.runId, staleRun.runId),
          inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES]),
        ),
      );
  }

  await cleanupOrphanedSandboxWorkspaces();
}

export async function completeSandboxRun(input: {
  completedAt?: number;
  exitCode?: number | null;
  failureReason?: string | null;
  generatedAssets?: PersistedGeneratedSandboxAsset[];
  runId: string;
  runner?: string;
  status: SandboxTerminalStatus;
  stderrText?: string | null;
  stdoutText?: string | null;
}) {
  const db = await getAppDatabase();
  const completedAt = input.completedAt ?? Date.now();

  await db
    .update(sandboxRuns)
    .set({
      completedAt,
      exitCode: input.exitCode ?? null,
      failureReason: input.failureReason ?? null,
      generatedAssetsJson: JSON.stringify(input.generatedAssets ?? []),
      lastHeartbeatAt: completedAt,
      leaseExpiresAt: null,
      runner: input.runner ?? undefined,
      status: input.status,
      stderrText: input.stderrText ?? null,
      stdoutText: input.stdoutText ?? null,
    })
    .where(eq(sandboxRuns.runId, input.runId));
}

export async function markSandboxRunCleanup(input: {
  cleanupCompletedAt?: number;
  cleanupError?: string | null;
  cleanupStatus: SandboxCleanupStatus;
  incrementAttempt?: boolean;
  runId: string;
}) {
  const db = await getAppDatabase();
  const cleanupCompletedAt = input.cleanupCompletedAt ?? Date.now();

  await db
    .update(sandboxRuns)
    .set({
      cleanupAttemptCount: input.incrementAttempt
        ? sql`${sandboxRuns.cleanupAttemptCount} + 1`
        : undefined,
      cleanupCompletedAt,
      cleanupError: input.cleanupError ?? null,
      cleanupStatus: input.cleanupStatus,
      leaseExpiresAt: null,
      workspacePath:
        input.cleanupStatus === "completed" || input.cleanupStatus === "skipped"
          ? null
          : undefined,
    })
    .where(eq(sandboxRuns.runId, input.runId));
}

export async function waitForSandboxRunTerminal(
  runId: string,
  timeoutMs = SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const sandboxRun = await getSandboxRunByRunId(runId);

    if (sandboxRun && isTerminalSandboxRunStatus(sandboxRun.status)) {
      return sandboxRun;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for sandbox run ${runId} to reach a terminal state.`);
}

export async function getSandboxRunExecutionPayload(runId: string) {
  const db = await getAppDatabase();
  const row = await db
    .select({
      backend: sandboxRuns.backend,
      codeText: sandboxRuns.codeText,
      inputFilesJson: sandboxRuns.inputFilesJson,
      inlineWorkspaceFilesJson: sandboxRuns.inlineWorkspaceFilesJson,
      organizationId: sandboxRuns.organizationId,
      organizationSlug: organizations.slug,
      runId: sandboxRuns.runId,
      runtimeToolCallId: sandboxRuns.runtimeToolCallId,
      timeoutMs: sandboxRuns.timeoutMs,
      toolName: sandboxRuns.toolName,
      turnId: sandboxRuns.turnId,
      userId: sandboxRuns.userId,
      userRole: users.role,
    })
    .from(sandboxRuns)
    .innerJoin(organizations, eq(organizations.id, sandboxRuns.organizationId))
    .innerJoin(users, eq(users.id, sandboxRuns.userId))
    .where(eq(sandboxRuns.runId, runId))
    .limit(1);
  const payload = row[0];

  if (!payload || !payload.organizationId || !payload.organizationSlug) {
    return null;
  }

  return {
    backend: payload.backend as SandboxExecutionBackend,
    code: payload.codeText,
    inputFiles: parseInputFilesJson(payload.inputFilesJson),
    inlineWorkspaceFiles: parseInlineWorkspaceFilesJson(payload.inlineWorkspaceFilesJson),
    organizationId: payload.organizationId,
    organizationSlug: payload.organizationSlug,
    role: payload.userRole as UserRole,
    runId: payload.runId,
    runtimeToolCallId: payload.runtimeToolCallId,
    timeoutMs: payload.timeoutMs,
    toolName: payload.toolName,
    turnId: payload.turnId,
    userId: payload.userId,
  };
}

export async function attachSandboxRunToToolCall(input: {
  runtimeToolCallId: string;
  sandboxRunId: string;
  turnId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(toolCalls)
    .set({
      sandboxRunId: input.sandboxRunId,
    })
    .where(
      and(
        eq(toolCalls.runtimeToolCallId, input.runtimeToolCallId),
        eq(toolCalls.turnId, input.turnId),
      ),
    );
}

export async function replaceSandboxGeneratedAssets(input: {
  assets: Array<
    PersistedGeneratedSandboxAsset & {
      storagePath: string;
    }
  >;
  runId: string;
}) {
  const db = await getAppDatabase();

  await db.delete(sandboxGeneratedAssets).where(eq(sandboxGeneratedAssets.runId, input.runId));

  if (input.assets.length === 0) {
    return;
  }

  await db.insert(sandboxGeneratedAssets).values(
    input.assets.map((asset) => ({
      byteSize: asset.byteSize,
      createdAt: Date.now(),
      expiresAt: asset.expiresAt,
      fileName: asset.fileName,
      id: randomUUID(),
      mimeType: asset.mimeType,
      relativePath: asset.relativePath,
      runId: input.runId,
      storagePath: asset.storagePath,
    })),
  );
}

export async function ensureSandboxAssetStorageRoot(organizationSlug: string, runId: string) {
  const generatedAssetsRoot = await ensureOrganizationGeneratedAssetsRoot(organizationSlug);
  const runRoot = path.join(generatedAssetsRoot, runId);

  return {
    runRoot,
    storagePrefix: path.posix.join("generated_assets", runId),
  };
}

export async function getSandboxRunByRunId(runId: string) {
  const db = await getAppDatabase();
  const row = await db.query.sandboxRuns.findFirst({
    where: eq(sandboxRuns.runId, runId),
  });

  if (!row) {
    return null;
  }

  const assetRows = await db.query.sandboxGeneratedAssets.findMany({
    where: eq(sandboxGeneratedAssets.runId, runId),
    orderBy: [asc(sandboxGeneratedAssets.relativePath)],
  });

  return mapSandboxRunRow(row, assetRows);
}

export async function getSandboxGeneratedAsset(runId: string, relativePath: string) {
  const db = await getAppDatabase();
  const row = await db.query.sandboxGeneratedAssets.findFirst({
    where: and(
      eq(sandboxGeneratedAssets.runId, runId),
      eq(sandboxGeneratedAssets.relativePath, relativePath),
    ),
  });

  if (!row) {
    return null;
  }

  return {
    byteSize: row.byteSize,
    expiresAt: row.expiresAt,
    fileName: row.fileName,
    mimeType: row.mimeType,
    relativePath: row.relativePath,
    runId: row.runId,
    storagePath: row.storagePath,
  };
}

export async function removeSandboxGeneratedAssetFile(input: {
  organizationSlug: string;
  storagePath: string;
}) {
  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);
  await removeDirectoryIfPresent(path.join(organizationRoot, input.storagePath));
}

export async function getSandboxHealthSnapshot() {
  const db = await getAppDatabase();
  const now = Date.now();
  const [activeRows, queuedRows, rejectedRows, abandonedRows, staleRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(sandboxRuns)
      .where(inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES])),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.status, "queued")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sandboxRuns)
      .where(
        and(
          eq(sandboxRuns.status, "rejected"),
          lt(sandboxRuns.completedAt, now + 1),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sandboxRuns)
      .where(eq(sandboxRuns.status, "abandoned")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(sandboxRuns)
      .where(
        and(
          inArray(sandboxRuns.status, [...ACTIVE_SANDBOX_RUN_STATUSES]),
          lt(sandboxRuns.leaseExpiresAt, now),
        ),
      ),
  ]);

  const lastReconciledRow = await db
    .select({
      lastCompletedAt: sql<number>`max(${sandboxRuns.cleanupCompletedAt})`,
      lastHeartbeatAt: sql<number>`max(${sandboxRuns.lastHeartbeatAt})`,
    })
    .from(sandboxRuns);

  return {
    activeRuns: Number(activeRows[0]?.count ?? 0),
    backend: getSandboxExecutionBackend(),
    abandonedRuns: Number(abandonedRows[0]?.count ?? 0),
    lastHeartbeatAt: Number(lastReconciledRow[0]?.lastHeartbeatAt ?? 0) || null,
    lastReconciledAt: Number(lastReconciledRow[0]?.lastCompletedAt ?? 0) || null,
    queuedRuns: Number(queuedRows[0]?.count ?? 0),
    rejectedRuns: Number(rejectedRows[0]?.count ?? 0),
    staleRuns: Number(staleRows[0]?.count ?? 0),
  };
}
