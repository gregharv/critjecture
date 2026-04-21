import "server-only";

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { computeRuns } from "@/lib/app-schema";

export async function createComputeRun(input: {
  backend: string;
  codeText: string;
  computeKind: typeof computeRuns.$inferInsert.computeKind;
  cpuLimitSeconds?: number;
  inputManifestJson?: string;
  memoryLimitBytes?: number;
  metadataJson?: string;
  organizationId: string;
  runId: string;
  runner: string;
  studyId: string;
  timeoutMs?: number;
}) {
  const db = await getAppDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insert(computeRuns).values({
    id,
    organizationId: input.organizationId,
    studyId: input.studyId,
    runId: input.runId,
    computeKind: input.computeKind,
    status: "queued",
    backend: input.backend,
    runner: input.runner,
    failureReason: null,
    timeoutMs: input.timeoutMs ?? 60_000,
    cpuLimitSeconds: input.cpuLimitSeconds ?? 60,
    memoryLimitBytes: input.memoryLimitBytes ?? 512 * 1024 * 1024,
    maxProcesses: 1,
    stdoutMaxBytes: 256_000,
    artifactMaxBytes: 5 * 1024 * 1024,
    codeText: input.codeText,
    inputManifestJson: input.inputManifestJson ?? "[]",
    stdoutText: null,
    stderrText: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    cleanupStatus: "pending",
    metadataJson: input.metadataJson ?? "{}",
    createdAt: now,
    startedAt: null,
    completedAt: null,
  });

  return id;
}

export async function markComputeRunRunning(computeRunId: string) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(computeRuns)
    .set({
      status: "running",
      startedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: now + 60_000,
    })
    .where(eq(computeRuns.id, computeRunId));
}

export async function completeComputeRun(input: {
  computeRunId: string;
  stderrText?: string | null;
  stdoutText?: string | null;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(computeRuns)
    .set({
      status: "completed",
      completedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: null,
      cleanupStatus: "completed",
      stderrText: input.stderrText ?? null,
      stdoutText: input.stdoutText ?? null,
    })
    .where(eq(computeRuns.id, input.computeRunId));
}

export async function failComputeRun(input: {
  computeRunId: string;
  failureReason: string;
  stderrText?: string | null;
  stdoutText?: string | null;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(computeRuns)
    .set({
      status: "failed",
      completedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: null,
      cleanupStatus: "failed",
      failureReason: input.failureReason,
      stderrText: input.stderrText ?? null,
      stdoutText: input.stdoutText ?? null,
    })
    .where(eq(computeRuns.id, input.computeRunId));
}
