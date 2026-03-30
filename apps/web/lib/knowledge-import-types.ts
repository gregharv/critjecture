import type { KnowledgeAccessScope } from "@/lib/knowledge-types";

export const KNOWLEDGE_IMPORT_SOURCE_KINDS = ["single_file", "directory", "zip"] as const;
export const KNOWLEDGE_IMPORT_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
] as const;
export const KNOWLEDGE_IMPORT_FILE_STAGES = [
  "queued",
  "validating",
  "extracting",
  "chunking",
  "indexing",
  "ready",
  "retryable_failed",
  "failed",
] as const;
export const KNOWLEDGE_MANAGED_SOURCE_TYPES = ["uploaded", "bulk_import"] as const;
export const KNOWLEDGE_ARCHIVE_ACCEPT = ".zip";
export const KNOWLEDGE_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
export const KNOWLEDGE_IMPORT_MAX_FILE_COUNT = 500;

export type KnowledgeImportSourceKind = (typeof KNOWLEDGE_IMPORT_SOURCE_KINDS)[number];
export type KnowledgeImportJobStatus = (typeof KNOWLEDGE_IMPORT_JOB_STATUSES)[number];
export type KnowledgeImportFileStage = (typeof KNOWLEDGE_IMPORT_FILE_STAGES)[number];
export type KnowledgeManagedSourceType = (typeof KNOWLEDGE_MANAGED_SOURCE_TYPES)[number];

export type KnowledgeImportJobRecord = {
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
};

export type KnowledgeImportJobFileRecord = {
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

export type CreateKnowledgeImportJobResponse = {
  job: KnowledgeImportJobRecord;
};

export type GetKnowledgeImportJobResponse = {
  files: KnowledgeImportJobFileRecord[];
  job: KnowledgeImportJobRecord;
};

export type ListKnowledgeImportJobsResponse = {
  jobs: KnowledgeImportJobRecord[];
};

export type RetryKnowledgeImportJobResponse = {
  job: KnowledgeImportJobRecord;
};
