"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AccessSnapshot } from "@/lib/access-control";

type WorkflowsPageClientProps = {
  access: AccessSnapshot;
};

type WorkflowRecord = {
  createdAt: number;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  description: string | null;
  id: string;
  lastRunAt: number | null;
  name: string;
  nextRunAt: number | null;
  status: "draft" | "active" | "paused" | "archived";
  updatedAt: number;
  visibility: "private" | "organization";
};

type WorkflowVersionSummary = {
  createdAt: number;
  id: string;
  versionNumber: number;
};

type WorkflowContractsSummary = {
  delivery: {
    channels: unknown[];
  };
  inputContract: {
    inputs: unknown[];
  };
  recipe: {
    steps: unknown[];
  };
};

type WorkflowDetailRecord = {
  currentVersion: {
    contracts: WorkflowContractsSummary;
    createdAt: number;
    id: string;
    versionNumber: number;
  } | null;
  versions: WorkflowVersionSummary[];
  workflow: WorkflowRecord;
};

type WorkflowRunRecord = {
  completedAt: number | null;
  createdAt: number;
  failureReason: string | null;
  id: string;
  metadata: Record<string, unknown>;
  runAsRole: "member" | "admin" | "owner";
  runAsUserId: string | null;
  startedAt: number | null;
  status:
    | "queued"
    | "running"
    | "waiting_for_input"
    | "blocked_validation"
    | "completed"
    | "failed"
    | "cancelled";
  triggerKind: "manual" | "scheduled" | "resume";
  workflowVersionId: string;
  workflowVersionNumber: number | null;
};

type WorkflowRunStepRecord = {
  completedAt: number | null;
  errorMessage: string | null;
  id: string;
  sandboxRunId: string | null;
  startedAt: number | null;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  stepKey: string;
  stepOrder: number;
  toolName: string;
};

type WorkflowRunInputCheckRecord = {
  id: string;
  inputKey: string;
  report: {
    checks: Array<{
      code: string;
      message: string;
      status: "pass" | "warn" | "fail";
    }>;
    status: "pass" | "warn" | "fail";
  };
  status: "pass" | "warn" | "fail";
};

type WorkflowRunInputRequestRecord = {
  createdAt: number;
  expiresAt: number | null;
  id: string;
  requestedInputKeys: string[];
  sentAt: number | null;
  status: "open" | "sent" | "fulfilled" | "expired" | "cancelled";
};

type WorkflowRunDeliveryRecord = {
  attemptNumber: number;
  channelKind: "webhook" | "chart_pack" | "ranked_table" | "generated_document" | "email";
  errorMessage: string | null;
  sentAt: number | null;
  status: "pending" | "sent" | "failed";
};

type WorkflowRunAlert = {
  message: string;
  severity: "info" | "warning" | "critical";
  source: "input_request" | "input_validation" | "run_failure" | "run_state";
};

type WorkflowRunChangeSummary = {
  artifactCountDelta: number | null;
  comparedToRunId: string | null;
  inputKeysAdded: string[];
  inputKeysChanged: string[];
  inputKeysRemoved: string[];
  inputKeysUnchanged: string[];
  statusChanged: boolean;
  workflowVersionChanged: boolean;
};

type WorkflowRunDetailResponse = {
  alerts: WorkflowRunAlert[];
  changeSummary: WorkflowRunChangeSummary;
  deliveries: WorkflowRunDeliveryRecord[];
  inputChecks: WorkflowRunInputCheckRecord[];
  inputRequests: WorkflowRunInputRequestRecord[];
  previousRun: {
    completedAt: number | null;
    id: string;
    status: string;
    workflowVersionNumber: number | null;
  } | null;
  run: WorkflowRunRecord;
  steps: WorkflowRunStepRecord[];
};

type WorkflowListResponse = {
  workflows: WorkflowRecord[];
};

type WorkflowDetailResponse = {
  workflow: WorkflowDetailRecord;
};

type WorkflowRunsResponse = {
  runs: WorkflowRunRecord[];
};

type ManualRunResponse = {
  run: WorkflowRunRecord;
  status: string;
};

type WorkflowsPageState = {
  error: string | null;
  loadingRunDetail: boolean;
  loadingWorkflowData: boolean;
  loadingWorkflows: boolean;
  runningNow: boolean;
  runDetail: WorkflowRunDetailResponse | null;
  runs: WorkflowRunRecord[];
  selectedRunId: string | null;
  selectedWorkflowId: string | null;
  workflowDetail: WorkflowDetailRecord | null;
  workflows: WorkflowRecord[];
};

type MetadataResolvedInput = {
  documents: Array<{
    content_sha256: string;
    display_name: string;
    source_path: string;
    updated_at: number;
  }>;
  input_key: string;
};

type MetadataArtifact = {
  byte_size: number;
  file_name: string;
  mime_type: string;
  relative_path: string;
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }

  return fallbackMessage;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  });
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(getErrorMessage(json, "Request failed."));
  }

  return json as T;
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Not yet";
  }

  return DATE_TIME_FORMATTER.format(timestamp);
}

function formatDuration(startedAt: number | null, completedAt: number | null) {
  if (!startedAt || !completedAt || completedAt < startedAt) {
    return "—";
  }

  const totalMs = completedAt - startedAt;

  if (totalMs < 1_000) {
    return `${totalMs} ms`;
  }

  const seconds = totalMs / 1_000;

  if (seconds < 120) {
    return `${seconds.toFixed(1)} s`;
  }

  return `${(seconds / 60).toFixed(1)} min`;
}

function formatByteSize(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  const kb = value / 1024;

  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  return `${(kb / 1024).toFixed(1)} MB`;
}

function getToneClass(status: string) {
  if (
    status === "completed" ||
    status === "active" ||
    status === "sent" ||
    status === "fulfilled" ||
    status === "pass"
  ) {
    return "is-ready";
  }

  if (
    status === "failed" ||
    status === "blocked_validation" ||
    status === "critical" ||
    status === "archived" ||
    status === "expired" ||
    status === "cancelled" ||
    status === "fail"
  ) {
    return "is-failed";
  }

  if (status === "warn" || status === "warning") {
    return "is-warn";
  }

  return "is-pending";
}

function toMetadataResolvedInputs(metadata: Record<string, unknown>) {
  const resolvedInputs = metadata.resolved_inputs;

  if (!Array.isArray(resolvedInputs)) {
    return [];
  }

  const normalized: MetadataResolvedInput[] = [];

  for (const item of resolvedInputs) {
    if (!isRecord(item)) {
      continue;
    }

    const inputKey = normalizeText(item.input_key);

    if (!inputKey) {
      continue;
    }

    const documents = Array.isArray(item.documents)
      ? item.documents
          .map((documentValue) => {
            if (!isRecord(documentValue)) {
              return null;
            }

            const displayName = normalizeText(documentValue.display_name);
            const contentSha = normalizeText(documentValue.content_sha256);
            const sourcePath = normalizeText(documentValue.source_path);
            const updatedAt =
              typeof documentValue.updated_at === "number"
                ? documentValue.updated_at
                : 0;

            if (!displayName || !contentSha) {
              return null;
            }

            return {
              content_sha256: contentSha,
              display_name: displayName,
              source_path: sourcePath,
              updated_at: updatedAt,
            };
          })
          .filter((entry): entry is MetadataResolvedInput["documents"][number] => entry !== null)
      : [];

    normalized.push({
      documents,
      input_key: inputKey,
    });
  }

  return normalized;
}

function toMetadataArtifacts(metadata: Record<string, unknown>) {
  const artifacts = metadata.generated_artifacts;

  if (!Array.isArray(artifacts)) {
    return [];
  }

  return artifacts
    .map((artifactValue) => {
      if (!isRecord(artifactValue)) {
        return null;
      }

      const fileName = normalizeText(artifactValue.file_name);
      const mimeType = normalizeText(artifactValue.mime_type);
      const relativePath = normalizeText(artifactValue.relative_path);
      const byteSize = typeof artifactValue.byte_size === "number" ? artifactValue.byte_size : 0;

      if (!fileName || !mimeType || !relativePath) {
        return null;
      }

      return {
        byte_size: byteSize,
        file_name: fileName,
        mime_type: mimeType,
        relative_path: relativePath,
      } satisfies MetadataArtifact;
    })
    .filter((entry): entry is MetadataArtifact => entry !== null);
}

export function WorkflowsPageClient({ access }: WorkflowsPageClientProps) {
  const [state, setState] = useState<WorkflowsPageState>({
    error: null,
    loadingRunDetail: false,
    loadingWorkflowData: false,
    loadingWorkflows: true,
    runDetail: null,
    runningNow: false,
    runs: [],
    selectedRunId: null,
    selectedWorkflowId: null,
    workflowDetail: null,
    workflows: [],
  });
  const selectedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedRunIdRef.current = state.selectedRunId;
  }, [state.selectedRunId]);

  const selectedWorkflow = useMemo(
    () => state.workflows.find((workflow) => workflow.id === state.selectedWorkflowId) ?? null,
    [state.selectedWorkflowId, state.workflows],
  );

  const selectedRun = useMemo(
    () => state.runs.find((run) => run.id === state.selectedRunId) ?? null,
    [state.runs, state.selectedRunId],
  );

  const loadRunDetail = useCallback(async (runId: string) => {
    setState((current) => ({
      ...current,
      error: null,
      loadingRunDetail: true,
    }));

    try {
      const data = await fetchJson<WorkflowRunDetailResponse>(
        `/api/workflow-runs/${encodeURIComponent(runId)}`,
      );

      setState((current) => {
        if (current.selectedRunId !== runId) {
          return current;
        }

        return {
          ...current,
          error: null,
          loadingRunDetail: false,
          runDetail: data,
        };
      });
    } catch (caughtError) {
      setState((current) => {
        if (current.selectedRunId !== runId) {
          return current;
        }

        return {
          ...current,
          error:
            caughtError instanceof Error
              ? caughtError.message
              : "Failed to load workflow run details.",
          loadingRunDetail: false,
        };
      });
    }
  }, []);

  const loadSelectedWorkflowData = useCallback(
    async (workflowId: string, options?: { preferredRunId?: string | null }) => {
      setState((current) => ({
        ...current,
        error: null,
        loadingWorkflowData: true,
      }));

      try {
        const [workflowDetailResponse, runsResponse] = await Promise.all([
          fetchJson<WorkflowDetailResponse>(`/api/workflows/${encodeURIComponent(workflowId)}`),
          fetchJson<WorkflowRunsResponse>(`/api/workflows/${encodeURIComponent(workflowId)}/runs?limit=100`),
        ]);

        const preferredRunId = options?.preferredRunId ?? selectedRunIdRef.current;
        const nextSelectedRunId =
          preferredRunId && runsResponse.runs.some((run) => run.id === preferredRunId)
            ? preferredRunId
            : runsResponse.runs[0]?.id ?? null;

        setState((current) => {
          if (current.selectedWorkflowId !== workflowId) {
            return current;
          }

          return {
            ...current,
            error: null,
            loadingWorkflowData: false,
            runDetail:
              nextSelectedRunId && current.runDetail?.run.id === nextSelectedRunId
                ? current.runDetail
                : null,
            runs: runsResponse.runs,
            selectedRunId: nextSelectedRunId,
            workflowDetail: workflowDetailResponse.workflow,
          };
        });
      } catch (caughtError) {
        setState((current) => {
          if (current.selectedWorkflowId !== workflowId) {
            return current;
          }

          return {
            ...current,
            error:
              caughtError instanceof Error
                ? caughtError.message
                : "Failed to load workflow details.",
            loadingWorkflowData: false,
          };
        });
      }
    },
    [],
  );

  const loadWorkflowList = useCallback(async () => {
    setState((current) => ({
      ...current,
      error: null,
      loadingWorkflows: true,
    }));

    try {
      const data = await fetchJson<WorkflowListResponse>("/api/workflows");

      setState((current) => {
        const nextSelectedWorkflowId =
          current.selectedWorkflowId &&
          data.workflows.some((workflow) => workflow.id === current.selectedWorkflowId)
            ? current.selectedWorkflowId
            : data.workflows[0]?.id ?? null;

        return {
          ...current,
          error: null,
          loadingWorkflows: false,
          runDetail: nextSelectedWorkflowId === current.selectedWorkflowId ? current.runDetail : null,
          runs: nextSelectedWorkflowId === current.selectedWorkflowId ? current.runs : [],
          selectedRunId:
            nextSelectedWorkflowId === current.selectedWorkflowId ? current.selectedRunId : null,
          selectedWorkflowId: nextSelectedWorkflowId,
          workflowDetail:
            nextSelectedWorkflowId === current.selectedWorkflowId
              ? current.workflowDetail
              : null,
          workflows: data.workflows,
        };
      });
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to load workflows.",
        loadingWorkflows: false,
      }));
    }
  }, []);

  useEffect(() => {
    void loadWorkflowList();
  }, [loadWorkflowList]);

  useEffect(() => {
    if (!state.selectedWorkflowId) {
      return;
    }

    void loadSelectedWorkflowData(state.selectedWorkflowId);
  }, [loadSelectedWorkflowData, state.selectedWorkflowId]);

  useEffect(() => {
    if (!state.selectedRunId) {
      setState((current) => {
        if (!current.loadingRunDetail && current.runDetail === null) {
          return current;
        }

        return {
          ...current,
          loadingRunDetail: false,
          runDetail: null,
        };
      });
      return;
    }

    void loadRunDetail(state.selectedRunId);
  }, [loadRunDetail, state.selectedRunId]);

  async function handleRunNow() {
    if (!state.selectedWorkflowId || !access.canManageWorkflows) {
      return;
    }

    setState((current) => ({
      ...current,
      error: null,
      runningNow: true,
    }));

    try {
      const response = await fetchJson<ManualRunResponse>(
        `/api/workflows/${encodeURIComponent(state.selectedWorkflowId)}/runs`,
        {
          method: "POST",
        },
      );

      await loadSelectedWorkflowData(state.selectedWorkflowId, {
        preferredRunId: response.run.id,
      });
      await loadWorkflowList();
      await loadRunDetail(response.run.id);

      setState((current) => ({
        ...current,
        error: null,
        runningNow: false,
        selectedRunId: response.run.id,
      }));
    } catch (caughtError) {
      setState((current) => ({
        ...current,
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to trigger workflow run.",
        runningNow: false,
      }));
    }
  }

  const runArtifacts = useMemo(
    () => (state.runDetail ? toMetadataArtifacts(state.runDetail.run.metadata) : []),
    [state.runDetail],
  );

  const resolvedInputs = useMemo(
    () => (state.runDetail ? toMetadataResolvedInputs(state.runDetail.run.metadata) : []),
    [state.runDetail],
  );

  return (
    <section className="workflows-page">
      <header className="workflows-hero">
        <div>
          <p className="workflows-hero__eyebrow">Workflow Runs</p>
          <h1 className="workflows-hero__title">Saved workflows and execution history</h1>
          <p className="workflows-hero__copy">
            Inspect versions, run traces, input validation, and delivery attempts for repeatable
            analytics workflows.
          </p>
        </div>
        <button
          className="workflows-button"
          disabled={state.loadingWorkflows}
          onClick={() => {
            void loadWorkflowList();
          }}
          type="button"
        >
          {state.loadingWorkflows ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {state.error ? <div className="workflows-banner workflows-banner--error">{state.error}</div> : null}

      <div className="workflows-grid">
        <aside className="workflows-panel workflows-panel--list">
          <div className="workflows-panel__header">
            <div>
              <p className="workflows-panel__eyebrow">Definitions</p>
              <h2>Workflows</h2>
            </div>
          </div>

          {state.loadingWorkflows ? (
            <div className="workflows-empty">Loading workflows...</div>
          ) : state.workflows.length === 0 ? (
            <div className="workflows-empty">No workflows created yet.</div>
          ) : (
            <div className="workflows-list">
              {state.workflows.map((workflow) => (
                <button
                  className={`workflows-list-item${
                    workflow.id === state.selectedWorkflowId ? " is-active" : ""
                  }`}
                  key={workflow.id}
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      error: null,
                      runDetail: null,
                      runs: [],
                      selectedRunId: null,
                      selectedWorkflowId: workflow.id,
                      workflowDetail: null,
                    }));
                  }}
                  type="button"
                >
                  <div className="workflows-list-item__header">
                    <strong>{workflow.name}</strong>
                    <span className={`workflow-chip ${getToneClass(workflow.status)}`}>
                      {workflow.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className="workflows-list-item__meta">
                    v{workflow.currentVersionNumber ?? "—"} · updated {formatTimestamp(workflow.updatedAt)}
                  </div>
                  {workflow.description ? (
                    <p className="workflows-list-item__description">{workflow.description}</p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="workflows-content">
          {!selectedWorkflow ? (
            <div className="workflows-panel">
              <div className="workflows-empty">Select a workflow to inspect runs.</div>
            </div>
          ) : (
            <>
              <section className="workflows-panel">
                <div className="workflows-panel__header">
                  <div>
                    <p className="workflows-panel__eyebrow">Selected workflow</p>
                    <h2>{selectedWorkflow.name}</h2>
                  </div>
                  <div className="workflows-panel__actions">
                    <button
                      className="workflows-button"
                      disabled={state.loadingWorkflowData || !state.selectedWorkflowId}
                      onClick={() => {
                        if (state.selectedWorkflowId) {
                          void loadSelectedWorkflowData(state.selectedWorkflowId);
                        }
                      }}
                      type="button"
                    >
                      {state.loadingWorkflowData ? "Refreshing..." : "Refresh runs"}
                    </button>
                    {access.canManageWorkflows ? (
                      <button
                        className="workflows-button workflows-button--primary"
                        disabled={state.runningNow || selectedWorkflow.status === "archived"}
                        onClick={() => {
                          void handleRunNow();
                        }}
                        type="button"
                      >
                        {state.runningNow ? "Running..." : "Run now"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="workflows-facts">
                  <div>
                    <span>Visibility</span>
                    <strong>{selectedWorkflow.visibility}</strong>
                  </div>
                  <div>
                    <span>Current version</span>
                    <strong>v{selectedWorkflow.currentVersionNumber ?? "—"}</strong>
                  </div>
                  <div>
                    <span>Last run</span>
                    <strong>{formatTimestamp(selectedWorkflow.lastRunAt)}</strong>
                  </div>
                  <div>
                    <span>Next run</span>
                    <strong>{formatTimestamp(selectedWorkflow.nextRunAt)}</strong>
                  </div>
                </div>

                {state.workflowDetail?.currentVersion ? (
                  <div className="workflows-current-version">
                    <span>
                      Inputs: {state.workflowDetail.currentVersion.contracts.inputContract.inputs.length}
                    </span>
                    <span>
                      Steps: {state.workflowDetail.currentVersion.contracts.recipe.steps.length}
                    </span>
                    <span>
                      Delivery channels: {state.workflowDetail.currentVersion.contracts.delivery.channels.length}
                    </span>
                    <span>Versions: {state.workflowDetail.versions.length}</span>
                  </div>
                ) : null}
              </section>

              <section className="workflows-panel">
                <div className="workflows-panel__header">
                  <div>
                    <p className="workflows-panel__eyebrow">Run history</p>
                    <h2>Recent runs</h2>
                  </div>
                </div>

                {state.loadingWorkflowData ? (
                  <div className="workflows-empty">Loading runs...</div>
                ) : state.runs.length === 0 ? (
                  <div className="workflows-empty">No runs yet for this workflow.</div>
                ) : (
                  <div className="workflows-table-wrap">
                    <table className="workflows-table">
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Status</th>
                          <th>Version</th>
                          <th>Trigger</th>
                          <th>Run as</th>
                          <th>Started</th>
                          <th>Completed</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {state.runs.map((run) => (
                          <tr key={run.id}>
                            <td>
                              <code>{run.id}</code>
                            </td>
                            <td>
                              <span className={`workflow-chip ${getToneClass(run.status)}`}>
                                {run.status.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td>v{run.workflowVersionNumber ?? "—"}</td>
                            <td>{run.triggerKind}</td>
                            <td>{run.runAsRole}</td>
                            <td>{formatTimestamp(run.startedAt ?? run.createdAt)}</td>
                            <td>{formatTimestamp(run.completedAt)}</td>
                            <td>
                              <button
                                className="workflows-button"
                                onClick={() => {
                                  setState((current) => ({
                                    ...current,
                                    selectedRunId: run.id,
                                  }));
                                }}
                                type="button"
                              >
                                {run.id === state.selectedRunId ? "Selected" : "Details"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {selectedRun ? (
                <section className="workflows-panel">
                  <div className="workflows-panel__header">
                    <div>
                      <p className="workflows-panel__eyebrow">Run detail</p>
                      <h2>{selectedRun.id}</h2>
                    </div>
                    <span className={`workflow-chip ${getToneClass(selectedRun.status)}`}>
                      {selectedRun.status.replaceAll("_", " ")}
                    </span>
                  </div>

                  {state.loadingRunDetail && !state.runDetail ? (
                    <div className="workflows-empty">Loading run details...</div>
                  ) : state.runDetail ? (
                    <div className="workflows-run-detail">
                      <div className="workflows-facts">
                        <div>
                          <span>Trigger</span>
                          <strong>{state.runDetail.run.triggerKind}</strong>
                        </div>
                        <div>
                          <span>Version</span>
                          <strong>v{state.runDetail.run.workflowVersionNumber ?? "—"}</strong>
                        </div>
                        <div>
                          <span>Execution identity</span>
                          <strong>
                            {state.runDetail.run.runAsRole}
                            {state.runDetail.run.runAsUserId
                              ? ` · ${state.runDetail.run.runAsUserId}`
                              : ""}
                          </strong>
                        </div>
                        <div>
                          <span>Failure reason</span>
                          <strong>{state.runDetail.run.failureReason ?? "None"}</strong>
                        </div>
                      </div>

                      <div className="workflows-change-summary">
                        <h3>Change summary</h3>
                        {state.runDetail.changeSummary.comparedToRunId ? (
                          <>
                            <p>
                              Compared with run <code>{state.runDetail.changeSummary.comparedToRunId}</code>
                            </p>
                            <ul>
                              <li>
                                Workflow version changed: {state.runDetail.changeSummary.workflowVersionChanged ? "Yes" : "No"}
                              </li>
                              <li>Status changed: {state.runDetail.changeSummary.statusChanged ? "Yes" : "No"}</li>
                              <li>
                                Inputs changed: {state.runDetail.changeSummary.inputKeysChanged.join(", ") || "None"}
                              </li>
                              <li>
                                Inputs added: {state.runDetail.changeSummary.inputKeysAdded.join(", ") || "None"}
                              </li>
                              <li>
                                Inputs removed: {state.runDetail.changeSummary.inputKeysRemoved.join(", ") || "None"}
                              </li>
                              <li>
                                Artifact delta: {state.runDetail.changeSummary.artifactCountDelta ?? "n/a"}
                              </li>
                            </ul>
                          </>
                        ) : (
                          <p>No prior run available for comparison.</p>
                        )}
                      </div>

                      <div className="workflows-run-sections">
                        <section>
                          <h3>Alerts</h3>
                          {state.runDetail.alerts.length === 0 ? (
                            <p>No alerts for this run.</p>
                          ) : (
                            <ul className="workflows-inline-list">
                              {state.runDetail.alerts.map((alert) => (
                                <li key={`${alert.source}:${alert.message}`}>
                                  <span className={`workflow-chip ${getToneClass(alert.severity)}`}>
                                    {alert.severity}
                                  </span>
                                  <span>{alert.message}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section>
                          <h3>Resolved inputs</h3>
                          {resolvedInputs.length === 0 ? (
                            <p>No resolved inputs recorded.</p>
                          ) : (
                            <ul className="workflows-inline-list">
                              {resolvedInputs.map((input) => (
                                <li key={input.input_key}>
                                  <strong>{input.input_key}</strong>
                                  <span>{input.documents.length} document(s)</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section>
                          <h3>Validation report</h3>
                          {state.runDetail.inputChecks.length === 0 ? (
                            <p>No validation checks stored for this run.</p>
                          ) : (
                            <div className="workflows-inline-cards">
                              {state.runDetail.inputChecks.map((check) => {
                                const failedMessages = check.report.checks
                                  .filter((entry) => entry.status !== "pass")
                                  .map((entry) => `${entry.code}: ${entry.message}`);

                                return (
                                  <article className="workflows-inline-card" key={check.id}>
                                    <header>
                                      <strong>{check.inputKey}</strong>
                                      <span className={`workflow-chip ${getToneClass(check.status)}`}>
                                        {check.status}
                                      </span>
                                    </header>
                                    {failedMessages.length > 0 ? (
                                      <ul>
                                        {failedMessages.map((message) => (
                                          <li key={message}>{message}</li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p>All checks passed.</p>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        <section>
                          <h3>Input requests</h3>
                          {state.runDetail.inputRequests.length === 0 ? (
                            <p>No input requests were created for this run.</p>
                          ) : (
                            <div className="workflows-table-wrap">
                              <table className="workflows-table workflows-table--compact">
                                <thead>
                                  <tr>
                                    <th>Status</th>
                                    <th>Requested inputs</th>
                                    <th>Sent</th>
                                    <th>Expires</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {state.runDetail.inputRequests.map((request) => (
                                    <tr key={request.id}>
                                      <td>
                                        <span className={`workflow-chip ${getToneClass(request.status)}`}>
                                          {request.status}
                                        </span>
                                      </td>
                                      <td>{request.requestedInputKeys.join(", ") || "—"}</td>
                                      <td>{formatTimestamp(request.sentAt ?? request.createdAt)}</td>
                                      <td>{formatTimestamp(request.expiresAt)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>

                        <section>
                          <h3>Step timeline</h3>
                          {state.runDetail.steps.length === 0 ? (
                            <p>No workflow steps were executed.</p>
                          ) : (
                            <div className="workflows-table-wrap">
                              <table className="workflows-table workflows-table--compact">
                                <thead>
                                  <tr>
                                    <th>Order</th>
                                    <th>Step key</th>
                                    <th>Tool</th>
                                    <th>Status</th>
                                    <th>Duration</th>
                                    <th>Sandbox run</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {state.runDetail.steps.map((step) => (
                                    <tr key={step.id}>
                                      <td>{step.stepOrder + 1}</td>
                                      <td>{step.stepKey}</td>
                                      <td>{step.toolName}</td>
                                      <td>
                                        <span className={`workflow-chip ${getToneClass(step.status)}`}>
                                          {step.status}
                                        </span>
                                      </td>
                                      <td>{formatDuration(step.startedAt, step.completedAt)}</td>
                                      <td>
                                        {step.sandboxRunId ? <code>{step.sandboxRunId}</code> : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>

                        <section>
                          <h3>Generated artifacts</h3>
                          {runArtifacts.length === 0 ? (
                            <p>No artifacts were recorded for this run.</p>
                          ) : (
                            <ul className="workflows-inline-list">
                              {runArtifacts.map((artifact) => (
                                <li key={`${artifact.relative_path}:${artifact.file_name}`}>
                                  <strong>{artifact.file_name}</strong>
                                  <span>{artifact.mime_type}</span>
                                  <span>{formatByteSize(artifact.byte_size)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section>
                          <h3>Delivery attempts</h3>
                          {state.runDetail.deliveries.length === 0 ? (
                            <p>No delivery attempts yet.</p>
                          ) : (
                            <div className="workflows-table-wrap">
                              <table className="workflows-table workflows-table--compact">
                                <thead>
                                  <tr>
                                    <th>Attempt</th>
                                    <th>Channel</th>
                                    <th>Status</th>
                                    <th>Sent</th>
                                    <th>Error</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {state.runDetail.deliveries.map((delivery) => (
                                    <tr key={`${delivery.channelKind}:${delivery.attemptNumber}:${delivery.sentAt ?? 0}`}>
                                      <td>{delivery.attemptNumber}</td>
                                      <td>{delivery.channelKind}</td>
                                      <td>
                                        <span className={`workflow-chip ${getToneClass(delivery.status)}`}>
                                          {delivery.status}
                                        </span>
                                      </td>
                                      <td>{formatTimestamp(delivery.sentAt)}</td>
                                      <td>{delivery.errorMessage ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  ) : (
                    <div className="workflows-empty">Run details unavailable.</div>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
