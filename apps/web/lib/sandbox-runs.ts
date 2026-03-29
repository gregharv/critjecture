import "server-only";

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, lt, sql } from "drizzle-orm";

import { ensureOrganizationGeneratedAssetsRoot, resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  sandboxGeneratedAssets,
  sandboxRuns,
  toolCalls,
} from "@/lib/app-schema";
import {
  getSandboxLimitsSnapshot,
  getSandboxStaleThreshold,
  SANDBOX_MAX_ACTIVE_RUNS_GLOBAL,
  SANDBOX_MAX_ACTIVE_RUNS_PER_USER,
  SANDBOX_RUNNER,
  SANDBOX_WORKSPACE_DIR,
} from "@/lib/sandbox-policy";

export type SandboxRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "rejected"
  | "abandoned";

export type SandboxCleanupStatus = "pending" | "completed" | "failed" | "skipped";

type PersistedGeneratedSandboxAsset = {
  byteSize: number;
  downloadUrl: string;
  expiresAt: number;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

function parseGeneratedAssetsJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function removeDirectoryIfPresent(targetPath: string) {
  await rm(targetPath, { force: true, recursive: true }).catch(() => {});
}

async function countActiveRuns(userId?: string) {
  const db = await getAppDatabase();
  const whereClause = userId
    ? and(eq(sandboxRuns.status, "running"), eq(sandboxRuns.userId, userId))
    : eq(sandboxRuns.status, "running");
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(sandboxRuns)
    .where(whereClause);

  return Number(rows[0]?.count ?? 0);
}

export async function reconcileStaleSandboxRuns(now = Date.now()) {
  const db = await getAppDatabase();
  const staleThreshold = getSandboxStaleThreshold(now);
  const staleRuns = await db.query.sandboxRuns.findMany({
    where: and(eq(sandboxRuns.status, "running"), lt(sandboxRuns.startedAt, staleThreshold)),
  });

  for (const staleRun of staleRuns) {
    await db
      .update(sandboxRuns)
      .set({
        cleanupStatus: "completed",
        cleanupCompletedAt: now,
        completedAt: now,
        failureReason: staleRun.failureReason ?? "stale-run-reconciled",
        status: "abandoned",
      })
      .where(
        and(eq(sandboxRuns.runId, staleRun.runId), eq(sandboxRuns.status, "running")),
      );
    await removeDirectoryIfPresent(path.join(SANDBOX_WORKSPACE_DIR, staleRun.runId));
  }
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

export async function startSandboxRun(input: {
  organizationId: string;
  toolName: string;
  turnId?: string;
  runtimeToolCallId?: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const limits = getSandboxLimitsSnapshot();

  await reconcileStaleSandboxRuns(now);

  const [activeUserRuns, activeGlobalRuns] = await Promise.all([
    countActiveRuns(input.userId),
    countActiveRuns(),
  ]);

  const rejectionReason =
    activeUserRuns >= SANDBOX_MAX_ACTIVE_RUNS_PER_USER
      ? "per-user-concurrency-limit"
      : activeGlobalRuns >= SANDBOX_MAX_ACTIVE_RUNS_GLOBAL
        ? "global-concurrency-limit"
        : null;
  const runId = randomUUID();

  if (rejectionReason) {
    await db.insert(sandboxRuns).values({
      artifactMaxBytes: limits.artifactMaxBytes,
      artifactTtlMs: limits.artifactTtlMs,
      cleanupCompletedAt: now,
      cleanupStatus: "skipped",
      completedAt: now,
      cpuLimitSeconds: limits.cpuLimitSeconds,
      createdAt: now,
      failureReason: rejectionReason,
      maxProcesses: limits.maxProcesses,
      memoryLimitBytes: limits.memoryLimitBytes,
      organizationId: input.organizationId,
      runId,
      runner: SANDBOX_RUNNER,
      runtimeToolCallId: input.runtimeToolCallId ?? null,
      startedAt: now,
      status: "rejected",
      stdoutMaxBytes: limits.stdoutMaxBytes,
      timeoutMs: limits.timeoutMs,
      toolName: input.toolName,
      turnId: input.turnId ?? null,
      userId: input.userId,
    });

    return {
      limits,
      reason: rejectionReason,
      rejected: true as const,
      runId,
    };
  }

  await db.insert(sandboxRuns).values({
    artifactMaxBytes: limits.artifactMaxBytes,
    artifactTtlMs: limits.artifactTtlMs,
    cleanupStatus: "pending",
    cpuLimitSeconds: limits.cpuLimitSeconds,
    createdAt: now,
    maxProcesses: limits.maxProcesses,
    memoryLimitBytes: limits.memoryLimitBytes,
    organizationId: input.organizationId,
    runId,
    runner: SANDBOX_RUNNER,
    runtimeToolCallId: input.runtimeToolCallId ?? null,
    startedAt: now,
    status: "running",
    stdoutMaxBytes: limits.stdoutMaxBytes,
    timeoutMs: limits.timeoutMs,
    toolName: input.toolName,
    turnId: input.turnId ?? null,
    userId: input.userId,
  });

  return {
    limits,
    rejected: false as const,
    runId,
  };
}

export async function completeSandboxRun(input: {
  completedAt?: number;
  exitCode?: number | null;
  failureReason?: string | null;
  generatedAssets?: PersistedGeneratedSandboxAsset[];
  runId: string;
  status: Exclude<SandboxRunStatus, "running">;
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
      status: input.status,
    })
    .where(eq(sandboxRuns.runId, input.runId));
}

export async function markSandboxRunCleanup(input: {
  cleanupCompletedAt?: number;
  cleanupError?: string | null;
  cleanupStatus: SandboxCleanupStatus;
  runId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(sandboxRuns)
    .set({
      cleanupCompletedAt: input.cleanupCompletedAt ?? Date.now(),
      cleanupError: input.cleanupError ?? null,
      cleanupStatus: input.cleanupStatus,
    })
    .where(eq(sandboxRuns.runId, input.runId));
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

  return {
    artifactMaxBytes: row.artifactMaxBytes,
    artifactTtlMs: row.artifactTtlMs,
    cleanupCompletedAt: row.cleanupCompletedAt,
    cleanupError: row.cleanupError,
    cleanupStatus: row.cleanupStatus,
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
    maxProcesses: row.maxProcesses,
    memoryLimitBytes: row.memoryLimitBytes,
    organizationId: row.organizationId,
    runId: row.runId,
    runner: row.runner,
    runtimeToolCallId: row.runtimeToolCallId,
    startedAt: row.startedAt,
    status: row.status,
    stdoutMaxBytes: row.stdoutMaxBytes,
    timeoutMs: row.timeoutMs,
    toolName: row.toolName,
    turnId: row.turnId,
    userId: row.userId,
  };
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
