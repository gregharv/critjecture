"use client";

import { useEffect, useState } from "react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { useRoleQueryState } from "@/lib/role-query";
import type { AuditPromptLog, ListAuditLogsResponse } from "@/lib/audit-types";

type AuditLogState = {
  error: string | null;
  loading: boolean;
  prompts: AuditPromptLog[];
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

export function AdminLogsPageClient() {
  const { role, setRole } = useRoleQueryState("owner");
  const [state, setState] = useState<AuditLogState>({
    error: null,
    loading: role === "owner",
    prompts: [],
  });

  useEffect(() => {
    if (role !== "owner") {
      setState({
        error: null,
        loading: false,
        prompts: [],
      });
      return;
    }

    let active = true;

    const loadLogs = async () => {
      setState((current) => ({
        ...current,
        error: null,
        loading: current.prompts.length === 0,
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

        setState({
          error: null,
          loading: false,
          prompts: result.prompts,
        });
      } catch (caughtError) {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          error:
            caughtError instanceof Error ? caughtError.message : "Failed to load audit logs.",
          loading: false,
        }));
      }
    };

    void loadLogs();

    const intervalId = window.setInterval(() => {
      void loadLogs();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [role]);

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
            {state.prompts.map((prompt) => (
              <article className="audit-card" key={prompt.id}>
                <div className="audit-card__header">
                  <div>
                    <div className="audit-card__meta">
                      <span className="audit-badge">{prompt.role}</span>
                      <span>{formatTimestamp(prompt.createdAt)}</span>
                    </div>
                    <h2 className="audit-card__title">{prompt.promptText}</h2>
                  </div>
                  <div className="audit-card__session">Session {prompt.sessionId}</div>
                </div>

                <div className="audit-card__tools">
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
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
