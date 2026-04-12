export const ANALYSIS_WORKSPACE_STATUSES = [
  "idle",
  "running",
  "completed",
  "failed",
] as const;

export const ANALYSIS_NOTEBOOK_REVISION_STATUSES = [
  "running",
  "completed",
  "failed",
  "timed_out",
  "rejected",
] as const;

export const ANALYSIS_PREVIEW_SESSION_STATUSES = [
  "starting",
  "ready",
  "stopped",
  "failed",
] as const;

export type AnalysisWorkspaceStatus = (typeof ANALYSIS_WORKSPACE_STATUSES)[number];
export type AnalysisNotebookRevisionStatus =
  (typeof ANALYSIS_NOTEBOOK_REVISION_STATUSES)[number];
export type AnalysisPreviewSessionStatus =
  (typeof ANALYSIS_PREVIEW_SESSION_STATUSES)[number];

export type AnalysisWorkspaceRecord = {
  conversationId: string;
  createdAt: number;
  id: string;
  latestRevisionId: string | null;
  latestSandboxRunId: string | null;
  organizationId: string;
  status: AnalysisWorkspaceStatus;
  title: string | null;
  updatedAt: number;
  userId: string;
};

export type AnalysisNotebookRevisionRecord = {
  createdAt: number;
  htmlExportPath: string | null;
  id: string;
  notebookPath: string;
  notebookSource: string;
  revisionNumber: number;
  sandboxRunId: string | null;
  status: AnalysisNotebookRevisionStatus;
  structuredResultPath: string | null;
  summary: string | null;
  turnId: string | null;
  workspaceId: string;
};

export type AnalysisPreviewSessionRecord = {
  createdAt: number;
  expiresAt: number;
  id: string;
  port: number | null;
  previewTokenHash: string | null;
  previewUrl: string | null;
  revisionId: string;
  sandboxRunId: string | null;
  status: AnalysisPreviewSessionStatus;
  updatedAt: number;
  workspaceId: string;
};

export type RunMarimoAnalysisRequest = {
  inputFiles?: string[];
  notebookSource: string;
  runtimeToolCallId?: string;
  title?: string;
  turnId?: string;
};

export type AnalysisPreviewBootstrapResponse = {
  expiresAt: number;
  fallbackHtmlUrl: string | null;
  port: number;
  proxyUrl: string;
  revisionId: string;
  sessionId: string;
  workspaceId: string;
};

export type AnalysisWorkspaceResponse = {
  latestRevision: AnalysisNotebookRevisionRecord | null;
  workspace: AnalysisWorkspaceRecord;
};

export type RunMarimoAnalysisResponse = {
  htmlExportAsset: {
    downloadUrl: string;
    path: string;
  } | null;
  notebookAsset: {
    downloadUrl: string | null;
    path: string;
  };
  previewUrl: string;
  revisionId: string;
  sandboxRunId: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
  status: "running" | "completed" | "failed" | "timed_out" | "rejected";
  stdout: string;
  stderr: string;
  structuredResultAsset: {
    downloadUrl: string;
    mimeType: string;
    path: string;
  } | null;
  summary: string;
  workspaceId: string;
};

function parseEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }

  return value as T[number];
}

export function parseAnalysisWorkspaceStatus(value: unknown): AnalysisWorkspaceStatus {
  return parseEnumValue(value, ANALYSIS_WORKSPACE_STATUSES, "analysis workspace status");
}

export function parseAnalysisNotebookRevisionStatus(
  value: unknown,
): AnalysisNotebookRevisionStatus {
  return parseEnumValue(
    value,
    ANALYSIS_NOTEBOOK_REVISION_STATUSES,
    "analysis notebook revision status",
  );
}

export function parseAnalysisPreviewSessionStatus(
  value: unknown,
): AnalysisPreviewSessionStatus {
  return parseEnumValue(
    value,
    ANALYSIS_PREVIEW_SESSION_STATUSES,
    "analysis preview session status",
  );
}
