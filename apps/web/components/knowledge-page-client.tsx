"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import type { AccessSnapshot } from "@/lib/access-control";
import type {
  CreateKnowledgeImportJobResponse,
  GetKnowledgeImportJobResponse,
  KnowledgeImportJobFileRecord,
  KnowledgeImportJobRecord,
  ListKnowledgeImportJobsResponse,
} from "@/lib/knowledge-import-types";
import type {
  KnowledgeAccessScope,
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
  error: string | null;
  files: KnowledgeFileRecord[];
  jobs: KnowledgeImportJobRecord[];
  loading: boolean;
  submitting: boolean;
};

type ScopeFilterValue = "all" | KnowledgeAccessScope;
type StatusFilterValue = "all" | KnowledgeIngestionStatus;
type ImportScopeValue = KnowledgeAccessScope;

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

export function KnowledgePageClient({ access, role }: KnowledgePageClientProps) {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [importScope, setImportScope] = useState<ImportScopeValue>("public");
  const [state, setState] = useState<KnowledgePageState>({
    activeJobDetail: null,
    activeJobId: null,
    error: null,
    files: [],
    jobs: [],
    loading: true,
    submitting: false,
  });

  const activeJob = useMemo(() => {
    if (!state.activeJobId) {
      return null;
    }

    return state.jobs.find((job) => job.id === state.activeJobId) ?? state.activeJobDetail?.job ?? null;
  }, [state.activeJobDetail, state.activeJobId, state.jobs]);

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
  }, [role, scopeFilter, statusFilter]);

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
          <div className="knowledge-table-wrap">
            <table className="knowledge-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Relative path</th>
                  <th>Scope</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Uploaded by</th>
                  <th>Uploaded at</th>
                  <th>Last indexed</th>
                </tr>
              </thead>
              <tbody>
                {state.files.map((file) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
