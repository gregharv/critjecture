"use client";

import { useEffect, useState, type FormEvent } from "react";

import type {
  KnowledgeAccessScope,
  KnowledgeFileRecord,
  KnowledgeIngestionStatus,
  ListKnowledgeFilesResponse,
  UploadKnowledgeFileResponse,
} from "@/lib/knowledge-types";
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
} from "@/lib/knowledge-types";
import type { UserRole } from "@/lib/roles";

type KnowledgePageClientProps = {
  role: UserRole;
};

type KnowledgePageState = {
  error: string | null;
  files: KnowledgeFileRecord[];
  loading: boolean;
  uploading: boolean;
};

type ScopeFilterValue = "all" | KnowledgeAccessScope;
type StatusFilterValue = "all" | KnowledgeIngestionStatus;

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Not indexed yet";
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

function getStatusTone(status: KnowledgeIngestionStatus) {
  if (status === "ready") {
    return "is-ready";
  }

  if (status === "failed") {
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

export function KnowledgePageClient({ role }: KnowledgePageClientProps) {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilterValue>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [{ error, files, loading, uploading }, setState] = useState<KnowledgePageState>({
    error: null,
    files: [],
    loading: true,
    uploading: false,
  });

  async function loadFiles(nextScopeFilter = scopeFilter, nextStatusFilter = statusFilter) {
    setState((current) => ({
      ...current,
      error: null,
      loading: true,
    }));

    const searchParams = new URLSearchParams();

    if (nextScopeFilter !== "all" && role === "owner") {
      searchParams.set("scope", nextScopeFilter);
    }

    if (nextStatusFilter !== "all") {
      searchParams.set("status", nextStatusFilter);
    }

    const query = searchParams.toString();

    try {
      const response = await fetch(`/api/knowledge/files${query ? `?${query}` : ""}`);
      const data = (await response.json()) as ListKnowledgeFilesResponseFallback;

      if (!response.ok || !("files" in data)) {
        throw new Error(getErrorMessage(data, "Failed to load knowledge files."));
      }

      setState({
        error: null,
        files: data.files,
        loading: false,
        uploading: false,
      });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load knowledge files.",
        loading: false,
      }));
    }
  }

  useEffect(() => {
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
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
      uploading: true,
    }));

    try {
      const response = await fetch("/api/knowledge/files", {
        body: formData,
        method: "POST",
      });
      const data = (await response.json()) as UploadKnowledgeFileResponseFallback;

      if (!response.ok || !("file" in data)) {
        throw new Error(getErrorMessage(data, "Upload failed."));
      }

      form.reset();
      await loadFiles();
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error: caughtError instanceof Error ? caughtError.message : "Upload failed.",
        uploading: false,
      }));
    }
  }

  return (
    <section className="knowledge-page">
      <div className="knowledge-panel knowledge-panel--hero">
        <div className="knowledge-panel__header">
          <div>
            <p className="knowledge-panel__eyebrow">Knowledge Library</p>
            <h1 className="knowledge-panel__title">Upload tenant files for search and analysis</h1>
          </div>
          <p className="knowledge-panel__copy">
            Uploaded files are stored inside your organization&apos;s protected knowledge tree and
            become available to the existing search and sandbox workflows after ingestion.
          </p>
        </div>

        <form className="knowledge-upload" onSubmit={handleUpload}>
          <label className="knowledge-field">
            <span className="knowledge-field__label">File</span>
            <input accept={KNOWLEDGE_UPLOAD_ACCEPT} name="file" type="file" />
          </label>

          {role === "owner" ? (
            <label className="knowledge-field">
              <span className="knowledge-field__label">Scope</span>
              <select defaultValue="public" name="scope">
                <option value="public">Public</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          ) : (
            <div className="knowledge-field">
              <span className="knowledge-field__label">Scope</span>
              <div className="knowledge-field__static">Public</div>
              <input name="scope" type="hidden" value="public" />
            </div>
          )}

          <div className="knowledge-upload__actions">
            <button className="knowledge-button knowledge-button--primary" disabled={uploading}>
              {uploading ? "Uploading..." : "Upload file"}
            </button>
            <p className="knowledge-upload__hint">
              Accepted: `.csv`, `.txt`, `.md`, `.pdf`. Limit {formatBytes(KNOWLEDGE_UPLOAD_MAX_BYTES)}.
              PDFs must contain extractable text.
            </p>
          </div>
        </form>

        {error ? <div className="knowledge-banner knowledge-banner--error">{error}</div> : null}
      </div>

      <div className="knowledge-panel">
        <div className="knowledge-toolbar">
          <div>
            <p className="knowledge-panel__eyebrow">Uploaded Files</p>
            <h2 className="knowledge-subtitle">Current organization knowledge</h2>
          </div>

          <div className="knowledge-toolbar__filters">
            {role === "owner" ? (
              <label className="knowledge-field knowledge-field--compact">
                <span className="knowledge-field__label">Scope</span>
                <select
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value as ScopeFilterValue;
                    setScopeFilter(nextValue);
                    void loadFiles(nextValue, statusFilter);
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
                  void loadFiles(scopeFilter, nextValue);
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

        {loading ? (
          <div className="knowledge-empty">Loading uploaded files...</div>
        ) : files.length === 0 ? (
          <div className="knowledge-empty">
            No uploaded files yet. Add a tenant file above to make it available to the chat tools.
          </div>
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
                {files.map((file) => (
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
                      <div className={`knowledge-status ${getStatusTone(file.ingestionStatus)}`}>
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

type ListKnowledgeFilesResponseFallback =
  | ListKnowledgeFilesResponse
  | {
      error?: string;
    };

type UploadKnowledgeFileResponseFallback =
  | UploadKnowledgeFileResponse
  | {
      error?: string;
    };
