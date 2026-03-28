"use client";

import { useEffect, useRef, useState } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { useRoleQueryState } from "@/lib/role-query";
import type {
  AuditPromptLog,
  AuditToolCallLog,
  ListAuditLogsResponse,
} from "@/lib/audit-types";
import { getRoleLabel } from "@/lib/roles";

type AuditLogState = {
  error: string | null;
  loading: boolean;
  prompts: AuditPromptLog[];
  refreshing: boolean;
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Still running";
  }

  return DATE_TIME_FORMATTER.format(timestamp);
}

function parseInputFilesFromParameters(toolCall: AuditToolCallLog) {
  if (toolCall.accessedFiles.length > 0) {
    return toolCall.accessedFiles;
  }

  try {
    const parsed = JSON.parse(toolCall.parametersJson) as { inputFiles?: unknown };

    if (!Array.isArray(parsed.inputFiles)) {
      return [];
    }

    return parsed.inputFiles
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getPromptAccessedFiles(prompt: AuditPromptLog) {
  return [...new Set(prompt.toolCalls.flatMap((toolCall) => parseInputFilesFromParameters(toolCall)))];
}

function hasAssistantResponse(prompt: AuditPromptLog) {
  return prompt.traceEvents.some((traceEvent) => traceEvent.kind === "assistant-text");
}

function promptIsActiveOrIncomplete(prompt: AuditPromptLog, now: number) {
  if (
    prompt.toolCalls.some(
      (toolCall) => toolCall.status === "started" || toolCall.completedAt === null,
    )
  ) {
    return true;
  }

  const hasAnyTrace = prompt.traceEvents.length > 0;

  if (!hasAssistantResponse(prompt) && (!hasAnyTrace || prompt.toolCalls.length === 0)) {
    return now - prompt.createdAt < 2 * 60 * 1000;
  }

  return false;
}

function shouldRepoll(prompts: AuditPromptLog[]) {
  const now = Date.now();

  return prompts.some((prompt) => promptIsActiveOrIncomplete(prompt, now));
}

export function AdminLogsPageClient() {
  const { role, setRole } = useRoleQueryState("owner");
  const manualRefreshRequestedRef = useRef(false);
  const repollTimeoutRef = useRef<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<AuditLogState>({
    error: null,
    loading: role === "owner",
    prompts: [],
    refreshing: false,
  });

  useEffect(() => {
    const clearRepoll = () => {
      if (repollTimeoutRef.current !== null) {
        window.clearTimeout(repollTimeoutRef.current);
        repollTimeoutRef.current = null;
      }
    };

    if (role !== "owner") {
      clearRepoll();
      setState({
        error: null,
        loading: false,
        prompts: [],
        refreshing: false,
      });
      return;
    }

    let active = true;

    const loadLogs = async (reason: "initial" | "repoll" | "manual") => {
      clearRepoll();

      setState((current) => ({
        ...current,
        error: null,
        loading: reason === "initial" && current.prompts.length === 0,
        refreshing: reason !== "initial" && current.prompts.length > 0,
      }));

      try {
        const response = await fetch("/api/admin/logs?role=owner&limit=50", {
          cache: "no-store",
        });
        const data = (await response.json()) as ListAuditLogsResponse | { error: string };

        if (!response.ok) {
          throw new Error("error" in data ? data.error : "Failed to load audit logs.");
        }

        if (!active) {
          return;
        }

        const result = data as ListAuditLogsResponse;
        const needsRepoll = shouldRepoll(result.prompts);

        setState({
          error: null,
          loading: false,
          prompts: result.prompts,
          refreshing: false,
        });

        if (needsRepoll) {
          repollTimeoutRef.current = window.setTimeout(() => {
            void loadLogs("repoll");
          }, 5_000);
        }
      } catch (caughtError) {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          error:
            caughtError instanceof Error ? caughtError.message : "Failed to load audit logs.",
          loading: false,
          refreshing: false,
        }));
      }
    };

    const initialReason = manualRefreshRequestedRef.current ? "manual" : "initial";
    manualRefreshRequestedRef.current = false;

    void loadLogs(initialReason);

    return () => {
      active = false;
      clearRepoll();
    };
  }, [role, reloadToken]);

  return (
    <WorkspaceShell activePage="logs" onRoleChange={setRole} role={role}>
      <section className="audit-page">
        <header className="audit-page__header">
          <div>
            <div className="audit-page__eyebrow">Admin</div>
            <h1 className="audit-page__title">Audit Logs</h1>
            <p className="audit-page__copy">
              Review the exact prompts, tool arguments, and execution outcomes from the
              local Critjecture session.
            </p>
          </div>
          {role === "owner" ? (
            <button
              className="audit-refresh-button"
              disabled={state.loading || state.refreshing}
              onClick={() => {
                manualRefreshRequestedRef.current = true;
                setReloadToken((current) => current + 1);
              }}
              type="button"
            >
              {state.refreshing ? "Refreshing..." : "Refresh"}
            </button>
          ) : null}
        </header>

        {role !== "owner" ? (
          <div className="audit-empty audit-empty--blocked">
            <h2>Owner Access Required</h2>
            <p>Select the Owner role to load the audit dashboard.</p>
          </div>
        ) : state.loading ? (
          <div className="audit-empty">
            <p>Loading audit logs...</p>
          </div>
        ) : state.error ? (
          <div className="audit-empty audit-empty--error">
            <h2>Audit Feed Unavailable</h2>
            <p>{state.error}</p>
          </div>
        ) : state.prompts.length === 0 ? (
          <div className="audit-empty">
            <p>No audit entries yet. Run a chat prompt to populate the dashboard.</p>
          </div>
        ) : (
          <div className="audit-list">
            {state.prompts.map((prompt) => {
              const assistantTraceEvents = [...prompt.traceEvents]
                .filter((traceEvent) => traceEvent.kind === "assistant-text")
                .sort((left, right) => left.createdAt - right.createdAt);

              return (
              <details className="audit-card" key={prompt.id}>
                <summary className="audit-card__summary">
                  <div className="audit-card__summary-main">
                    <div className="audit-card__meta">
                      <span className="audit-badge">{getRoleLabel(prompt.role)}</span>
                      <span>{formatTimestamp(prompt.createdAt)}</span>
                    </div>
                    <h2 className="audit-card__title">{prompt.promptText}</h2>
                  </div>

                  <div className="audit-card__summary-side">
                    <div className="audit-card__session">Session {prompt.sessionId}</div>
                    <div className="audit-card__files">
                      {getPromptAccessedFiles(prompt).length > 0 ? (
                        getPromptAccessedFiles(prompt).map((filePath) => (
                          <span className="audit-file-badge" key={filePath}>
                            {filePath}
                          </span>
                        ))
                      ) : (
                        <span className="audit-file-badge audit-file-badge--empty">
                          No data files
                        </span>
                      )}
                    </div>
                  </div>
                </summary>

                <div className="audit-card__body">
                  <section className="audit-trace">
                    <div className="audit-section__header">
                      <h3>Assistant Response</h3>
                      <span>{assistantTraceEvents.length} response event(s)</span>
                    </div>

                    {assistantTraceEvents.length === 0 ? (
                      <div className="audit-tool audit-tool--empty">
                        No assistant response trace was captured for this interaction.
                      </div>
                    ) : (
                      <div className="audit-trace__list">
                        {assistantTraceEvents.map((traceEvent) => (
                            <section className="audit-trace__event" key={traceEvent.id}>
                              <div className="audit-trace__event-header">
                                <div>
                                  <div className="audit-tool__name">{traceEvent.title}</div>
                                  <div className="audit-tool__meta">
                                    <span>{formatTimestamp(traceEvent.createdAt)}</span>
                                  </div>
                                </div>
                              </div>
                              <pre className="audit-tool__code">{traceEvent.content}</pre>
                            </section>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="audit-card__tools">
                    <div className="audit-section__header">
                      <h3>Tool Calls</h3>
                      <span>{prompt.toolCalls.length} tool events</span>
                    </div>

                    {prompt.toolCalls.length === 0 ? (
                      <div className="audit-tool audit-tool--empty">
                        No tool calls were executed for this prompt.
                      </div>
                    ) : (
                      prompt.toolCalls.map((toolCall) => (
                        <section className="audit-tool" key={toolCall.id}>
                          <div className="audit-tool__header">
                            <div>
                              <div className="audit-tool__name">{toolCall.toolName}</div>
                              <div className="audit-tool__meta">
                                <span
                                  className={`audit-status audit-status--${toolCall.status}`}
                                >
                                  {toolCall.status}
                                </span>
                                <span>{formatTimestamp(toolCall.createdAt)}</span>
                                <span>{formatTimestamp(toolCall.completedAt)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="audit-tool__section">
                            <div className="audit-tool__label">Data Files Accessed</div>
                            <div className="audit-card__files">
                              {parseInputFilesFromParameters(toolCall).length > 0 ? (
                                parseInputFilesFromParameters(toolCall).map((filePath) => (
                                  <span className="audit-file-badge" key={filePath}>
                                    {filePath}
                                  </span>
                                ))
                              ) : (
                                <span className="audit-file-badge audit-file-badge--empty">
                                  No data files
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="audit-tool__section">
                            <div className="audit-tool__label">Parameters</div>
                            <pre className="audit-tool__code">{toolCall.parametersJson}</pre>
                          </div>

                          {toolCall.resultSummary ? (
                            <div className="audit-tool__section">
                              <div className="audit-tool__label">Result Summary</div>
                              <p className="audit-tool__summary">{toolCall.resultSummary}</p>
                            </div>
                          ) : null}

                          {toolCall.errorMessage ? (
                            <div className="audit-tool__section">
                              <div className="audit-tool__label">Error</div>
                              <p className="audit-tool__summary audit-tool__summary--error">
                                {toolCall.errorMessage}
                              </p>
                            </div>
                          ) : null}
                        </section>
                      ))
                    )}
                  </section>
                </div>
              </details>
              );
            })}
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
