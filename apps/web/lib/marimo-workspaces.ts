import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  analysisNotebookRevisions,
  analysisPreviewSessions,
  analysisWorkspaces,
} from "@/lib/app-schema";
import type {
  AnalysisNotebookRevisionStatus,
  AnalysisPreviewSessionStatus,
  AnalysisWorkspaceStatus,
} from "@/lib/marimo-types";

function toRevisionStoragePath(workspaceId: string, revisionNumber: number) {
  return path.posix.join(
    "analysis_workspaces",
    workspaceId,
    "revisions",
    String(revisionNumber),
    "notebook.py",
  );
}

async function persistNotebookSource(input: {
  notebookSource: string;
  organizationSlug: string;
  revisionNumber: number;
  workspaceId: string;
}) {
  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);
  const relativePath = toRevisionStoragePath(input.workspaceId, input.revisionNumber);
  const absolutePath = path.join(organizationRoot, ...relativePath.split("/"));

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.notebookSource, "utf8");

  return relativePath;
}

export async function ensureAnalysisWorkspace(input: {
  conversationId: string;
  organizationId: string;
  title?: string | null;
  userId: string;
}) {
  const db = await getAppDatabase();
  const existing = await db.query.analysisWorkspaces.findFirst({
    where: and(
      eq(analysisWorkspaces.conversationId, input.conversationId),
      eq(analysisWorkspaces.organizationId, input.organizationId),
      eq(analysisWorkspaces.userId, input.userId),
    ),
  });

  if (existing) {
    return existing;
  }

  const now = Date.now();
  const id = randomUUID();

  await db.insert(analysisWorkspaces).values({
    conversationId: input.conversationId,
    createdAt: now,
    id,
    organizationId: input.organizationId,
    status: "idle",
    title: input.title?.trim() || null,
    updatedAt: now,
    userId: input.userId,
  });

  const created = await db.query.analysisWorkspaces.findFirst({
    where: eq(analysisWorkspaces.id, id),
  });

  if (!created) {
    throw new Error("Failed to create analysis workspace.");
  }

  return created;
}

export async function getAnalysisWorkspaceByConversation(input: {
  conversationId: string;
  organizationId: string;
  userId: string;
}) {
  const db = await getAppDatabase();

  return db.query.analysisWorkspaces.findFirst({
    where: and(
      eq(analysisWorkspaces.conversationId, input.conversationId),
      eq(analysisWorkspaces.organizationId, input.organizationId),
      eq(analysisWorkspaces.userId, input.userId),
    ),
  });
}

export async function getLatestAnalysisNotebookRevision(workspaceId: string) {
  const db = await getAppDatabase();

  return db.query.analysisNotebookRevisions.findFirst({
    orderBy: desc(analysisNotebookRevisions.revisionNumber),
    where: eq(analysisNotebookRevisions.workspaceId, workspaceId),
  });
}

export async function getAnalysisNotebookRevisionById(revisionId: string) {
  const db = await getAppDatabase();

  return db.query.analysisNotebookRevisions.findFirst({
    where: eq(analysisNotebookRevisions.id, revisionId),
  });
}

export async function createAnalysisNotebookRevision(input: {
  notebookSource: string;
  organizationSlug: string;
  status?: AnalysisNotebookRevisionStatus;
  summary?: string | null;
  turnId?: string | null;
  workspaceId: string;
}) {
  const db = await getAppDatabase();
  const latestRevision = await getLatestAnalysisNotebookRevision(input.workspaceId);
  const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
  const notebookPath = await persistNotebookSource({
    notebookSource: input.notebookSource,
    organizationSlug: input.organizationSlug,
    revisionNumber,
    workspaceId: input.workspaceId,
  });
  const id = randomUUID();
  const createdAt = Date.now();

  await db.insert(analysisNotebookRevisions).values({
    createdAt,
    id,
    notebookPath,
    notebookSource: input.notebookSource,
    revisionNumber,
    status: input.status ?? "running",
    structuredResultPath: null,
    summary: input.summary ?? null,
    turnId: input.turnId ?? null,
    workspaceId: input.workspaceId,
  });

  const created = await db.query.analysisNotebookRevisions.findFirst({
    where: eq(analysisNotebookRevisions.id, id),
  });

  if (!created) {
    throw new Error("Failed to create notebook revision.");
  }

  return created;
}

export async function updateAnalysisNotebookRevision(input: {
  htmlExportPath?: string | null;
  revisionId: string;
  sandboxRunId?: string | null;
  status: AnalysisNotebookRevisionStatus;
  structuredResultPath?: string | null;
  summary?: string | null;
}) {
  const db = await getAppDatabase();

  await db
    .update(analysisNotebookRevisions)
    .set({
      htmlExportPath: input.htmlExportPath ?? null,
      sandboxRunId: input.sandboxRunId ?? null,
      status: input.status,
      structuredResultPath: input.structuredResultPath ?? null,
      summary: input.summary ?? null,
    })
    .where(eq(analysisNotebookRevisions.id, input.revisionId));
}

export async function createAnalysisPreviewSession(input: {
  expiresAt: number;
  port?: number | null;
  previewTokenHash?: string | null;
  previewUrl?: string | null;
  revisionId: string;
  sandboxRunId?: string | null;
  status: AnalysisPreviewSessionStatus;
  workspaceId: string;
}) {
  const db = await getAppDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insert(analysisPreviewSessions).values({
    createdAt: now,
    expiresAt: input.expiresAt,
    id,
    port: input.port ?? null,
    previewTokenHash: input.previewTokenHash ?? null,
    previewUrl: input.previewUrl ?? null,
    revisionId: input.revisionId,
    sandboxRunId: input.sandboxRunId ?? null,
    status: input.status,
    updatedAt: now,
    workspaceId: input.workspaceId,
  });

  const created = await db.query.analysisPreviewSessions.findFirst({
    where: eq(analysisPreviewSessions.id, id),
  });

  if (!created) {
    throw new Error("Failed to create analysis preview session.");
  }

  return created;
}

export async function updateAnalysisPreviewSession(input: {
  expiresAt?: number;
  port?: number | null;
  previewTokenHash?: string | null;
  previewUrl?: string | null;
  revisionId?: string;
  sandboxRunId?: string | null;
  sessionId: string;
  status?: AnalysisPreviewSessionStatus;
}) {
  const db = await getAppDatabase();

  await db
    .update(analysisPreviewSessions)
    .set({
      expiresAt: input.expiresAt,
      port: typeof input.port === "undefined" ? undefined : input.port,
      previewTokenHash:
        typeof input.previewTokenHash === "undefined" ? undefined : input.previewTokenHash,
      previewUrl: typeof input.previewUrl === "undefined" ? undefined : input.previewUrl,
      revisionId: input.revisionId,
      sandboxRunId:
        typeof input.sandboxRunId === "undefined" ? undefined : input.sandboxRunId,
      status: input.status,
      updatedAt: Date.now(),
    })
    .where(eq(analysisPreviewSessions.id, input.sessionId));
}

export async function getLatestAnalysisPreviewSession(workspaceId: string) {
  const db = await getAppDatabase();

  return db.query.analysisPreviewSessions.findFirst({
    orderBy: desc(analysisPreviewSessions.createdAt),
    where: eq(analysisPreviewSessions.workspaceId, workspaceId),
  });
}

export async function getAnalysisPreviewSessionByTokenHash(input: {
  previewTokenHash: string;
  workspaceId: string;
}) {
  const db = await getAppDatabase();

  return db.query.analysisPreviewSessions.findFirst({
    where: and(
      eq(analysisPreviewSessions.previewTokenHash, input.previewTokenHash),
      eq(analysisPreviewSessions.workspaceId, input.workspaceId),
    ),
  });
}

export async function updateAnalysisWorkspaceState(input: {
  latestRevisionId?: string | null;
  latestSandboxRunId?: string | null;
  status: AnalysisWorkspaceStatus;
  title?: string | null;
  workspaceId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(analysisWorkspaces)
    .set({
      latestRevisionId: input.latestRevisionId ?? null,
      latestSandboxRunId: input.latestSandboxRunId ?? null,
      status: input.status,
      title: typeof input.title === "undefined" ? undefined : input.title,
      updatedAt: Date.now(),
    })
    .where(eq(analysisWorkspaces.id, input.workspaceId));
}
