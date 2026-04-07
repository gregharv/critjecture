import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import type { SessionUser } from "@/lib/auth-state";
import { ensureOrganizationKnowledgeStagingRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  documents,
  documentChunks,
  knowledgeImportJobFiles,
  knowledgeImportJobs,
  organizations,
  usageEvents,
  users,
} from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { buildTextChunks, decodeTextBuffer, extractPdfText } from "@/lib/knowledge-ingestion";
import {
  KNOWLEDGE_ARCHIVE_MAX_BYTES,
  KNOWLEDGE_IMPORT_MAX_FILE_COUNT,
  type KnowledgeImportFileStage,
  type KnowledgeImportJobFileRecord,
  type KnowledgeImportJobRecord,
  type KnowledgeImportJobStatus,
  type KnowledgeImportSourceKind,
} from "@/lib/knowledge-import-types";
import {
  isKnowledgeAccessScope,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  type KnowledgeAccessScope,
} from "@/lib/knowledge-types";
import {
  logStructuredError,
  logStructuredEvent,
} from "@/lib/observability";
import { resolveOperationalAlert, upsertOperationalAlert } from "@/lib/operations";
import { listZipEntries, extractZipEntry } from "@/lib/zip-reader";

const ALLOWED_UPLOAD_TYPES = {
  ".csv": {
    mimeTypes: new Set(["application/csv", "text/csv", "text/plain", "application/vnd.ms-excel"]),
    normalizedMimeType: "text/csv",
  },
  ".md": {
    mimeTypes: new Set(["text/markdown", "text/plain"]),
    normalizedMimeType: "text/markdown",
  },
  ".pdf": {
    mimeTypes: new Set(["application/pdf"]),
    normalizedMimeType: "application/pdf",
  },
  ".txt": {
    mimeTypes: new Set(["text/plain"]),
    normalizedMimeType: "text/plain",
  },
} as const;

type AllowedUploadExtension = keyof typeof ALLOWED_UPLOAD_TYPES;

type DirectImportFileInput = {
  file: File;
  relativePath: string;
};

type ClaimedImportJobFile = {
  accessScope: KnowledgeAccessScope;
  archiveEntryPath: string | null;
  createdByUserId: string | null;
  displayName: string;
  documentId: string | null;
  id: string;
  jobId: string;
  organizationId: string;
  organizationSlug: string;
  relativePath: string;
  sourceKind: KnowledgeImportSourceKind;
  stagingStoragePath: string;
};

type PreflightImportJobFile = {
  archiveEntryPath: string | null;
  byteSize: number | null;
  displayName: string;
  lastError: string | null;
  lastErrorCode: string | null;
  mimeType: string | null;
  relativePath: string;
  stage: KnowledgeImportFileStage;
  stagingStoragePath: string;
};

type ExistingImportJobFileRow = {
  archiveEntryPath: string | null;
  attemptCount: number;
  byteSize: number | null;
  completedAt: number | null;
  displayName: string;
  documentId: string | null;
  id: string;
  lastError: string | null;
  lastErrorCode: string | null;
  mimeType: string | null;
  relativePath: string;
  stage: KnowledgeImportFileStage;
  startedAt: number | null;
  updatedAt: number;
};

const IMPORT_STALE_MS = 5 * 60 * 1000;
const RETRYABLE_STAGES: KnowledgeImportFileStage[] = ["retryable_failed"];
const IN_PROGRESS_STAGES: KnowledgeImportFileStage[] = [
  "validating",
  "extracting",
  "chunking",
  "indexing",
];

let importWorkerPromise: Promise<void> | null = null;
let importWorkerWakeRequested = false;

class KnowledgeImportProcessingError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; retryable: boolean }) {
    super(message);
    this.code = options.code;
    this.name = "KnowledgeImportProcessingError";
    this.retryable = options.retryable;
  }
}

function createPermanentImportError(message: string, code: string) {
  return new KnowledgeImportProcessingError(message, {
    code,
    retryable: false,
  });
}

function createRetryableImportError(message: string, code: string) {
  return new KnowledgeImportProcessingError(message, {
    code,
    retryable: true,
  });
}

function getAllowedUploadConfig(extension: string) {
  const normalizedExtension = extension.toLowerCase() as AllowedUploadExtension;

  if (!(normalizedExtension in ALLOWED_UPLOAD_TYPES)) {
    throw createPermanentImportError(
      "Only .csv, .txt, .md, and .pdf files are supported.",
      "unsupported_extension",
    );
  }

  return ALLOWED_UPLOAD_TYPES[normalizedExtension];
}

function normalizeRequestedScope(role: SessionUser["role"], requestedScope: string) {
  if (!canRoleAccessKnowledgeScope(role, "admin")) {
    return "public" as const;
  }

  if (!isKnowledgeAccessScope(requestedScope)) {
    throw new Error("Upload scope must be either public or admin.");
  }

  return requestedScope;
}

function sanitizePathSegment(segment: string) {
  const trimmed = segment.trim();
  const normalized = trimmed.normalize("NFKC");

  return (
    normalized
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "item"
  );
}

function normalizeImportRelativePath(inputPath: string) {
  const trimmed = inputPath.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw createPermanentImportError("Import file path must not be empty.", "invalid_path");
  }

  if (trimmed.startsWith("/")) {
    throw createPermanentImportError("Import file path must be relative.", "invalid_path");
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw createPermanentImportError(
      "Import file path must stay inside the selected directory or archive.",
      "invalid_path",
    );
  }

  const segments = normalized.split("/").filter(Boolean);

  if (segments.length === 0) {
    throw createPermanentImportError("Import file path must not be empty.", "invalid_path");
  }

  const lastSegment = segments[segments.length - 1] ?? "file";
  const extension = path.posix.extname(lastSegment).toLowerCase();
  getAllowedUploadConfig(extension);

  return segments.map(sanitizePathSegment).join("/");
}

function allocateUniqueRelativePath(relativePath: string, seenPaths: Set<string>) {
  const parsed = path.posix.parse(relativePath);
  let candidate = relativePath;
  let attempt = 0;

  while (seenPaths.has(candidate)) {
    attempt += 1;
    candidate = path.posix.join(parsed.dir, `${parsed.name}--${attempt}${parsed.ext}`);
  }

  seenPaths.add(candidate);
  return candidate;
}

function getDisplayNameFromRelativePath(relativePath: string) {
  return path.posix.basename(relativePath);
}

function assertMimeMatchesExtension(file: File, normalizedExtension: string) {
  const { mimeTypes } = getAllowedUploadConfig(normalizedExtension);
  const providedMimeType = file.type.trim().toLowerCase();

  if (!providedMimeType) {
    return;
  }

  if (!mimeTypes.has(providedMimeType)) {
    throw createPermanentImportError(
      `Uploaded file type ${providedMimeType} does not match the ${normalizedExtension} extension.`,
      "mime_mismatch",
    );
  }
}

async function writeBufferAtomically(absolutePath: string, buffer: Buffer) {
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(directory, `.tmp-${randomUUID()}`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, buffer, { flag: "wx" });
    await rename(tempPath, absolutePath);
  } catch (caughtError) {
    await unlink(tempPath).catch(() => undefined);
    throw caughtError;
  }
}

async function removePathQuietly(targetPath: string) {
  await rm(targetPath, { force: true, recursive: true }).catch(() => undefined);
}

function createSourceRootPrefix(jobId: string) {
  return `import-${jobId.slice(0, 8)}`;
}

function buildManagedDocumentSourcePath(
  accessScope: KnowledgeAccessScope,
  jobId: string,
  relativePath: string,
) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return path.posix.join(accessScope, "uploads", year, month, createSourceRootPrefix(jobId), relativePath);
}

function mapJobRow(row: {
  accessScope: KnowledgeAccessScope;
  completedAt: number | null;
  createdAt: number;
  createdByUserEmail: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  failedFileCount: number;
  id: string;
  queuedFileCount: number;
  readyFileCount: number;
  retryableFailedFileCount: number;
  runningFileCount: number;
  sourceKind: KnowledgeImportSourceKind;
  startedAt: number | null;
  status: KnowledgeImportJobStatus;
  totalFileCount: number;
  triggerRequestId: string | null;
  updatedAt: number;
}) {
  return {
    accessScope: row.accessScope,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    createdByUserEmail: row.createdByUserEmail,
    createdByUserId: row.createdByUserId,
    createdByUserName: row.createdByUserName,
    failedFileCount: row.failedFileCount,
    id: row.id,
    queuedFileCount: row.queuedFileCount,
    readyFileCount: row.readyFileCount,
    retryableFailedFileCount: row.retryableFailedFileCount,
    runningFileCount: row.runningFileCount,
    sourceKind: row.sourceKind,
    startedAt: row.startedAt,
    status: row.status,
    totalFileCount: row.totalFileCount,
    triggerRequestId: row.triggerRequestId,
    updatedAt: row.updatedAt,
  } satisfies KnowledgeImportJobRecord;
}

function mapJobFileRow(row: ExistingImportJobFileRow) {
  return {
    archiveEntryPath: row.archiveEntryPath,
    attemptCount: row.attemptCount,
    byteSize: row.byteSize,
    completedAt: row.completedAt,
    displayName: row.displayName,
    documentId: row.documentId,
    id: row.id,
    lastError: row.lastError,
    lastErrorCode: row.lastErrorCode,
    mimeType: row.mimeType,
    relativePath: row.relativePath,
    stage: row.stage,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  } satisfies KnowledgeImportJobFileRecord;
}

async function loadJobRecord(jobId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      accessScope: knowledgeImportJobs.accessScope,
      completedAt: knowledgeImportJobs.completedAt,
      createdAt: knowledgeImportJobs.createdAt,
      createdByUserEmail: users.email,
      createdByUserId: knowledgeImportJobs.createdByUserId,
      createdByUserName: users.name,
      failedFileCount: knowledgeImportJobs.failedFileCount,
      id: knowledgeImportJobs.id,
      queuedFileCount: knowledgeImportJobs.queuedFileCount,
      readyFileCount: knowledgeImportJobs.readyFileCount,
      retryableFailedFileCount: knowledgeImportJobs.retryableFailedFileCount,
      runningFileCount: knowledgeImportJobs.runningFileCount,
      sourceKind: knowledgeImportJobs.sourceKind,
      startedAt: knowledgeImportJobs.startedAt,
      status: knowledgeImportJobs.status,
      totalFileCount: knowledgeImportJobs.totalFileCount,
      triggerRequestId: knowledgeImportJobs.triggerRequestId,
      updatedAt: knowledgeImportJobs.updatedAt,
    })
    .from(knowledgeImportJobs)
    .leftJoin(users, eq(users.id, knowledgeImportJobs.createdByUserId))
    .where(eq(knowledgeImportJobs.id, jobId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    throw new Error("Knowledge import job was not found.");
  }

  return mapJobRow(row);
}

async function updateJobAggregates(jobId: string) {
  const db = await getAppDatabase();
  const files = await db.query.knowledgeImportJobFiles.findMany({
    columns: {
      completedAt: true,
      stage: true,
      startedAt: true,
    },
    where: eq(knowledgeImportJobFiles.jobId, jobId),
  });
  const queuedFileCount = files.filter((file) => file.stage === "queued").length;
  const runningFileCount = files.filter((file) => IN_PROGRESS_STAGES.includes(file.stage)).length;
  const readyFileCount = files.filter((file) => file.stage === "ready").length;
  const failedFileCount = files.filter((file) => file.stage === "failed").length;
  const retryableFailedFileCount = files.filter((file) => file.stage === "retryable_failed").length;
  const totalFileCount = files.length;
  const terminalCount = readyFileCount + failedFileCount + retryableFailedFileCount;
  const hasStarted = files.some((file) => file.startedAt !== null);
  const now = Date.now();

  let status: KnowledgeImportJobStatus;

  if (totalFileCount === 0) {
    status = "failed";
  } else if (runningFileCount > 0) {
    status = "running";
  } else if (!hasStarted && queuedFileCount === totalFileCount) {
    status = "queued";
  } else if (terminalCount < totalFileCount) {
    status = "running";
  } else if (readyFileCount === totalFileCount) {
    status = "completed";
  } else if (readyFileCount === 0) {
    status = "failed";
  } else {
    status = "completed_with_errors";
  }

  const completedAt = terminalCount === totalFileCount ? now : null;
  const startedAt = hasStarted ? files.reduce<number | null>((earliest, file) => {
    if (file.startedAt === null) {
      return earliest;
    }

    if (earliest === null || file.startedAt < earliest) {
      return file.startedAt;
    }

    return earliest;
  }, null) : null;

  await db
    .update(knowledgeImportJobs)
    .set({
      completedAt,
      failedFileCount,
      queuedFileCount,
      readyFileCount,
      retryableFailedFileCount,
      runningFileCount,
      startedAt,
      status,
      totalFileCount,
      updatedAt: now,
    })
    .where(eq(knowledgeImportJobs.id, jobId));

  return loadJobRecord(jobId);
}

async function updateImportFileStage(input: {
  completedAt?: number | null;
  documentId?: string | null;
  id: string;
  lastError?: string | null;
  lastErrorCode?: string | null;
  stage: KnowledgeImportFileStage;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(knowledgeImportJobFiles)
    .set({
      completedAt: typeof input.completedAt === "undefined" ? null : input.completedAt,
      documentId: typeof input.documentId === "undefined" ? undefined : input.documentId,
      lastError: typeof input.lastError === "undefined" ? null : input.lastError,
      lastErrorCode: typeof input.lastErrorCode === "undefined" ? null : input.lastErrorCode,
      stage: input.stage,
      updatedAt: now,
    })
    .where(eq(knowledgeImportJobFiles.id, input.id));
}

async function updateImportAlerts(organizationId: string) {
  const db = await getAppDatabase();
  const staleCutoff = Date.now() - IMPORT_STALE_MS;
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  const [staleRows, repeatedFailures] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(knowledgeImportJobFiles)
      .where(
        and(
          eq(knowledgeImportJobFiles.organizationId, organizationId),
          inArray(knowledgeImportJobFiles.stage, IN_PROGRESS_STAGES),
          lt(knowledgeImportJobFiles.updatedAt, staleCutoff),
        ),
      ),
    db
      .select({
        count: sql<number>`count(*)`,
      })
      .from(knowledgeImportJobFiles)
      .where(
        and(
          eq(knowledgeImportJobFiles.organizationId, organizationId),
          inArray(knowledgeImportJobFiles.stage, ["failed", "retryable_failed"]),
          gte(knowledgeImportJobFiles.updatedAt, tenMinutesAgo),
        ),
      ),
  ]);
  const staleCount = Number(staleRows[0]?.count ?? 0);
  const repeatedFailureCount = Number(repeatedFailures[0]?.count ?? 0);

  if (repeatedFailureCount >= 5) {
    await upsertOperationalAlert({
      alertType: "knowledge-import-failures",
      dedupeKey: `knowledge-import-failures:${organizationId}`,
      message: `${repeatedFailureCount} knowledge import files failed in the last 10 minutes.`,
      metadata: {
        knowledgeImportJobId: null,
        organizationId,
        routeGroup: "knowledge_import",
      },
      organizationId,
      severity: "warning",
      title: "Knowledge Import Failures",
    });
  } else {
    await resolveOperationalAlert(`knowledge-import-failures:${organizationId}`);
  }

  if (staleCount > 0) {
    await upsertOperationalAlert({
      alertType: "knowledge-import-stale",
      dedupeKey: `knowledge-import-stale:${organizationId}`,
      message: `${staleCount} knowledge import file${staleCount === 1 ? "" : "s"} appear stalled.`,
      metadata: {
        knowledgeImportJobId: null,
        organizationId,
        routeGroup: "knowledge_import",
      },
      organizationId,
      severity: "warning",
      title: "Knowledge Import Stale Work",
    });
  } else {
    await resolveOperationalAlert(`knowledge-import-stale:${organizationId}`);
  }
}

async function createDirectImportJobFiles(input: {
  files: DirectImportFileInput[];
  stagingRoot: string;
}) {
  const seenPaths = new Set<string>();
  const fileRows: PreflightImportJobFile[] = [];

  for (const item of input.files.slice(0, KNOWLEDGE_IMPORT_MAX_FILE_COUNT)) {
    const requestedRelativePath = item.relativePath.trim() || item.file.name;
    const rawExtension = path.posix.extname(requestedRelativePath).toLowerCase();
    let relativePath: string;

    try {
      relativePath = allocateUniqueRelativePath(
        normalizeImportRelativePath(requestedRelativePath),
        seenPaths,
      );
    } catch (caughtError) {
      const fallbackName = allocateUniqueRelativePath(
        `${sanitizePathSegment(path.posix.basename(requestedRelativePath, rawExtension) || "file")}${rawExtension}`,
        seenPaths,
      );
      fileRows.push({
        archiveEntryPath: null,
        byteSize: item.file.size,
        displayName: item.file.name || getDisplayNameFromRelativePath(fallbackName),
        lastError: caughtError instanceof Error ? caughtError.message : "Invalid import path.",
        lastErrorCode: "invalid_path",
        mimeType: item.file.type || null,
        relativePath: fallbackName,
        stage: "failed",
        stagingStoragePath: path.join(input.stagingRoot, "files", ...fallbackName.split("/")),
      });
      continue;
    }

    const absoluteStagingPath = path.join(input.stagingRoot, "files", ...relativePath.split("/"));

    try {
      const extension = path.posix.extname(relativePath).toLowerCase();
      const { normalizedMimeType } = getAllowedUploadConfig(extension);

      if (item.file.size <= 0) {
        throw createPermanentImportError("Uploaded file must not be empty.", "empty_file");
      }

      if (item.file.size > KNOWLEDGE_UPLOAD_MAX_BYTES) {
        throw createPermanentImportError(
          "Uploaded file exceeds the 10 MiB size limit.",
          "file_too_large",
        );
      }

      assertMimeMatchesExtension(item.file, extension);
      const buffer = Buffer.from(await item.file.arrayBuffer());
      await writeBufferAtomically(absoluteStagingPath, buffer);

      fileRows.push({
        archiveEntryPath: null,
        byteSize: item.file.size,
        displayName: item.file.name || getDisplayNameFromRelativePath(relativePath),
        lastError: null,
        lastErrorCode: null,
        mimeType: normalizedMimeType,
        relativePath,
        stage: "queued",
        stagingStoragePath: absoluteStagingPath,
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to stage uploaded file.";
      const code =
        caughtError instanceof KnowledgeImportProcessingError
          ? caughtError.code
          : "staging_failed";

      fileRows.push({
        archiveEntryPath: null,
        byteSize: item.file.size,
        displayName: item.file.name || getDisplayNameFromRelativePath(relativePath),
        lastError: message,
        lastErrorCode: code,
        mimeType: item.file.type || null,
        relativePath,
        stage: "failed",
        stagingStoragePath: absoluteStagingPath,
      });
    }
  }

  return fileRows;
}

async function createZipImportJobFiles(input: {
  archive: File;
  archiveStagingPath: string;
}) {
  if (input.archive.size <= 0) {
    throw new Error("Archive must not be empty.");
  }

  if (input.archive.size > KNOWLEDGE_ARCHIVE_MAX_BYTES) {
    throw new Error("Archive exceeds the configured size limit.");
  }

  const archiveBuffer = Buffer.from(await input.archive.arrayBuffer());
  await writeBufferAtomically(input.archiveStagingPath, archiveBuffer);

  const entries = listZipEntries(archiveBuffer);

  if (entries.length > KNOWLEDGE_IMPORT_MAX_FILE_COUNT) {
    throw new Error("Archive contains too many files for a single import job.");
  }

  const seenPaths = new Set<string>();

  return entries
    .filter((entry) => !entry.fileName.endsWith("/"))
    .map((entry, index) => {
      let relativePath: string;

      try {
        relativePath = allocateUniqueRelativePath(
          normalizeImportRelativePath(entry.fileName),
          seenPaths,
        );
      } catch (caughtError) {
        const ext = path.posix.extname(entry.fileName).toLowerCase();
        const fallbackPath = allocateUniqueRelativePath(
          `invalid-entry-${index + 1}${ext}`,
          seenPaths,
        );

        return {
          archiveEntryPath: entry.fileName,
          byteSize: entry.uncompressedSize,
          displayName: getDisplayNameFromRelativePath(entry.fileName),
          lastError: caughtError instanceof Error ? caughtError.message : "Invalid archive entry path.",
          lastErrorCode: "invalid_path",
          mimeType: null,
          relativePath: fallbackPath,
          stage: "failed" as const,
          stagingStoragePath: input.archiveStagingPath,
        };
      }

      try {
        const extension = path.posix.extname(relativePath).toLowerCase();
        const { normalizedMimeType } = getAllowedUploadConfig(extension);

        if (entry.uncompressedSize <= 0) {
          throw createPermanentImportError("Archive entry must not be empty.", "empty_file");
        }

        if (entry.uncompressedSize > KNOWLEDGE_UPLOAD_MAX_BYTES) {
          throw createPermanentImportError(
            "Archive entry exceeds the 10 MiB size limit.",
            "file_too_large",
          );
        }

        if (entry.compressedSize > 0 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 20) {
          throw createPermanentImportError(
            "Archive entry expansion ratio is too large.",
            "archive_ratio_too_large",
          );
        }

        return {
          archiveEntryPath: entry.fileName,
          byteSize: entry.uncompressedSize,
          displayName: getDisplayNameFromRelativePath(relativePath),
          lastError: null,
          lastErrorCode: null,
          mimeType: normalizedMimeType,
          relativePath,
          stage: "queued" as const,
          stagingStoragePath: input.archiveStagingPath,
        };
      } catch (caughtError) {
        return {
          archiveEntryPath: entry.fileName,
          byteSize: entry.uncompressedSize,
          displayName: getDisplayNameFromRelativePath(relativePath),
          lastError:
            caughtError instanceof Error ? caughtError.message : "Archive entry could not be imported.",
          lastErrorCode:
            caughtError instanceof KnowledgeImportProcessingError
              ? caughtError.code
              : "archive_entry_invalid",
          mimeType: null,
          relativePath,
          stage: "failed" as const,
          stagingStoragePath: input.archiveStagingPath,
        };
      }
    });
}

async function insertImportJob(input: {
  accessScope: KnowledgeAccessScope;
  createdByUserId: string;
  fileRows: PreflightImportJobFile[];
  organizationId: string;
  sourceKind: KnowledgeImportSourceKind;
  triggerRequestId?: string | null;
}) {
  const now = Date.now();
  const db = await getAppDatabase();
  const jobId = randomUUID();

  await db.insert(knowledgeImportJobs).values({
    accessScope: input.accessScope,
    completedAt: null,
    createdAt: now,
    createdByUserId: input.createdByUserId,
    failedFileCount: 0,
    id: jobId,
    organizationId: input.organizationId,
    queuedFileCount: 0,
    readyFileCount: 0,
    retryableFailedFileCount: 0,
    runningFileCount: 0,
    sourceKind: input.sourceKind,
    startedAt: null,
    status: "queued",
    totalFileCount: 0,
    triggerRequestId: input.triggerRequestId ?? null,
    updatedAt: now,
  });

  if (input.fileRows.length > 0) {
    await db.insert(knowledgeImportJobFiles).values(
      input.fileRows.map((fileRow) => ({
        archiveEntryPath: fileRow.archiveEntryPath,
        attemptCount: 0,
        byteSize: fileRow.byteSize,
        completedAt: fileRow.stage === "failed" ? now : null,
        contentSha256: null,
        createdAt: now,
        displayName: fileRow.displayName,
        documentId: null,
        id: randomUUID(),
        jobId,
        lastError: fileRow.lastError,
        lastErrorCode: fileRow.lastErrorCode,
        mimeType: fileRow.mimeType,
        organizationId: input.organizationId,
        relativePath: fileRow.relativePath,
        stage: fileRow.stage,
        stagingStoragePath: fileRow.stagingStoragePath,
        startedAt: null,
        updatedAt: now,
      })),
    );
  }

  const job = await updateJobAggregates(jobId);
  await updateImportAlerts(input.organizationId);
  logStructuredEvent("knowledge-import.job_created", {
    knowledgeImportJobId: job.id,
    organizationId: input.organizationId,
    requestId: input.triggerRequestId ?? null,
    totalFileCount: job.totalFileCount,
    userId: input.createdByUserId,
  });
  return job;
}

export async function createKnowledgeImportJobFromFiles(input: {
  files: DirectImportFileInput[];
  requestedScope: string;
  sourceKind: "directory" | "single_file";
  triggerRequestId?: string | null;
  user: SessionUser;
}) {
  if (input.files.length === 0) {
    throw new Error("At least one file must be provided.");
  }

  const accessScope = normalizeRequestedScope(
    input.user.role,
    input.requestedScope.trim().toLowerCase(),
  );

  if (!canRoleAccessKnowledgeScope(input.user.role, accessScope)) {
    throw new Error("You do not have access to import files to that scope.");
  }

  const stagingRoot = path.join(
    await ensureOrganizationKnowledgeStagingRoot(input.user.organizationSlug),
    "imports",
    randomUUID(),
  );
  const fileRows = await createDirectImportJobFiles({
    files: input.files,
    stagingRoot,
  });

  const job = await insertImportJob({
    accessScope,
    createdByUserId: input.user.id,
    fileRows,
    organizationId: input.user.organizationId,
    sourceKind: input.sourceKind,
    triggerRequestId: input.triggerRequestId ?? null,
  });
  ensureKnowledgeImportWorkerRunning();
  return job;
}

export async function createKnowledgeImportJobFromArchive(input: {
  archive: File;
  requestedScope: string;
  triggerRequestId?: string | null;
  user: SessionUser;
}) {
  const accessScope = normalizeRequestedScope(
    input.user.role,
    input.requestedScope.trim().toLowerCase(),
  );

  if (!canRoleAccessKnowledgeScope(input.user.role, accessScope)) {
    throw new Error("You do not have access to import files to that scope.");
  }

  const stagingJobId = randomUUID();
  const stagingRoot = path.join(
    await ensureOrganizationKnowledgeStagingRoot(input.user.organizationSlug),
    "imports",
    stagingJobId,
  );
  const archiveName = `${sanitizePathSegment(path.parse(input.archive.name).name || "archive")}.zip`;
  const archiveStagingPath = path.join(stagingRoot, "archive", archiveName);
  const fileRows = await createZipImportJobFiles({
    archive: input.archive,
    archiveStagingPath,
  });
  const job = await insertImportJob({
    accessScope,
    createdByUserId: input.user.id,
    fileRows,
    organizationId: input.user.organizationId,
    sourceKind: "zip",
    triggerRequestId: input.triggerRequestId ?? null,
  });
  ensureKnowledgeImportWorkerRunning();
  return job;
}

export async function listKnowledgeImportJobs(user: SessionUser) {
  const db = await getAppDatabase();
  const whereClauses = [eq(knowledgeImportJobs.organizationId, user.organizationId)];

  if (!canRoleAccessKnowledgeScope(user.role, "admin")) {
    whereClauses.push(eq(knowledgeImportJobs.accessScope, "public"));
  }

  const rows = await db
    .select({
      accessScope: knowledgeImportJobs.accessScope,
      completedAt: knowledgeImportJobs.completedAt,
      createdAt: knowledgeImportJobs.createdAt,
      createdByUserEmail: users.email,
      createdByUserId: knowledgeImportJobs.createdByUserId,
      createdByUserName: users.name,
      failedFileCount: knowledgeImportJobs.failedFileCount,
      id: knowledgeImportJobs.id,
      queuedFileCount: knowledgeImportJobs.queuedFileCount,
      readyFileCount: knowledgeImportJobs.readyFileCount,
      retryableFailedFileCount: knowledgeImportJobs.retryableFailedFileCount,
      runningFileCount: knowledgeImportJobs.runningFileCount,
      sourceKind: knowledgeImportJobs.sourceKind,
      startedAt: knowledgeImportJobs.startedAt,
      status: knowledgeImportJobs.status,
      totalFileCount: knowledgeImportJobs.totalFileCount,
      triggerRequestId: knowledgeImportJobs.triggerRequestId,
      updatedAt: knowledgeImportJobs.updatedAt,
    })
    .from(knowledgeImportJobs)
    .leftJoin(users, eq(users.id, knowledgeImportJobs.createdByUserId))
    .where(and(...whereClauses))
    .orderBy(desc(knowledgeImportJobs.updatedAt), desc(knowledgeImportJobs.createdAt))
    .limit(20);

  ensureKnowledgeImportWorkerRunning();
  return rows.map(mapJobRow);
}

export async function getKnowledgeImportJob(user: SessionUser, jobId: string) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(knowledgeImportJobs.id, jobId),
    eq(knowledgeImportJobs.organizationId, user.organizationId),
  ];

  if (!canRoleAccessKnowledgeScope(user.role, "admin")) {
    whereClauses.push(eq(knowledgeImportJobs.accessScope, "public"));
  }

  const job = await db.query.knowledgeImportJobs.findFirst({
    where: and(...whereClauses),
  });

  if (!job) {
    throw new Error("Knowledge import job was not found.");
  }

  const files = await db.query.knowledgeImportJobFiles.findMany({
    orderBy: [asc(knowledgeImportJobFiles.relativePath), asc(knowledgeImportJobFiles.createdAt)],
    where: eq(knowledgeImportJobFiles.jobId, jobId),
  });

  ensureKnowledgeImportWorkerRunning();
  return {
    files: files.map(mapJobFileRow),
    job: await loadJobRecord(jobId),
  };
}

export async function retryKnowledgeImportJob(user: SessionUser, jobId: string) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(knowledgeImportJobs.id, jobId),
    eq(knowledgeImportJobs.organizationId, user.organizationId),
  ];

  if (!canRoleAccessKnowledgeScope(user.role, "admin")) {
    whereClauses.push(eq(knowledgeImportJobs.accessScope, "public"));
  }

  const job = await db.query.knowledgeImportJobs.findFirst({
    where: and(...whereClauses),
  });

  if (!job) {
    throw new Error("Knowledge import job was not found.");
  }

  const retryableFiles = await db.query.knowledgeImportJobFiles.findMany({
    columns: { id: true },
    where: and(
      eq(knowledgeImportJobFiles.jobId, jobId),
      inArray(knowledgeImportJobFiles.stage, RETRYABLE_STAGES),
    ),
  });

  if (retryableFiles.length === 0) {
    throw new Error("This import job has no retryable files.");
  }

  const now = Date.now();

  await db
    .update(knowledgeImportJobFiles)
    .set({
      completedAt: null,
      lastError: null,
      lastErrorCode: null,
      stage: "queued",
      startedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(knowledgeImportJobFiles.jobId, jobId),
        inArray(knowledgeImportJobFiles.stage, RETRYABLE_STAGES),
      ),
    );

  const nextJob = await updateJobAggregates(jobId);
  ensureKnowledgeImportWorkerRunning();
  return nextJob;
}

async function reclaimStaleKnowledgeImportWork() {
  const db = await getAppDatabase();
  const staleCutoff = Date.now() - IMPORT_STALE_MS;
  const staleFiles = await db.query.knowledgeImportJobFiles.findMany({
    columns: {
      id: true,
      jobId: true,
      organizationId: true,
    },
    where: and(
      inArray(knowledgeImportJobFiles.stage, IN_PROGRESS_STAGES),
      lt(knowledgeImportJobFiles.updatedAt, staleCutoff),
    ),
  });

  if (staleFiles.length === 0) {
    return;
  }

  const now = Date.now();

  for (const staleFile of staleFiles) {
    await db
      .update(knowledgeImportJobFiles)
      .set({
        completedAt: null,
        lastError: "Import worker was interrupted before this file completed.",
        lastErrorCode: "worker_interrupted",
        stage: "queued",
        updatedAt: now,
      })
      .where(eq(knowledgeImportJobFiles.id, staleFile.id));

    await updateJobAggregates(staleFile.jobId);
    await updateImportAlerts(staleFile.organizationId);
    logStructuredEvent("knowledge-import.stale_reclaimed", {
      knowledgeImportJobId: staleFile.jobId,
      organizationId: staleFile.organizationId,
    });
  }
}

async function claimNextKnowledgeImportFile() {
  const db = await getAppDatabase();
  const candidates = await db
    .select({
      accessScope: knowledgeImportJobs.accessScope,
      archiveEntryPath: knowledgeImportJobFiles.archiveEntryPath,
      createdByUserId: knowledgeImportJobs.createdByUserId,
      displayName: knowledgeImportJobFiles.displayName,
      documentId: knowledgeImportJobFiles.documentId,
      fileId: knowledgeImportJobFiles.id,
      jobId: knowledgeImportJobs.id,
      organizationId: knowledgeImportJobs.organizationId,
      organizationSlug: organizations.slug,
      relativePath: knowledgeImportJobFiles.relativePath,
      sourceKind: knowledgeImportJobs.sourceKind,
      stagingStoragePath: knowledgeImportJobFiles.stagingStoragePath,
    })
    .from(knowledgeImportJobFiles)
    .innerJoin(knowledgeImportJobs, eq(knowledgeImportJobs.id, knowledgeImportJobFiles.jobId))
    .innerJoin(organizations, eq(organizations.id, knowledgeImportJobs.organizationId))
    .where(eq(knowledgeImportJobFiles.stage, "queued"))
    .orderBy(asc(knowledgeImportJobFiles.createdAt), asc(knowledgeImportJobFiles.relativePath))
    .limit(1);

  const candidate = candidates[0];

  if (!candidate) {
    return null;
  }

  const now = Date.now();

  await db
    .update(knowledgeImportJobFiles)
    .set({
      attemptCount: sql`${knowledgeImportJobFiles.attemptCount} + 1`,
      completedAt: null,
      startedAt: now,
      stage: "validating",
      updatedAt: now,
    })
    .where(eq(knowledgeImportJobFiles.id, candidate.fileId));

  await updateJobAggregates(candidate.jobId);
  logStructuredEvent("knowledge-import.file_claimed", {
    knowledgeImportJobId: candidate.jobId,
    organizationId: candidate.organizationId,
    userId: candidate.createdByUserId ?? null,
  });

  return {
    accessScope: candidate.accessScope,
    archiveEntryPath: candidate.archiveEntryPath,
    createdByUserId: candidate.createdByUserId,
    displayName: candidate.displayName,
    documentId: candidate.documentId,
    id: candidate.fileId,
    jobId: candidate.jobId,
    organizationId: candidate.organizationId,
    organizationSlug: candidate.organizationSlug,
    relativePath: candidate.relativePath,
    sourceKind: candidate.sourceKind,
    stagingStoragePath: candidate.stagingStoragePath,
  } satisfies ClaimedImportJobFile;
}

async function extractTextForImportedFile(input: {
  absoluteFilePathForPdf: string;
  buffer: Buffer;
  extension: AllowedUploadExtension;
}) {
  if (input.extension === ".pdf") {
    return extractPdfText(input.absoluteFilePathForPdf, KNOWLEDGE_UPLOAD_MAX_BYTES);
  }

  return decodeTextBuffer(input.buffer);
}

async function upsertDocumentRecord(input: {
  accessScope: KnowledgeAccessScope;
  byteSize: number;
  contentSha256: string;
  createdByUserId: string | null;
  displayName: string;
  documentId: string | null;
  ingestionError: string | null;
  ingestionStatus: "failed" | "ready";
  mimeType: string;
  organizationId: string;
  sourcePath: string;
  sourceType: "bulk_import" | "uploaded";
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const existing =
    input.documentId
      ? await db.query.documents.findFirst({
          where: eq(documents.id, input.documentId),
        })
      : await db.query.documents.findFirst({
          where: and(
            eq(documents.organizationId, input.organizationId),
            eq(documents.sourcePath, input.sourcePath),
          ),
        });

  if (existing) {
    await db
      .update(documents)
      .set({
        accessScope: input.accessScope,
        byteSize: input.byteSize,
        contentSha256: input.contentSha256,
        displayName: input.displayName,
        ingestionError: input.ingestionError,
        ingestionStatus: input.ingestionStatus,
        lastIndexedAt: input.ingestionStatus === "ready" ? now : existing.lastIndexedAt,
        mimeType: input.mimeType,
        sourceType: input.sourceType,
        updatedAt: now,
        uploadedByUserId: input.createdByUserId,
      })
      .where(eq(documents.id, existing.id));

    return existing.id;
  }

  const documentId = randomUUID();

  await db.insert(documents).values({
    accessScope: input.accessScope,
    byteSize: input.byteSize,
    contentSha256: input.contentSha256,
    createdAt: now,
    displayName: input.displayName,
    id: documentId,
    ingestionError: input.ingestionError,
    ingestionStatus: input.ingestionStatus,
    lastIndexedAt: input.ingestionStatus === "ready" ? now : null,
    mimeType: input.mimeType,
    organizationId: input.organizationId,
    sourcePath: input.sourcePath,
    sourceType: input.sourceType,
    updatedAt: now,
    uploadedByUserId: input.createdByUserId,
  });

  return documentId;
}

async function replaceDocumentChunks(documentId: string, extractedText: string) {
  const db = await getAppDatabase();
  const chunks = buildTextChunks(extractedText);

  if (chunks.length === 0) {
    throw createPermanentImportError(
      "Imported file did not contain enough text to index.",
      "no_text_to_index",
    );
  }

  const indexedAt = Date.now();

  await db.transaction(async (transaction) => {
    await transaction.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

    await transaction.insert(documentChunks).values(
      chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        contentSha256: chunk.contentSha256,
        createdAt: indexedAt,
        documentId,
        endOffset: chunk.endOffset,
        id: randomUUID(),
        startOffset: chunk.startOffset,
        tokenCount: chunk.tokenCount,
      })),
    );

    await transaction
      .update(documents)
      .set({
        ingestionError: null,
        ingestionStatus: "ready",
        lastIndexedAt: indexedAt,
        updatedAt: indexedAt,
      })
      .where(eq(documents.id, documentId));
  });
}

async function loadImportedFileBuffer(file: ClaimedImportJobFile) {
  try {
    if (file.archiveEntryPath) {
      const archiveBuffer = await readFile(file.stagingStoragePath);
      return extractZipEntry(archiveBuffer, file.archiveEntryPath);
    }

    return readFile(file.stagingStoragePath);
  } catch (caughtError) {
    if (caughtError instanceof KnowledgeImportProcessingError) {
      throw caughtError;
    }

    throw createRetryableImportError(
      caughtError instanceof Error ? caughtError.message : "Failed to read staged import file.",
      "staging_read_failed",
    );
  }
}

async function recordImportUsageEvent(input: {
  eventType: string;
  organizationId: string;
  quantity?: number;
  status: string;
  subjectName: string;
  userId: string | null;
}) {
  const db = await getAppDatabase();

  await db.insert(usageEvents).values({
    costUsd: 0,
    createdAt: Date.now(),
    durationMs: null,
    eventType: input.eventType,
    id: randomUUID(),
    inputTokens: 0,
    metadataJson: "{}",
    organizationId: input.organizationId,
    outputTokens: 0,
    quantity: input.quantity ?? 1,
    requestLogId: null,
    routeGroup: "knowledge_import",
    routeKey: "knowledge.import_jobs.worker",
    status: input.status,
    subjectName: input.subjectName,
    totalTokens: 0,
    userId: input.userId,
  });
}

async function processClaimedImportJobFile(file: ClaimedImportJobFile) {
  const db = await getAppDatabase();
  const absolutePromotionPath = path.join(
    await resolveCompanyDataRoot(file.organizationSlug),
    ...buildManagedDocumentSourcePath(file.accessScope, file.jobId, file.relativePath).split("/"),
  );
  const managedSourcePath = buildManagedDocumentSourcePath(file.accessScope, file.jobId, file.relativePath);
  const extension = path.posix.extname(file.relativePath).toLowerCase() as AllowedUploadExtension;
  const mimeType = getAllowedUploadConfig(extension).normalizedMimeType;

  try {
    await updateImportFileStage({
      id: file.id,
      stage: "extracting",
    });
    const fileBuffer = await loadImportedFileBuffer(file);

    if (fileBuffer.length <= 0) {
      throw createPermanentImportError("Imported file must not be empty.", "empty_file");
    }

    if (fileBuffer.length > KNOWLEDGE_UPLOAD_MAX_BYTES) {
      throw createPermanentImportError(
        "Imported file exceeds the 10 MiB size limit.",
        "file_too_large",
      );
    }

    const contentSha256 = createHash("sha256").update(fileBuffer).digest("hex");

    let tempPdfPath = file.stagingStoragePath;

    if (file.archiveEntryPath && extension === ".pdf") {
      tempPdfPath = path.join(path.dirname(file.stagingStoragePath), `.pdf-${randomUUID()}.pdf`);
      await writeBufferAtomically(tempPdfPath, fileBuffer);
    }

    await updateImportFileStage({
      id: file.id,
      stage: "chunking",
    });

    const extractedText = await extractTextForImportedFile({
      absoluteFilePathForPdf: tempPdfPath,
      buffer: fileBuffer,
      extension,
    });

    if (tempPdfPath !== file.stagingStoragePath) {
      await removePathQuietly(tempPdfPath);
    }

    await updateImportFileStage({
      id: file.id,
      stage: "indexing",
    });
    await writeBufferAtomically(absolutePromotionPath, fileBuffer);

    const documentId = await upsertDocumentRecord({
      accessScope: file.accessScope,
      byteSize: fileBuffer.length,
      contentSha256,
      createdByUserId: file.createdByUserId,
      displayName: file.displayName,
      documentId: file.documentId,
      ingestionError: null,
      ingestionStatus: "ready",
      mimeType,
      organizationId: file.organizationId,
      sourcePath: managedSourcePath,
      sourceType: file.sourceKind === "single_file" ? "uploaded" : "bulk_import",
    });
    await replaceDocumentChunks(documentId, extractedText);

    await db
      .update(knowledgeImportJobFiles)
      .set({
        byteSize: fileBuffer.length,
        completedAt: Date.now(),
        contentSha256,
        documentId,
        lastError: null,
        lastErrorCode: null,
        mimeType,
        stage: "ready",
        updatedAt: Date.now(),
      })
      .where(eq(knowledgeImportJobFiles.id, file.id));

    await recordImportUsageEvent({
      eventType: "knowledge_import_file_ready",
      organizationId: file.organizationId,
      status: "ready",
      subjectName: file.relativePath,
      userId: file.createdByUserId,
    });
    await updateJobAggregates(file.jobId);
    await updateImportAlerts(file.organizationId);
    logStructuredEvent("knowledge-import.file_processed", {
      knowledgeImportJobId: file.jobId,
      organizationId: file.organizationId,
      userId: file.createdByUserId ?? null,
    });
  } catch (caughtError) {
    const error =
      caughtError instanceof KnowledgeImportProcessingError
        ? caughtError
        : createRetryableImportError(
            caughtError instanceof Error ? caughtError.message : "Import processing failed.",
            "processing_failed",
          );

    await db
      .update(knowledgeImportJobFiles)
      .set({
        completedAt: Date.now(),
        lastError: error.message,
        lastErrorCode: error.code,
        stage: error.retryable ? "retryable_failed" : "failed",
        updatedAt: Date.now(),
      })
      .where(eq(knowledgeImportJobFiles.id, file.id));

    await recordImportUsageEvent({
      eventType: "knowledge_import_file_failed",
      organizationId: file.organizationId,
      status: error.retryable ? "retryable_failed" : "failed",
      subjectName: file.relativePath,
      userId: file.createdByUserId,
    });
    await updateJobAggregates(file.jobId);
    await updateImportAlerts(file.organizationId);
    logStructuredEvent("knowledge-import.file_failed", {
      error: error.message,
      knowledgeImportJobId: file.jobId,
      organizationId: file.organizationId,
      userId: file.createdByUserId ?? null,
    });
  }
}

async function runKnowledgeImportWorkerLoop() {
  try {
    while (true) {
      importWorkerWakeRequested = false;
      try {
        await reclaimStaleKnowledgeImportWork();
      } catch (caughtError) {
        logStructuredError("knowledge-import.reclaim_failed", caughtError);
      }
      let claimed: ClaimedImportJobFile | null = null;

      try {
        claimed = await claimNextKnowledgeImportFile();
      } catch (caughtError) {
        logStructuredError("knowledge-import.claim_failed", caughtError);
      }

      if (!claimed) {
        break;
      }

      try {
        await processClaimedImportJobFile(claimed);
      } catch (caughtError) {
        logStructuredError("knowledge-import.process_failed", caughtError, {
          knowledgeImportJobId: claimed.jobId,
          organizationId: claimed.organizationId,
          userId: claimed.createdByUserId ?? null,
        });
      }
    }
  } finally {
    importWorkerPromise = null;

    if (importWorkerWakeRequested) {
      queueMicrotask(() => {
        ensureKnowledgeImportWorkerRunning();
      });
    }
  }
}

export function ensureKnowledgeImportWorkerRunning() {
  importWorkerWakeRequested = true;

  if (!importWorkerPromise) {
    importWorkerPromise = runKnowledgeImportWorkerLoop().catch((caughtError) => {
      logStructuredError("knowledge-import.worker_failed", caughtError);
    });
  }
}
