"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import type { AccessSnapshot } from "@/lib/access-control";
import { DEMO_DATASETS } from "@/lib/demo-datasets";
import type {
  CreateKnowledgeImportJobResponse,
  GetKnowledgeImportJobResponse,
  KnowledgeImportJobFileRecord,
  KnowledgeImportJobRecord,
  ListKnowledgeImportJobsResponse,
} from "@/lib/knowledge-import-types";
import type {
  GetKnowledgeFilePreviewResponse,
  KnowledgeAccessScope,
  KnowledgeFilePreview,
  KnowledgeFileRecord,
  KnowledgeIngestionStatus,
  ListKnowledgeFilesResponse,
} from "@/lib/knowledge-types";
import {
  KNOWLEDGE_ARCHIVE_ACCEPT,
  KNOWLEDGE_ARCHIVE_MAX_BYTES,
} from "@/lib/knowledge-import-types";
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
} from "@/lib/knowledge-types";
import type { UserRole } from "@/lib/roles";

type KnowledgePageClientProps = {
  access: AccessSnapshot;
  role: UserRole;
};

type KnowledgePageState = {
  activeJobDetail: GetKnowledgeImportJobResponse | null;
  activeJobId: string | null;
  activePreviewFileId: string | null;
  error: string | null;
  filePreviewById: Record<string, KnowledgeFilePreview>;
  files: KnowledgeFileRecord[];
  jobs: KnowledgeImportJobRecord[];
  loading: boolean;
  previewLoading: boolean;
  submitting: boolean;
};

type ScopeFilterValue = "all" | KnowledgeAccessScope;
type StatusFilterValue = "all" | KnowledgeIngestionStatus;
type ImportScopeValue = KnowledgeAccessScope;
type KnowledgeSortColumn =
  | "displayName"
  | "sourcePath"
  | "accessScope"
  | "mimeType"
  | "byteSize"
  | "ingestionStatus"
  | "uploadedBy"
  | "createdAt"
  | "lastIndexedAt";
type SortDirection = "asc" | "desc";

type UploadLikeFile = File & {
  webkitRelativePath?: string;
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DIRECTORY_INPUT_PROPS = {
  directory: "",
  webkitdirectory: "",
} as Record<string, string>;

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Not yet";
  }

  return DATE_TIME_FORMATTER.format(timestamp);
}

function formatBytes(bytes: number | null) {
  if (bytes === null) {
    return "Unknown";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(1)} KB`;
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function getUploaderLabel(file: KnowledgeFileRecord) {
  if (file.uploadedByUserName?.trim()) {
    return file.uploadedByUserEmail
      ? `${file.uploadedByUserName} · ${file.uploadedByUserEmail}`
      : file.uploadedByUserName;
  }

  return file.uploadedByUserEmail ?? "Unknown uploader";
}

function getFileStatusTone(status: KnowledgeIngestionStatus) {
  if (status === "ready") {
    return "is-ready";
  }

  if (status === "failed") {
    return "is-failed";
  }

  return "is-pending";
}

function getJobStatusTone(status: KnowledgeImportJobRecord["status"]) {
  if (status === "completed") {
    return "is-ready";
  }

  if (status === "failed" || status === "completed_with_errors") {
    return "is-failed";
  }

  return "is-pending";
}

function getJobFileTone(stage: KnowledgeImportJobFileRecord["stage"]) {
  if (stage === "ready") {
    return "is-ready";
  }

  if (stage === "failed" || stage === "retryable_failed") {
    return "is-failed";
  }

  return "is-pending";
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return fallbackMessage;
}

function shouldRepoll(jobs: KnowledgeImportJobRecord[]) {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}

function getProgress(job: KnowledgeImportJobRecord) {
  if (job.totalFileCount <= 0) {
    return 0;
  }

  return Math.round(
    ((job.readyFileCount + job.failedFileCount + job.retryableFailedFileCount) /
      job.totalFileCount) *
      100,
  );
}

function compareNullableNumbers(left: number | null, right: number | null) {
  return (left ?? -1) - (right ?? -1);
}

function compareText(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").localeCompare(right ?? "", undefined, { sensitivity: "base" });
}

function formatSortLabel(column: KnowledgeSortColumn, activeColumn: KnowledgeSortColumn, direction: SortDirection) {
  if (column !== activeColumn) {
    return "";
  }

  return direction === "asc" ? " ↑" : " ↓";
}

export function KnowledgePageClient({ access }: KnowledgePageClientProps) {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [sortColumn, setSortColumn] = useState<KnowledgeSortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [importScope, setImportScope] = useState<ImportScopeValue>("public");
  const [state, setState] = useState<KnowledgePageState>({
    activeJobDetail: null,
    activeJobId: null,
    activePreviewFileId: null,
    error: null,
    filePreviewById: {},
    files: [],
    jobs: [],
    loading: true,
    previewLoading: false,
    submitting: false,
  });

  const activeJob = useMemo(() => {
    if (!state.activeJobId) {
      return null;
    }

    return state.jobs.find((job) => job.id === state.activeJobId) ?? state.activeJobDetail?.job ?? null;
  }, [state.activeJobDetail, state.activeJobId, state.jobs]);

  const activePreviewFile = useMemo(() => {
    if (!state.activePreviewFileId) {
      return null;
    }

    return state.files.find((file) => file.id === state.activePreviewFileId) ?? null;
  }, [state.activePreviewFileId, state.files]);

  const activePreview = state.activePreviewFileId
    ? state.filePreviewById[state.activePreviewFileId] ?? null
    : null;

  const sortedFiles = useMemo(() => {
    const files = [...state.files];

    files.sort((left, right) => {
      let comparison = 0;

      switch (sortColumn) {
        case "displayName":
          comparison = compareText(left.displayName, right.displayName);
          break;
        case "sourcePath":
          comparison = compareText(left.sourcePath, right.sourcePath);
          break;
        case "accessScope":
          comparison = compareText(left.accessScope, right.accessScope);
          break;
        case "mimeType":
          comparison = compareText(left.mimeType ?? left.sourceType, right.mimeType ?? right.sourceType);
          break;
        case "byteSize":
          comparison = compareNullableNumbers(left.byteSize, right.byteSize);
          break;
        case "ingestionStatus":
          comparison = compareText(left.ingestionStatus, right.ingestionStatus);
          break;
        case "uploadedBy":
          comparison = compareText(getUploaderLabel(left), getUploaderLabel(right));
          break;
        case "createdAt":
          comparison = left.createdAt - right.createdAt;
          break;
        case "lastIndexedAt":
          comparison = compareNullableNumbers(left.lastIndexedAt, right.lastIndexedAt);
          break;
      }

      if (comparison === 0) {
        comparison = compareText(left.sourcePath, right.sourcePath);
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return files;
  }, [sortColumn, sortDirection, state.files]);

  const loadFiles = useCallback(async (
    nextScopeFilter = scopeFilter,
    nextStatusFilter = statusFilter,
  ) => {
    const searchParams = new URLSearchParams();

    if (nextScopeFilter !== "all" && access.visibleKnowledgeScopes.includes("admin")) {
      searchParams.set("scope", nextScopeFilter);
    }

    if (nextStatusFilter !== "all") {
      searchParams.set("status", nextStatusFilter);
    }

    const response = await fetch(`/api/knowledge/files${searchParams.toString() ? `?${searchParams}` : ""}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as ListKnowledgeFilesResponse | { error?: string };

    if (!response.ok || !("files" in data)) {
      throw new Error(getErrorMessage(data, "Failed to load knowledge files."));
    }

    return data.files;
  }, [access.visibleKnowledgeScopes, scopeFilter, statusFilter]);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/knowledge/import-jobs", {
      cache: "no-store",
    });
    const data = (await response.json()) as ListKnowledgeImportJobsResponse | { error?: string };

    if (!response.ok || !("jobs" in data)) {
      throw new Error(getErrorMessage(data, "Failed to load import jobs."));
    }

    return data.jobs;
  }, []);

  const loadJobDetail = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/knowledge/import-jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const data = (await response.json()) as GetKnowledgeImportJobResponse | { error?: string };

    if (!response.ok || !("job" in data)) {
      throw new Error(getErrorMessage(data, "Failed to load import job details."));
    }

    return data;
  }, []);

  const loadFilePreview = useCallback(async (fileId: string) => {
    let shouldFetch = true;

    setState((current) => {
      shouldFetch = !(fileId in current.filePreviewById);

      return {
        ...current,
        activePreviewFileId: fileId,
        error: null,
        previewLoading: shouldFetch,
      };
    });

    if (!shouldFetch) {
      return;
    }

    try {
      const response = await fetch(`/api/knowledge/files/${encodeURIComponent(fileId)}/preview`, {
        cache: "no-store",
      });
      const data = (await response.json()) as GetKnowledgeFilePreviewResponse | { error?: string };

      if (!response.ok || !("preview" in data)) {
        throw new Error(getErrorMessage(data, "Failed to load file preview."));
      }

      setState((current) => ({
        ...current,
        activePreviewFileId: fileId,
        error: null,
        filePreviewById: {
          ...current.filePreviewById,
          [fileId]: data.preview,
        },
        previewLoading: false,
      }));
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Failed to load file preview.",
        previewLoading: false,
      }));
    }
  }, []);

  const toggleSort = useCallback((column: KnowledgeSortColumn) => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentColumn;
      }

      setSortDirection(column === "displayName" || column === "sourcePath" || column === "uploadedBy" ? "asc" : "desc");
      return column;
    });
  }, []);


  const refreshAll = useCallback(async (options?: {
    keepSubmitting?: boolean;
    nextScopeFilter?: ScopeFilterValue;
    nextStatusFilter?: StatusFilterValue;
    selectedJobId?: string | null;
  }) => {
    const selectedJobId = options?.selectedJobId ?? state.activeJobId;
    const nextScopeFilter = options?.nextScopeFilter ?? scopeFilter;
    const nextStatusFilter = options?.nextStatusFilter ?? statusFilter;

    setState((current) => ({
      ...current,
      error: null,
      loading: current.files.length === 0 && current.jobs.length === 0,
      submitting: options?.keepSubmitting ?? current.submitting,
    }));

    try {
      const [files, jobs] = await Promise.all([
        loadFiles(nextScopeFilter, nextStatusFilter),
        loadJobs(),
      ]);
      const fallbackJobId =
        selectedJobId ??
        jobs.find((job) => job.status === "queued" || job.status === "running")?.id ??
        jobs[0]?.id ??
        null;
      const activeJobDetail = fallbackJobId ? await loadJobDetail(fallbackJobId) : null;

      setState((current) => ({
        ...current,
        activeJobDetail,
        activeJobId: fallbackJobId,
        error: null,
        files,
        jobs,
        loading: false,
        submitting: false,
      }));
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to refresh knowledge imports.",
        loading: false,
        submitting: false,
      }));
    }
  }, [loadFiles, loadJobDetail, loadJobs, scopeFilter, state.activeJobId, statusFilter]);

  const handleDeleteFile = useCallback(async (file: KnowledgeFileRecord) => {
    const confirmed = window.confirm(
      `Delete ${file.displayName}? This removes the managed file from the knowledge base and future workflow/search resolution.`,
    );

    if (!confirmed) {
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      const response = await fetch(`/api/knowledge/files/${encodeURIComponent(file.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to delete knowledge file."));
      }

      await refreshAll({
        keepSubmitting: false,
        selectedJobId: state.activeJobId,
      });
      setState((current) => ({
        ...current,
        activePreviewFileId: current.activePreviewFileId === file.id ? null : current.activePreviewFileId,
        error: null,
        filePreviewById: Object.fromEntries(
          Object.entries(current.filePreviewById).filter(([fileId]) => fileId !== file.id),
        ),
        submitting: false,
      }));
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Failed to delete knowledge file.",
        submitting: false,
      }));
    }
  }, [refreshAll, state.activeJobId]);

  useEffect(() => {
    if (!access.canViewKnowledgeLibrary) {
      return;
    }

    void refreshAll({ selectedJobId: null });
  }, [access.canViewKnowledgeLibrary, refreshAll]);

  useEffect(() => {
    if (!access.canViewKnowledgeLibrary) {
      return;
    }

    if (!shouldRepoll(state.jobs)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshAll({ selectedJobId: state.activeJobId });
    }, 3000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [access.canViewKnowledgeLibrary, refreshAll, state.activeJobId, state.jobs]);

  async function handleQuickUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");

    if (!(file instanceof File) || !file.name.trim()) {
      setState((current) => ({
        ...current,
        error: "Choose a file before uploading.",
      }));
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      formData.set("scope", importScope);
      const response = await fetch("/api/knowledge/files", {
        body: formData,
        method: "POST",
      });
      const data = (await response.json()) as CreateKnowledgeImportJobResponse | { error?: string };

      if (!response.ok || !("job" in data)) {
        throw new Error(getErrorMessage(data, "Upload failed."));
      }

      form.reset();
      await refreshAll({ selectedJobId: data.job.id });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Upload failed.",
        submitting: false,
      }));
    }
  }

  async function handleDirectoryImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const input = form.elements.namedItem("directory-files");

    if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
      setState((current) => ({
        ...current,
        error: "Choose a directory before importing.",
      }));
      return;
    }

    const formData = new FormData();
    formData.set("mode", "directory");
    formData.set("scope", importScope);

    for (const file of Array.from(input.files)) {
      const relativePath = (file as UploadLikeFile).webkitRelativePath?.trim() || file.name;
      formData.append("files", file);
      formData.append("paths", relativePath);
    }

    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      const response = await fetch("/api/knowledge/import-jobs", {
        body: formData,
        method: "POST",
      });
      const data = (await response.json()) as CreateKnowledgeImportJobResponse | { error?: string };

      if (!response.ok || !("job" in data)) {
        throw new Error(getErrorMessage(data, "Directory import failed."));
      }

      form.reset();
      await refreshAll({ selectedJobId: data.job.id });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Directory import failed.",
        submitting: false,
      }));
    }
  }

  async function handleArchiveImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const archive = formData.get("archive");

    if (!(archive instanceof File) || !archive.name.trim()) {
      setState((current) => ({
        ...current,
        error: "Choose a .zip archive before importing.",
      }));
      return;
    }

    formData.set("scope", importScope);

    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      const response = await fetch("/api/knowledge/import-jobs", {
        body: formData,
        method: "POST",
      });
      const data = (await response.json()) as CreateKnowledgeImportJobResponse | { error?: string };

      if (!response.ok || !("job" in data)) {
        throw new Error(getErrorMessage(data, "Archive import failed."));
      }

      form.reset();
      await refreshAll({ selectedJobId: data.job.id });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Archive import failed.",
        submitting: false,
      }));
    }
  }

  async function handleRetry(jobId: string) {
    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      const response = await fetch(`/api/knowledge/import-jobs/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
      });
      const data = (await response.json()) as CreateKnowledgeImportJobResponse | { error?: string };

      if (!response.ok || !("job" in data)) {
        throw new Error(getErrorMessage(data, "Retry failed."));
      }

      await refreshAll({ selectedJobId: data.job.id });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Retry failed.",
        submitting: false,
      }));
    }
  }

  async function handleDeleteManagedFiles() {
    if (!access.canManageGovernance) {
      return;
    }

    const confirmed = window.confirm(
      "This will permanently delete all managed knowledge files for the current organization. Continue?",
    );

    if (!confirmed) {
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
      submitting: true,
    }));

    try {
      const response = await fetch("/api/knowledge/managed-files/reset", {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to delete managed files."));
      }

      await refreshAll({ selectedJobId: null });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Failed to delete managed files.",
        submitting: false,
      }));
    }
  }

  if (!access.canViewKnowledgeLibrary) {
    return (
      <section className="knowledge-page">
        <div className="knowledge-panel">
          <div className="knowledge-panel__header">
            <div>
              <p className="knowledge-panel__eyebrow">Access</p>
              <h1 className="knowledge-panel__title">Knowledge library unavailable</h1>
            </div>
            <p className="knowledge-panel__copy">
              This membership cannot browse or import knowledge files.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="knowledge-page">
      <div className="knowledge-panel knowledge-panel--hero">
        <div className="knowledge-panel__header">
          <div>
            <p className="knowledge-panel__eyebrow">Knowledge Library</p>
            <h1 className="knowledge-panel__title">Async imports for search and analysis</h1>
          </div>
          <p className="knowledge-panel__copy">
            Bulk imports stage files outside the live knowledge tree, process them in the
            background, and only expose them to search and sandbox workflows after ingestion is
            ready.
          </p>
        </div>

        <div className="knowledge-import-scope">
          <label className="knowledge-field knowledge-field--compact">
            <span className="knowledge-field__label">Import scope</span>
            {access.canWriteKnowledge && access.visibleKnowledgeScopes.includes("admin") ? (
              <select
                disabled={!access.canWriteKnowledge}
                onChange={(event) => {
                  setImportScope(event.currentTarget.value as ImportScopeValue);
                }}
                value={importScope}
              >
                <option value="public">Public</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              <div className="knowledge-field__static">Public</div>
            )}
          </label>
        </div>

        <div className="knowledge-import-grid">
          <form className="knowledge-import-card" onSubmit={handleQuickUpload}>
            <div>
              <p className="knowledge-panel__eyebrow">Quick Upload</p>
              <h2 className="knowledge-subtitle">Single file</h2>
            </div>
            <label className="knowledge-field">
              <span className="knowledge-field__label">File</span>
              <input
                accept={KNOWLEDGE_UPLOAD_ACCEPT}
                disabled={!access.canWriteKnowledge}
                name="file"
                type="file"
              />
            </label>
            <button
              className="knowledge-button knowledge-button--primary"
              disabled={state.submitting || !access.canWriteKnowledge}
            >
              {state.submitting ? "Submitting..." : "Start upload job"}
            </button>
            <p className="knowledge-upload__hint">
              Accepted: `.csv`, `.txt`, `.md`, `.pdf`. Per-file limit {formatBytes(KNOWLEDGE_UPLOAD_MAX_BYTES)}.
            </p>
          </form>

          <form className="knowledge-import-card" onSubmit={handleDirectoryImport}>
            <div>
              <p className="knowledge-panel__eyebrow">Bulk Import</p>
              <h2 className="knowledge-subtitle">Directory picker</h2>
            </div>
            <label className="knowledge-field">
              <span className="knowledge-field__label">Directory</span>
              <input
                {...DIRECTORY_INPUT_PROPS}
                accept={KNOWLEDGE_UPLOAD_ACCEPT}
                disabled={!access.canWriteKnowledge}
                multiple
                name="directory-files"
                type="file"
              />
            </label>
            <button
              className="knowledge-button knowledge-button--primary"
              disabled={state.submitting || !access.canWriteKnowledge}
            >
              {state.submitting ? "Submitting..." : "Start directory job"}
            </button>
            <p className="knowledge-upload__hint">
              Preserves directory-relative paths under a scoped import root.
            </p>
          </form>

          <form className="knowledge-import-card" onSubmit={handleArchiveImport}>
            <div>
              <p className="knowledge-panel__eyebrow">Bulk Import</p>
              <h2 className="knowledge-subtitle">ZIP archive</h2>
            </div>
            <label className="knowledge-field">
              <span className="knowledge-field__label">Archive</span>
              <input
                accept={KNOWLEDGE_ARCHIVE_ACCEPT}
                disabled={!access.canWriteKnowledge}
                name="archive"
                type="file"
              />
            </label>
            <button
              className="knowledge-button knowledge-button--primary"
              disabled={state.submitting || !access.canWriteKnowledge}
            >
              {state.submitting ? "Submitting..." : "Start archive job"}
            </button>
            <p className="knowledge-upload__hint">
              `.zip` only. Archive limit {formatBytes(KNOWLEDGE_ARCHIVE_MAX_BYTES)}.
            </p>
          </form>
        </div>

        {state.error ? <div className="knowledge-banner knowledge-banner--error">{state.error}</div> : null}
      </div>

      <div className="knowledge-panel">
        <div className="knowledge-toolbar">
          <div>
            <p className="knowledge-panel__eyebrow">Demo Downloads</p>
            <h2 className="knowledge-subtitle">Public datasets for upload and directory-import demos</h2>
          </div>
          <p className="knowledge-panel__copy">
            Download a single-file CSV for a quick upload demo, or grab the ZIP bundle and extract
            it to show the directory picker.
          </p>
        </div>

        <div className="knowledge-demo-grid">
          {DEMO_DATASETS.map((dataset) => (
            <article className="knowledge-demo-card" key={dataset.id}>
              <div>
                <p className="knowledge-panel__eyebrow">
                  {dataset.downloadMode === "zip-bundle" ? "ZIP bundle" : "Single file"}
                </p>
                <h3 className="knowledge-demo-card__title">{dataset.title}</h3>
              </div>
              <p className="knowledge-demo-card__copy">{dataset.description}</p>
              <p className="knowledge-demo-card__hint">{dataset.uploadHint}</p>
              <a
                className="knowledge-button knowledge-button--primary"
                href={`/api/knowledge/demo-datasets/${dataset.id}`}
              >
                Download {dataset.downloadMode === "zip-bundle" ? "ZIP" : "CSV"}
              </a>
            </article>
          ))}
        </div>

        <div className="knowledge-demo-reset">
          <div>
            <p className="knowledge-panel__eyebrow">Clean slate</p>
            <h3 className="knowledge-demo-card__title">Delete managed files for a fresh demo</h3>
            <p className="knowledge-demo-card__copy">
              Owner-only. This uses the existing governance path to remove uploaded knowledge files
              and import metadata so you can re-run the upload flow from scratch.
            </p>
          </div>
          <button
            className="knowledge-button knowledge-button--danger"
            disabled={state.submitting || !access.canManageGovernance}
            onClick={() => void handleDeleteManagedFiles()}
            type="button"
          >
            {state.submitting ? "Working..." : "Delete managed files"}
          </button>
        </div>
      </div>

      <div className="knowledge-panel">
        <div className="knowledge-toolbar">
          <div>
            <p className="knowledge-panel__eyebrow">Import Jobs</p>
            <h2 className="knowledge-subtitle">Background ingestion status</h2>
          </div>
          <button
            className="knowledge-button"
            onClick={() => {
              void refreshAll({ selectedJobId: state.activeJobId });
            }}
            type="button"
          >
            Refresh
          </button>
        </div>

        {state.loading ? (
          <div className="knowledge-empty">Loading import jobs...</div>
        ) : state.jobs.length === 0 ? (
          <div className="knowledge-empty">No import jobs yet.</div>
        ) : (
          <div className="knowledge-jobs">
            {state.jobs.map((job) => (
              <article
                className={`knowledge-job-card${state.activeJobId === job.id ? " is-active" : ""}`}
                key={job.id}
              >
                <div className="knowledge-job-card__header">
                  <div>
                    <strong>{job.sourceKind.replaceAll("_", " ")}</strong>
                    <div className="knowledge-job-card__meta">
                      {job.accessScope} · {job.totalFileCount} file{job.totalFileCount === 1 ? "" : "s"} · updated{" "}
                      {formatTimestamp(job.updatedAt)}
                    </div>
                  </div>
                  <div className={`knowledge-status ${getJobStatusTone(job.status)}`}>{job.status.replaceAll("_", " ")}</div>
                </div>
                <div className="knowledge-job-progress">
                  <div
                    className="knowledge-job-progress__bar"
                    style={{ width: `${getProgress(job)}%` }}
                  />
                </div>
                <div className="knowledge-job-card__meta">
                  Ready {job.readyFileCount} · Failed {job.failedFileCount} · Retryable {job.retryableFailedFileCount}
                </div>
                <div className="knowledge-job-card__actions">
                  <button
                    className="knowledge-button"
                    onClick={() => {
                      void refreshAll({ selectedJobId: job.id });
                    }}
                    type="button"
                  >
                    View files
                  </button>
                  {job.retryableFailedFileCount > 0 ? (
                    <button
                      className="knowledge-button"
                      disabled={state.submitting || !access.canWriteKnowledge}
                      onClick={() => {
                        void handleRetry(job.id);
                      }}
                      type="button"
                    >
                      Retry failures
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {activeJob && state.activeJobDetail ? (
        <div className="knowledge-panel">
          <div className="knowledge-toolbar">
            <div>
              <p className="knowledge-panel__eyebrow">Selected Job</p>
              <h2 className="knowledge-subtitle">Imported files for {activeJob.id}</h2>
            </div>
            <div className={`knowledge-status ${getJobStatusTone(activeJob.status)}`}>{activeJob.status.replaceAll("_", " ")}</div>
          </div>

          <div className="knowledge-job-detail__meta">
            Created {formatTimestamp(activeJob.createdAt)} · Started {formatTimestamp(activeJob.startedAt)} · Completed {formatTimestamp(activeJob.completedAt)}
          </div>

          <div className="knowledge-table-wrap">
            <table className="knowledge-table">
              <thead>
                <tr>
                  <th>Relative path</th>
                  <th>Stage</th>
                  <th>Size</th>
                  <th>Attempts</th>
                  <th>Error</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {state.activeJobDetail.files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <code className="knowledge-code">{file.relativePath}</code>
                    </td>
                    <td>
                      <div className={`knowledge-status ${getJobFileTone(file.stage)}`}>
                        {file.stage.replaceAll("_", " ")}
                      </div>
                    </td>
                    <td>{formatBytes(file.byteSize)}</td>
                    <td>{file.attemptCount}</td>
                    <td>{file.lastError ?? "None"}</td>
                    <td>
                      {file.stage === "retryable_failed" ? (
                        <button
                          className="knowledge-button"
                          disabled={state.submitting || !access.canWriteKnowledge}
                          onClick={() => {
                            void handleRetry(activeJob.id);
                          }}
                          type="button"
                        >
                          Retry job
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="knowledge-panel">
        <div className="knowledge-toolbar">
          <div>
            <p className="knowledge-panel__eyebrow">Knowledge Library</p>
            <h2 className="knowledge-subtitle">Ready and failed documents</h2>
          </div>

          <div className="knowledge-toolbar__filters">
            {access.visibleKnowledgeScopes.includes("admin") ? (
              <label className="knowledge-field knowledge-field--compact">
                <span className="knowledge-field__label">Scope</span>
                <select
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value as ScopeFilterValue;
                    setScopeFilter(nextValue);
                    void refreshAll({
                      nextScopeFilter: nextValue,
                      selectedJobId: state.activeJobId,
                    });
                  }}
                  value={scopeFilter}
                >
                  <option value="all">All scopes</option>
                  <option value="public">Public</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
            ) : null}

            <label className="knowledge-field knowledge-field--compact">
              <span className="knowledge-field__label">Status</span>
              <select
                onChange={(event) => {
                  const nextValue = event.currentTarget.value as StatusFilterValue;
                  setStatusFilter(nextValue);
                  void refreshAll({
                    nextStatusFilter: nextValue,
                    selectedJobId: state.activeJobId,
                  });
                }}
                value={statusFilter}
              >
                <option value="all">All statuses</option>
                <option value="ready">Ready</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
        </div>

        {state.loading ? (
          <div className="knowledge-empty">Loading knowledge files...</div>
        ) : state.files.length === 0 ? (
          <div className="knowledge-empty">No managed knowledge files yet.</div>
        ) : (
          <>
            <div className="knowledge-table-wrap">
            <table className="knowledge-table">
              <thead>
                <tr>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("displayName")} type="button">
                      Name{formatSortLabel("displayName", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("sourcePath")} type="button">
                      Relative path{formatSortLabel("sourcePath", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("accessScope")} type="button">
                      Scope{formatSortLabel("accessScope", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("mimeType")} type="button">
                      Type{formatSortLabel("mimeType", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("byteSize")} type="button">
                      Size{formatSortLabel("byteSize", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("ingestionStatus")} type="button">
                      Status{formatSortLabel("ingestionStatus", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("uploadedBy")} type="button">
                      Uploaded by{formatSortLabel("uploadedBy", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("createdAt")} type="button">
                      Uploaded at{formatSortLabel("createdAt", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button className="knowledge-sort-button" onClick={() => toggleSort("lastIndexedAt")} type="button">
                      Last indexed{formatSortLabel("lastIndexedAt", sortColumn, sortDirection)}
                    </button>
                  </th>
                  <th>Preview</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file) => {
                  const previewIsActive = state.activePreviewFileId === file.id;

                  return (
                    <tr key={file.id}>
                      <td>
                        <div className="knowledge-table__title">{file.displayName}</div>
                      </td>
                      <td>
                        <code className="knowledge-code">{file.sourcePath}</code>
                      </td>
                      <td>{file.accessScope}</td>
                      <td>{file.mimeType ?? file.sourceType}</td>
                      <td>{formatBytes(file.byteSize)}</td>
                      <td>
                        <div className={`knowledge-status ${getFileStatusTone(file.ingestionStatus)}`}>
                          {file.ingestionStatus}
                        </div>
                        {file.ingestionError ? (
                          <div className="knowledge-status__error">{file.ingestionError}</div>
                        ) : null}
                      </td>
                      <td>{getUploaderLabel(file)}</td>
                      <td>{formatTimestamp(file.createdAt)}</td>
                      <td>{formatTimestamp(file.lastIndexedAt)}</td>
                      <td>
                        {file.ingestionStatus === "ready" ? (
                          <button
                            className="knowledge-button"
                            onClick={() => {
                              if (previewIsActive) {
                                setState((current) => ({
                                  ...current,
                                  activePreviewFileId: null,
                                  previewLoading: false,
                                }));
                                return;
                              }

                              void loadFilePreview(file.id);
                            }}
                            type="button"
                          >
                            {previewIsActive ? "Hide" : "Preview"}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <button
                          className="knowledge-button knowledge-button--danger"
                          disabled={state.submitting}
                          onClick={() => {
                            void handleDeleteFile(file);
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {activePreviewFile ? (
            <div className="knowledge-preview">
              <div className="knowledge-toolbar">
                <div>
                  <p className="knowledge-panel__eyebrow">Preview</p>
                  <h3 className="knowledge-subtitle">{activePreviewFile.displayName}</h3>
                </div>
                <div className="knowledge-job-card__meta">
                  <code className="knowledge-code">{activePreviewFile.sourcePath}</code>
                </div>
              </div>

              {state.previewLoading ? (
                <div className="knowledge-empty">Loading preview…</div>
              ) : activePreview?.kind === "csv" ? (
                <>
                  <div className="knowledge-table-wrap">
                    <table className="knowledge-table knowledge-table--compact">
                      <thead>
                        <tr>
                          {activePreview.columns.map((column, index) => (
                            <th key={`${column}-${index}`}>{column || `Column ${index + 1}`}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activePreview.rows.map((row, rowIndex) => (
                          <tr key={`preview-row-${rowIndex}`}>
                            {activePreview.columns.map((_, columnIndex) => (
                              <td key={`preview-cell-${rowIndex}-${columnIndex}`}>
                                {row[columnIndex] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {activePreview.truncated ? (
                    <p className="knowledge-upload__hint">Showing the first 20 rows.</p>
                  ) : null}
                </>
              ) : activePreview?.kind === "text" ? (
                <>
                  <pre className="knowledge-preview__text">{activePreview.lines.join("\n")}</pre>
                  {activePreview.truncated ? (
                    <p className="knowledge-upload__hint">Showing the first 20 non-empty lines.</p>
                  ) : null}
                </>
              ) : activePreview?.kind === "unsupported" ? (
                <div className="knowledge-empty">{activePreview.message}</div>
              ) : (
                <div className="knowledge-empty">Preview unavailable.</div>
              )}
            </div>
          ) : null}
          </>
        )}
      </div>
    </section>
  );
}
