import type { CreateKnowledgeImportJobResponse } from "@/lib/knowledge-import-types";

export const KNOWLEDGE_ACCESS_SCOPES = ["public", "admin"] as const;
export const KNOWLEDGE_INGESTION_STATUSES = ["pending", "ready", "failed"] as const;
export const KNOWLEDGE_UPLOAD_ACCEPT = ".csv,.txt,.md,.pdf";
export const KNOWLEDGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export type KnowledgeAccessScope = (typeof KNOWLEDGE_ACCESS_SCOPES)[number];
export type KnowledgeIngestionStatus = (typeof KNOWLEDGE_INGESTION_STATUSES)[number];

export type KnowledgeFileRecord = {
  accessScope: KnowledgeAccessScope;
  byteSize: number | null;
  createdAt: number;
  displayName: string;
  id: string;
  ingestionError: string | null;
  ingestionStatus: KnowledgeIngestionStatus;
  lastIndexedAt: number | null;
  mimeType: string | null;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserEmail: string | null;
  uploadedByUserId: string | null;
  uploadedByUserName: string | null;
};

export type ListKnowledgeFilesResponse = {
  files: KnowledgeFileRecord[];
};

export type KnowledgeFilePreview =
  | {
      columns: string[];
      kind: "csv";
      rows: string[][];
      truncated: boolean;
    }
  | {
      kind: "text";
      lines: string[];
      truncated: boolean;
    }
  | {
      kind: "unsupported";
      message: string;
    };

export type GetKnowledgeFilePreviewResponse = {
  preview: KnowledgeFilePreview;
};

export type UploadKnowledgeFileResponse = CreateKnowledgeImportJobResponse;

export function isKnowledgeAccessScope(value: string): value is KnowledgeAccessScope {
  return KNOWLEDGE_ACCESS_SCOPES.includes(value as KnowledgeAccessScope);
}
