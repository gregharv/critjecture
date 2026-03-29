"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ChatTurnLog,
  ListChatTurnLogsResponse,
  ToolCallLog,
} from "@/lib/audit-types";
import { getRoleLabel } from "@/lib/roles";

type AuditLogState = {
  error: string | null;
  loading: boolean;
  turns: ChatTurnLog[];
  refreshing: boolean;
};

type AuditTimelineFilter = "all" | "assistant" | "tools";

type AuditTimelineEvent =
  | {
      content: string;
      createdAt: number;
      eventType: "assistant";
      id: string;
      messageType: ChatTurnLog["assistantMessages"][number]["messageType"];
      modelName: string;
      title: string;
    }
  | {
      createdAt: number;
      eventType: "tool";
      id: string;
      toolCall: ToolCallLog;
    };

const PYTHON_TOOL_NAMES = new Set([
  "run_data_analysis",
  "generate_visual_graph",
  "generate_document",
]);

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

function formatMiB(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

function getAssistantMessageLabel(
  turn: ChatTurnLog,
  messageId: string,
  messageType: ChatTurnLog["assistantMessages"][number]["messageType"],
) {
  if (messageType === "planner-selection") {
    return "Planner Selection";
  }

  const citationCount = turn.responseCitations.filter(
    (citation) => citation.assistantMessageId === messageId,
  ).length;

  return citationCount > 0
    ? `Final Response (${citationCount} citation${citationCount === 1 ? "" : "s"})`
    : "Final Response";
}

function getAssistantMessageTypeLabel(
  messageType: ChatTurnLog["assistantMessages"][number]["messageType"],
) {
  return messageType === "planner-selection" ? "Planner Selection" : "Assistant Response";
}

function parseToolParameters(toolCall: ToolCallLog) {
  try {
    const parsed = JSON.parse(toolCall.toolParametersJson) as Record<string, unknown>;

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function parseInputFilesFromToolParameters(toolCall: ToolCallLog) {
  if (toolCall.accessedFiles.length > 0) {
    return toolCall.accessedFiles;
  }

  const parsed = parseToolParameters(toolCall);

  if (!parsed || !Array.isArray(parsed.inputFiles)) {
    return [];
  }

  return parsed.inputFiles
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function getTurnAccessedFiles(turn: ChatTurnLog) {
  return [...new Set(turn.toolCalls.flatMap((toolCall) => parseInputFilesFromToolParameters(toolCall)))];
}

function getToolParameterDisplay(toolCall: ToolCallLog) {
  const parsed = parseToolParameters(toolCall);

  if (!parsed) {
    return {
      code: "",
      remainingParametersJson: toolCall.toolParametersJson,
    };
  }

  const nextParameters = { ...parsed };
  const code =
    PYTHON_TOOL_NAMES.has(toolCall.toolName) && typeof nextParameters.code === "string"
      ? nextParameters.code.trim()
      : "";

  if (code) {
    delete nextParameters.code;
  }

  return {
    code,
    remainingParametersJson: JSON.stringify(nextParameters, null, 2),
  };
}

function hasAssistantMessage(turn: ChatTurnLog) {
  return turn.assistantMessages.length > 0;
}

function turnIsActiveOrIncomplete(turn: ChatTurnLog, now: number) {
  if (turn.status === "started" || turn.completedAt === null) {
    return true;
  }

  if (
    turn.toolCalls.some(
      (toolCall) => toolCall.status === "started" || toolCall.completedAt === null,
    )
  ) {
    return true;
  }

  const hasAnyAssistantMessages = turn.assistantMessages.length > 0;

  if (!hasAssistantMessage(turn) && (!hasAnyAssistantMessages || turn.toolCalls.length === 0)) {
    return now - turn.createdAt < 2 * 60 * 1000;
  }

  return false;
}

function shouldRepoll(turns: ChatTurnLog[]) {
  const now = Date.now();

  return turns.some((turn) => turnIsActiveOrIncomplete(turn, now));
}

function buildAuditTimelineEvents(turn: ChatTurnLog): AuditTimelineEvent[] {
  const assistantEvents = turn.assistantMessages.map<AuditTimelineEvent>((assistantMessage) => ({
    content: assistantMessage.messageText,
    createdAt: assistantMessage.createdAt,
    eventType: "assistant",
    id: assistantMessage.id,
    messageType: assistantMessage.messageType,
    modelName: assistantMessage.modelName,
    title: getAssistantMessageLabel(turn, assistantMessage.id, assistantMessage.messageType),
  }));

  const toolEvents = turn.toolCalls.map<AuditTimelineEvent>((toolCall) => ({
    createdAt: toolCall.startedAt,
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
    return "No tool calls were executed for this chat turn.";
  }

  return "No timeline events were captured for this interaction.";
}

function ToolTimelineEvent({ toolCall }: { toolCall: ToolCallLog }) {
  const inputFiles = parseInputFilesFromToolParameters(toolCall);
  const parameterDisplay = getToolParameterDisplay(toolCall);
  const remainingParameters = parameterDisplay.remainingParametersJson.trim();
  const hasRemainingParameters =
    remainingParameters.length > 0 && remainingParameters !== "{}";

  return (
    <section className="audit-timeline__item audit-timeline__item--tool">
      <div className="audit-timeline__item-header">
        <div>
          <div className="audit-timeline__heading-row">
            <span className="audit-badge audit-badge--trace">Tool</span>
            <div className="audit-tool__name">{toolCall.toolName}</div>
          </div>
          <div className="audit-tool__meta">
            <span className={`audit-status audit-status--${toolCall.status}`}>
              {toolCall.status}
            </span>
            <span>{formatTimestamp(toolCall.startedAt)}</span>
            <span>{formatTimestamp(toolCall.completedAt)}</span>
          </div>
        </div>
      </div>

      <div className="audit-tool__section">
        <div className="audit-tool__label">Data Files Accessed</div>
        <div className="audit-card__files">
          {inputFiles.length > 0 ? (
            inputFiles.map((filePath) => (
              <span className="audit-file-badge" key={filePath}>
                {filePath}
              </span>
            ))
          ) : (
            <span className="audit-file-badge audit-file-badge--empty">No data files</span>
          )}
        </div>
      </div>

      {toolCall.sandboxRun ? (
        <div className="audit-tool__section">
          <div className="audit-tool__label">Sandbox Run</div>
          <pre className="audit-tool__code">{JSON.stringify({
            runId: toolCall.sandboxRun.runId,
            runner: toolCall.sandboxRun.runner,
            status: toolCall.sandboxRun.status,
            failureReason: toolCall.sandboxRun.failureReason,
            cleanupStatus: toolCall.sandboxRun.cleanupStatus,
            cleanupCompletedAt: toolCall.sandboxRun.cleanupCompletedAt
              ? formatTimestamp(toolCall.sandboxRun.cleanupCompletedAt)
              : null,
            limits: {
              timeoutMs: toolCall.sandboxRun.timeoutMs,
              cpuLimitSeconds: toolCall.sandboxRun.cpuLimitSeconds,
              memoryLimit: formatMiB(toolCall.sandboxRun.memoryLimitBytes),
              maxProcesses: toolCall.sandboxRun.maxProcesses,
              stdoutMaxBytes: toolCall.sandboxRun.stdoutMaxBytes,
              artifactMaxBytes: toolCall.sandboxRun.artifactMaxBytes,
              artifactTtlMs: toolCall.sandboxRun.artifactTtlMs,
            },
            generatedAssets: toolCall.sandboxRun.generatedAssets.map((asset) => ({
              relativePath: asset.relativePath,
              mimeType: asset.mimeType,
              byteSize: asset.byteSize,
              expiresAt: formatTimestamp(asset.expiresAt),
            })),
          }, null, 2)}</pre>
        </div>
      ) : null}

      {parameterDisplay.code ? (
        <div className="audit-tool__section">
          <div className="audit-tool__label">Python Code</div>
          <pre className="audit-tool__code audit-tool__code--python">
            {parameterDisplay.code}
          </pre>
        </div>
      ) : null}

      {hasRemainingParameters ? (
        <div className="audit-tool__section">
          <div className="audit-tool__label">
            {parameterDisplay.code ? "Other Parameters" : "Parameters"}
          </div>
          <pre className="audit-tool__code">{remainingParameters}</pre>
        </div>
      ) : null}

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
  );
}

function ChatTurnCard({ turn }: { turn: ChatTurnLog }) {
  const [filter, setFilter] = useState<AuditTimelineFilter>("all");
  const turnAccessedFiles = getTurnAccessedFiles(turn);
  const timelineEvents = buildAuditTimelineEvents(turn);
  const visibleTimelineEvents = filterTimelineEvents(timelineEvents, filter);
  const userLabel = turn.userName || turn.userEmail || "Unknown User";

  return (
    <details className="audit-card">
      <summary className="audit-card__summary">
        <div className="audit-card__summary-main">
          <div className="audit-card__meta">
            <span className="audit-badge">{getRoleLabel(turn.userRole)}</span>
            <span className={`audit-status audit-status--${turn.status}`}>
              {turn.status}
            </span>
            <span>{formatTimestamp(turn.createdAt)}</span>
          </div>
          <h2 className="audit-card__title">{turn.userPromptText}</h2>
        </div>

        <div className="audit-card__summary-side">
          <div className="audit-card__session">{userLabel}</div>
          <div className="audit-card__session">Chat Session {turn.chatSessionId}</div>
          <div className="audit-card__session">Completed {formatTimestamp(turn.completedAt)}</div>
          <div className="audit-card__files">
            {turnAccessedFiles.length > 0 ? (
              turnAccessedFiles.map((filePath) => (
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
                          <span>{getAssistantMessageTypeLabel(event.messageType)}</span>
                          <span>{event.modelName}</span>
                          <span>{formatTimestamp(event.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <pre className="audit-tool__code">{event.content}</pre>
                  </section>
                ) : (
                  <ToolTimelineEvent key={event.id} toolCall={event.toolCall} />
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
    turns: [],
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
        loading: reason === "initial" && current.turns.length === 0,
        refreshing: reason !== "initial" && current.turns.length > 0,
      }));

      try {
        const response = await fetch("/api/admin/logs?limit=50", {
          cache: "no-store",
        });
        const data = (await response.json()) as ListChatTurnLogsResponse | { error: string };

        if (!response.ok) {
          throw new Error("error" in data ? data.error : "Failed to load audit logs.");
        }

        if (!active) {
          return;
        }

        const result = data as ListChatTurnLogsResponse;
        const needsRepoll = shouldRepoll(result.turns);

        setState({
          error: null,
          loading: false,
          turns: result.turns,
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
            Review exact chat turns, lifecycle state, tool arguments, execution outcomes, and initiating
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
      ) : state.turns.length === 0 ? (
        <div className="audit-empty">
          <p>No audit entries yet. Run a chat turn to populate the dashboard.</p>
        </div>
      ) : (
        <div className="audit-list">
          {state.turns.map((turn) => (
            <ChatTurnCard key={turn.id} turn={turn} />
          ))}
        </div>
      )}
    </section>
  );
}
