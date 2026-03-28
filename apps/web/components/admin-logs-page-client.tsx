"use client";

import { useEffect, useRef, useState } from "react";

import type {
  AuditPromptLog,
  AuditToolCallLog,
  AuditTraceEventLog,
  ListAuditLogsResponse,
} from "@/lib/audit-types";
import { getRoleLabel } from "@/lib/roles";

type AuditLogState = {
  error: string | null;
  loading: boolean;
  prompts: AuditPromptLog[];
  refreshing: boolean;
};

type AuditTimelineFilter = "all" | "assistant" | "tools";

type AuditTimelineEvent =
  | {
      content: string;
      createdAt: number;
      eventType: "assistant";
      id: string;
      title: string;
    }
  | {
      createdAt: number;
      eventType: "tool";
      id: string;
      toolCall: AuditToolCallLog;
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

function buildAuditTimelineEvents(prompt: AuditPromptLog): AuditTimelineEvent[] {
  const assistantEvents = prompt.traceEvents
    .filter(
      (traceEvent): traceEvent is AuditTraceEventLog =>
        traceEvent.kind === "assistant-text",
    )
    .map<AuditTimelineEvent>((traceEvent) => ({
      content: traceEvent.content,
      createdAt: traceEvent.createdAt,
      eventType: "assistant",
      id: traceEvent.id,
      title: traceEvent.title || "Assistant Response",
    }));

  const toolEvents = prompt.toolCalls.map<AuditTimelineEvent>((toolCall) => ({
    createdAt: toolCall.createdAt,
    eventType: "tool",
    id: toolCall.id,
    toolCall,
  }));

  return [...assistantEvents, ...toolEvents].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return left.id.localeCompare(right.id);
    }

    return left.createdAt - right.createdAt;
  });
}

function filterTimelineEvents(
  events: AuditTimelineEvent[],
  filter: AuditTimelineFilter,
) {
  if (filter === "assistant") {
    return events.filter((event) => event.eventType === "assistant");
  }

  if (filter === "tools") {
    return events.filter((event) => event.eventType === "tool");
  }

  return events;
}

function getTimelineCountLabel(visibleCount: number, totalCount: number) {
  if (visibleCount === totalCount) {
    return `${totalCount} event(s)`;
  }

  return `${visibleCount} of ${totalCount} event(s)`;
}

function getTimelineEmptyMessage(filter: AuditTimelineFilter) {
  if (filter === "assistant") {
    return "No assistant responses were captured for this interaction.";
  }

  if (filter === "tools") {
    return "No tool calls were executed for this prompt.";
  }

  return "No timeline events were captured for this interaction.";
}

function AuditPromptCard({ prompt }: { prompt: AuditPromptLog }) {
  const [filter, setFilter] = useState<AuditTimelineFilter>("all");
  const promptAccessedFiles = getPromptAccessedFiles(prompt);
  const timelineEvents = buildAuditTimelineEvents(prompt);
  const visibleTimelineEvents = filterTimelineEvents(timelineEvents, filter);
  const userLabel = prompt.userName || prompt.userEmail || "Unknown User";

  return (
    <details className="audit-card">
      <summary className="audit-card__summary">
        <div className="audit-card__summary-main">
          <div className="audit-card__meta">
            <span className="audit-badge">{getRoleLabel(prompt.role)}</span>
            <span>{formatTimestamp(prompt.createdAt)}</span>
          </div>
          <h2 className="audit-card__title">{prompt.promptText}</h2>
        </div>

        <div className="audit-card__summary-side">
          <div className="audit-card__session">{userLabel}</div>
          <div className="audit-card__session">Chat Session {prompt.chatSessionId}</div>
          <div className="audit-card__files">
            {promptAccessedFiles.length > 0 ? (
              promptAccessedFiles.map((filePath) => (
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
        <section className="audit-timeline">
          <div className="audit-section__header audit-section__header--timeline">
            <h3>Timeline</h3>
            <div className="audit-section__header-actions">
              <span>{getTimelineCountLabel(visibleTimelineEvents.length, timelineEvents.length)}</span>
              <div
                aria-label="Filter audit timeline"
                className="audit-filter"
                role="group"
              >
                <button
                  aria-pressed={filter === "all"}
                  className={`audit-filter__button${filter === "all" ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter("all");
                  }}
                  type="button"
                >
                  All
                </button>
                <button
                  aria-pressed={filter === "assistant"}
                  className={`audit-filter__button${filter === "assistant" ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter("assistant");
                  }}
                  type="button"
                >
                  Assistant
                </button>
                <button
                  aria-pressed={filter === "tools"}
                  className={`audit-filter__button${filter === "tools" ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter("tools");
                  }}
                  type="button"
                >
                  Tools
                </button>
              </div>
            </div>
          </div>

          {visibleTimelineEvents.length === 0 ? (
            <div className="audit-tool audit-tool--empty">{getTimelineEmptyMessage(filter)}</div>
          ) : (
            <div className="audit-timeline__list">
              {visibleTimelineEvents.map((event) =>
                event.eventType === "assistant" ? (
                  <section
                    className="audit-timeline__item audit-timeline__item--assistant"
                    key={event.id}
                  >
                    <div className="audit-timeline__item-header">
                      <div>
                        <div className="audit-timeline__heading-row">
                          <span className="audit-badge audit-badge--trace">Assistant</span>
                          <div className="audit-tool__name">{event.title}</div>
                        </div>
                        <div className="audit-tool__meta">
                          <span>{formatTimestamp(event.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <pre className="audit-tool__code">{event.content}</pre>
                  </section>
                ) : (
                  <section
                    className="audit-timeline__item audit-timeline__item--tool"
                    key={event.id}
                  >
                    <div className="audit-timeline__item-header">
                      <div>
                        <div className="audit-timeline__heading-row">
                          <span className="audit-badge audit-badge--trace">Tool</span>
                          <div className="audit-tool__name">{event.toolCall.toolName}</div>
                        </div>
                        <div className="audit-tool__meta">
                          <span
                            className={`audit-status audit-status--${event.toolCall.status}`}
                          >
                            {event.toolCall.status}
                          </span>
                          <span>{formatTimestamp(event.toolCall.createdAt)}</span>
                          <span>{formatTimestamp(event.toolCall.completedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="audit-tool__section">
                      <div className="audit-tool__label">Data Files Accessed</div>
                      <div className="audit-card__files">
                        {parseInputFilesFromParameters(event.toolCall).length > 0 ? (
                          parseInputFilesFromParameters(event.toolCall).map((filePath) => (
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
                      <pre className="audit-tool__code">{event.toolCall.parametersJson}</pre>
                    </div>

                    {event.toolCall.resultSummary ? (
                      <div className="audit-tool__section">
                        <div className="audit-tool__label">Result Summary</div>
                        <p className="audit-tool__summary">{event.toolCall.resultSummary}</p>
                      </div>
                    ) : null}

                    {event.toolCall.errorMessage ? (
                      <div className="audit-tool__section">
                        <div className="audit-tool__label">Error</div>
                        <p className="audit-tool__summary audit-tool__summary--error">
                          {event.toolCall.errorMessage}
                        </p>
                      </div>
                    ) : null}
                  </section>
                ),
              )}
            </div>
          )}
        </section>
      </div>
    </details>
  );
}

export function AdminLogsPageClient() {
  const manualRefreshRequestedRef = useRef(false);
  const repollTimeoutRef = useRef<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<AuditLogState>({
    error: null,
    loading: true,
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
        const response = await fetch("/api/admin/logs?limit=50", {
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
  }, [reloadToken]);

  return (
    <section className="audit-page">
      <header className="audit-page__header">
        <div>
          <div className="audit-page__eyebrow">Admin</div>
          <h1 className="audit-page__title">Audit Logs</h1>
          <p className="audit-page__copy">
            Review the exact prompts, tool arguments, execution outcomes, and initiating
            user for each authenticated Critjecture session.
          </p>
        </div>
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
      </header>

      {state.loading ? (
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
            <AuditPromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      )}
    </section>
  );
}
