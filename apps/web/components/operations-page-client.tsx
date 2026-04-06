"use client";

import { useEffect, useMemo, useState } from "react";

import type { OperationsSummaryResponse } from "@/lib/operations-types";

type OperationsState = {
  error: string | null;
  loading: boolean;
  summary: OperationsSummaryResponse | null;
};

type RecentFailure = OperationsSummaryResponse["recentFailures"][number];

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: number) {
  return DATE_TIME_FORMATTER.format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCredits(value: number) {
  return `${formatInteger(value)} cr`;
}

function getHealthTone(status: OperationsSummaryResponse["health"]["status"]) {
  if (status === "ok") {
    return "ok";
  }

  if (status === "degraded") {
    return "warning";
  }

  return "critical";
}

function getToneFromCheckStatus(
  status: OperationsSummaryResponse["health"]["checks"][number]["status"] | undefined,
) {
  if (status === "fail") {
    return "critical";
  }

  if (status === "degraded") {
    return "warning";
  }

  return "ok";
}

function getToneLabel(tone: "ok" | "warning" | "critical") {
  if (tone === "ok") {
    return "OK";
  }

  if (tone === "warning") {
    return "Degraded";
  }

  return "Needs attention";
}

function getFailureActionLabel(failure: RecentFailure) {
  switch (failure.routeKey) {
    case "data-analysis.run":
      return "generate a chart";
    case "visual-graph.run":
      return "generate a visual graph";
    case "document.generate":
      return "generate a document";
    case "chat.stream":
      return "generate a chat response";
    case "company-knowledge.search":
      return "search company knowledge";
    case "brave.search":
      return "search the web";
    case "brave.grounding":
      return "run grounded web research";
    case "knowledge.files.upload_async":
      return "upload a knowledge file";
    case "knowledge.import_jobs.create":
    case "knowledge.import_jobs.retry":
    case "knowledge.import_jobs.worker":
      return "process a knowledge import";
    case "governance.jobs.create":
    case "governance.jobs.list":
    case "governance.jobs.detail":
    case "governance.jobs.download":
      return "run a governance export task";
    default:
      break;
  }

  switch (failure.routeGroup) {
    case "chat":
      return "process a chat request";
    case "sandbox":
      return "run analysis";
    case "search":
      return "run a search request";
    case "knowledge_upload":
      return "upload knowledge content";
    case "knowledge_import":
      return "process imported knowledge";
    case "governance":
      return "run a governance request";
    case "admin":
      return "load an admin request";
    case "health":
      return "run a health check";
    default:
      return "process a request";
  }
}

function getFailureHeadline(failure: RecentFailure) {
  const actor = failure.userEmail?.trim() ? failure.userEmail.trim() : "an unknown user";
  const action = getFailureActionLabel(failure);

  if (failure.statusCode === 429) {
    return `Rate limit hit while trying to ${action} for ${actor}.`;
  }

  return `Failed to ${action} for ${actor}.`;
}

export function OperationsPageClient() {
  const [window, setWindow] = useState<"24h" | "7d">("24h");
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);
  const [state, setState] = useState<OperationsState>({
    error: null,
    loading: true,
    summary: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState((current) => ({
        ...current,
        error: null,
        loading: current.summary === null,
      }));

      try {
        const response = await fetch(`/api/admin/operations/summary?window=${window}`, {
          cache: "no-store",
        });
        const data =
          (await response.json()) as OperationsSummaryResponse | { error: string };

        if (!response.ok) {
          throw new Error("error" in data ? data.error : "Failed to load operations summary.");
        }

        if (!cancelled) {
          setState({
            error: null,
            loading: false,
            summary: data as OperationsSummaryResponse,
          });
        }
      } catch (caughtError) {
        if (!cancelled) {
          setState((current) => ({
            error:
              caughtError instanceof Error
                ? caughtError.message
                : "Failed to load operations summary.",
            loading: false,
            summary: current.summary,
          }));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [window]);

  const summary = state.summary;
  const headlineMetrics = useMemo(() => {
    if (!summary) {
      return {
        creditsUsed: 0,
        costUsd: 0,
        openAlerts: 0,
        rateLimited: 0,
        remainingCredits: 0,
        requests: 0,
        sandboxRuns: 0,
        totalTokens: 0,
      };
    }

    return {
      creditsUsed: summary.workspace.usedCredits,
      costUsd: summary.usageSummary.byEventType.reduce((sum, item) => sum + item.costUsd, 0),
      openAlerts: summary.alerts.length,
      rateLimited: summary.routeMetrics.reduce(
        (sum, item) => sum + item.rateLimitedCount,
        0,
      ),
      remainingCredits: summary.workspace.remainingCredits,
      requests: summary.routeMetrics.reduce((sum, item) => sum + item.requestCount, 0),
      sandboxRuns: summary.usageSummary.byEventType
        .filter((item) => item.eventType === "sandbox_run")
        .reduce((sum, item) => sum + item.quantity, 0),
      totalTokens: summary.usageSummary.byEventType.reduce(
        (sum, item) => sum + item.totalTokens,
        0,
      ),
    };
  }, [summary]);

  const systemHealthCards = useMemo(() => {
    if (!summary) {
      return [];
    }

    const databaseCheck = summary.health.checks.find((check) => check.name === "database");
    const persistenceCheck = summary.health.checks.find((check) => check.name === "persistence");
    const sandboxCheck = summary.health.checks.find((check) => check.name === "sandbox");

    const databaseTone =
      databaseCheck?.status === "fail" || persistenceCheck?.status === "fail"
        ? "critical"
        : databaseCheck?.status === "degraded" || persistenceCheck?.status === "degraded"
          ? "warning"
          : "ok";
    const analysisTone = getToneFromCheckStatus(sandboxCheck?.status);
    const sandbox = summary.health.sandbox;

    return [
      {
        detail:
          databaseTone === "ok"
            ? "Database and storage are responding normally."
            : "Database reliability needs attention. Open Advanced Diagnostics for technical details.",
        key: "database",
        label: getToneLabel(databaseTone),
        name: "Database",
        tone: databaseTone,
      },
      {
        detail:
          analysisTone === "critical"
            ? "Analysis engine is unavailable. Open Advanced Diagnostics for recovery details."
            : analysisTone === "warning"
              ? `Analysis engine has delays (${formatInteger(sandbox?.queuedRuns ?? 0)} queued, ${formatInteger(sandbox?.staleRuns ?? 0)} stale).`
              : "Analysis engine is available.",
        key: "analysis-engine",
        label: getToneLabel(analysisTone),
        name: "Analysis Engine",
        tone: analysisTone,
      },
    ];
  }, [summary]);

  return (
    <section className="operations-page">
      <header className="operations-hero">
        <div>
          <div className="operations-hero__eyebrow">Admin</div>
          <h1 className="operations-hero__title">Operations</h1>
          <p className="operations-hero__copy">
            Health, credit usage, rate limits, and recent failures for the current workspace.
          </p>
        </div>
        <div className="operations-window-switch" role="tablist" aria-label="Summary window">
          <button
            className={`operations-window-switch__button${window === "24h" ? " is-active" : ""}`}
            onClick={() => setWindow("24h")}
            type="button"
          >
            24h
          </button>
          <button
            className={`operations-window-switch__button${window === "7d" ? " is-active" : ""}`}
            onClick={() => setWindow("7d")}
            type="button"
          >
            7d
          </button>
        </div>
      </header>

      {state.loading && !summary ? (
        <div className="operations-empty">
          <p>Loading operations summary...</p>
        </div>
      ) : state.error && !summary ? (
        <div className="operations-empty operations-empty--error">
          <h2>Operations Unavailable</h2>
          <p>{state.error}</p>
        </div>
      ) : summary ? (
        <div className="operations-grid">
          <section className="operations-panel operations-panel--headline">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Current Status</div>
                <h2>System Snapshot</h2>
              </div>
              <span
                className={`operations-status operations-status--${getHealthTone(summary.health.status)}`}
              >
                {summary.health.status}
              </span>
            </div>
            <div className="operations-metrics">
              <article className="operations-metric">
                <span className="operations-metric__label">Requests</span>
                <strong>{formatInteger(headlineMetrics.requests)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Credits Used</span>
                <strong>{formatCredits(headlineMetrics.creditsUsed)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Credits Left</span>
                <strong>{formatCredits(headlineMetrics.remainingCredits)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Sandbox Runs</span>
                <strong>{formatInteger(headlineMetrics.sandboxRuns)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Internal Cost</span>
                <strong>{formatUsd(headlineMetrics.costUsd)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Open Alerts</span>
                <strong>{formatInteger(headlineMetrics.openAlerts)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">429s</span>
                <strong>{formatInteger(headlineMetrics.rateLimited)}</strong>
              </article>
            </div>
            {state.error ? <p className="operations-inline-error">{state.error}</p> : null}
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Workspace Plan</div>
                <h2>{summary.workspace.planName}</h2>
              </div>
              <span
                className={`operations-status operations-status--${summary.workspace.exhausted ? "critical" : "ok"}`}
              >
                {summary.workspace.planCode}
              </span>
            </div>
            <div className="operations-metrics">
              <article className="operations-metric">
                <span className="operations-metric__label">Included</span>
                <strong>{formatCredits(summary.workspace.monthlyIncludedCredits)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Used</span>
                <strong>{formatCredits(summary.workspace.usedCredits)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Pending</span>
                <strong>{formatCredits(summary.workspace.pendingCredits)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Remaining</span>
                <strong>{formatCredits(summary.workspace.remainingCredits)}</strong>
              </article>
            </div>
            <p>Hard cap: {summary.workspace.hardCapBehavior}. Resets {formatTimestamp(summary.workspace.resetAt)}.</p>
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Health Checks</div>
                <h2>Route Readiness</h2>
              </div>
              <span className="operations-panel__meta">
                {DATE_TIME_FORMATTER.format(new Date(summary.health.timestamp))}
              </span>
            </div>
            <div className="operations-health-list">
              {summary.health.checks.map((check) => (
                <article className="operations-health-item" key={check.name}>
                  <div className="operations-health-item__header">
                    <strong>{check.name}</strong>
                    <span
                      className={`operations-status operations-status--${getHealthTone(check.status)}`}
                    >
                      {check.status}
                    </span>
                  </div>
                  <p>{check.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">System Health</div>
                <h2>Owner-Friendly Status</h2>
              </div>
              <span className="operations-panel__meta">
                {DATE_TIME_FORMATTER.format(new Date(summary.health.timestamp))}
              </span>
            </div>
            <div className="operations-health-list">
              {systemHealthCards.map((card) => (
                <article className="operations-health-item" key={card.key}>
                  <div className="operations-health-item__header">
                    <strong>{card.name}</strong>
                    <span className={`operations-status operations-status--${card.tone}`}>
                      {card.label}
                    </span>
                  </div>
                  <p>{card.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="operations-panel operations-panel--wide">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Advanced Diagnostics</div>
                <h2>Infrastructure Details</h2>
              </div>
            </div>
            <p className="operations-panel__meta">
              Includes sandbox supervisor and persistence internals for support troubleshooting.
            </p>
            <button
              aria-expanded={showAdvancedDiagnostics}
              className="operations-advanced-toggle"
              onClick={() => setShowAdvancedDiagnostics((current) => !current)}
              type="button"
            >
              {showAdvancedDiagnostics ? "Hide Advanced Diagnostics" : "Show Advanced Diagnostics"}
            </button>
          </section>

          {showAdvancedDiagnostics ? (
            <>
              <section className="operations-panel">
                <div className="operations-panel__header">
                  <div>
                    <div className="operations-panel__eyebrow">Sandbox Supervisor</div>
                    <h2>Capacity and Recovery</h2>
                  </div>
                  <span
                    className={`operations-status operations-status--${summary.health.sandbox.available ? "ok" : "critical"}`}
                  >
                    {summary.health.sandbox.backend}
                  </span>
                </div>
                <div className="operations-metrics">
                  <article className="operations-metric">
                    <span className="operations-metric__label">Active</span>
                    <strong>{formatInteger(summary.health.sandbox.activeRuns)}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Queued</span>
                    <strong>{formatInteger(summary.health.sandbox.queuedRuns)}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Rejected</span>
                    <strong>{formatInteger(summary.health.sandbox.rejectedRuns)}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Abandoned</span>
                    <strong>{formatInteger(summary.health.sandbox.abandonedRuns)}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Stale</span>
                    <strong>{formatInteger(summary.health.sandbox.staleRuns)}</strong>
                  </article>
                </div>
                <p>{summary.health.sandbox.detail}</p>
                <div className="operations-health-list">
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Auth mode</strong>
                      <span className="operations-panel__meta">{summary.health.sandbox.authMode}</span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Bound organization</strong>
                      <span className="operations-panel__meta">
                        {summary.health.sandbox.boundOrganizationSlug ?? "n/a"}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Runner</strong>
                      <span className="operations-panel__meta">
                        {summary.health.sandbox.runner ?? "unknown"}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Last reconciliation</strong>
                      <span className="operations-panel__meta">
                        {summary.health.sandbox.lastReconciledAt
                          ? formatTimestamp(summary.health.sandbox.lastReconciledAt)
                          : "Never"}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Last heartbeat</strong>
                      <span className="operations-panel__meta">
                        {summary.health.sandbox.lastHeartbeatAt
                          ? formatTimestamp(summary.health.sandbox.lastHeartbeatAt)
                          : "Never"}
                      </span>
                    </div>
                  </article>
                </div>
              </section>

              <section className="operations-panel">
                <div className="operations-panel__header">
                  <div>
                    <div className="operations-panel__eyebrow">Persistence Envelope</div>
                    <h2>SQLite and Recovery</h2>
                  </div>
                  <span className="operations-panel__meta">
                    {summary.health.persistence.deploymentMode}
                  </span>
                </div>
                <div className="operations-metrics">
                  <article className="operations-metric">
                    <span className="operations-metric__label">Engine</span>
                    <strong>{summary.health.persistence.engine}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Journal</span>
                    <strong>{summary.health.persistence.journalMode.toUpperCase()}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Writable app instances</span>
                    <strong>{formatInteger(summary.health.persistence.writableAppInstances)}</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Target RPO</span>
                    <strong>{formatInteger(summary.health.persistence.targetRpoHours)}h</strong>
                  </article>
                  <article className="operations-metric">
                    <span className="operations-metric__label">Target RTO</span>
                    <strong>{formatInteger(summary.health.persistence.targetRtoHours)}h</strong>
                  </article>
                </div>
                <div className="operations-health-list">
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Topology</strong>
                      <span className="operations-panel__meta">
                        {summary.health.persistence.topology}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Request model</strong>
                      <span className="operations-panel__meta">
                        {summary.health.persistence.requestModel}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Database path</strong>
                      <span className="operations-panel__meta">
                        {summary.health.persistence.databasePath}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Storage root</strong>
                      <span className="operations-panel__meta">
                        {summary.health.persistence.storageRoot}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Backup cadence</strong>
                      <span className="operations-panel__meta">
                        every {formatInteger(summary.health.persistence.backupCadenceHours)}h
                      </span>
                    </div>
                    <p>
                      {summary.health.persistence.backupBeforeSchemaChanges
                        ? "Take an additional backup before schema or storage-layout changes."
                        : "No extra schema-change backup requirement recorded."}
                    </p>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Restore drill cadence</strong>
                      <span className="operations-panel__meta">
                        {summary.health.persistence.restoreDrillCadence}
                      </span>
                    </div>
                  </article>
                  <article className="operations-health-item">
                    <div className="operations-health-item__header">
                      <strong>Sandbox concurrency envelope</strong>
                      <span className="operations-panel__meta">
                        {formatInteger(summary.health.persistence.sandboxConcurrency.perUserActiveRuns)}
                        {" / "}
                        {formatInteger(summary.health.persistence.sandboxConcurrency.globalActiveRuns)}
                      </span>
                    </div>
                    <p>Per-user active runs / global active runs.</p>
                  </article>
                </div>
              </section>
            </>
          ) : null}

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Open Alerts</div>
                <h2>Warnings and Incidents</h2>
              </div>
            </div>
            {summary.alerts.length === 0 ? (
              <div className="operations-empty operations-empty--compact">
                <p>No open alerts in this window.</p>
              </div>
            ) : (
              <div className="operations-alert-list">
                {summary.alerts.map((alert) => (
                  <article className="operations-alert" key={alert.id}>
                    <div className="operations-alert__header">
                      <strong>{alert.title}</strong>
                      <span
                        className={`operations-status operations-status--${alert.severity === "critical" ? "critical" : "warning"}`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <p>{alert.message}</p>
                    <div className="operations-alert__meta">
                      <span>{formatTimestamp(alert.lastSeenAt)}</span>
                      <span>{formatInteger(alert.occurrenceCount)} hit(s)</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Route Metrics</div>
                <h2>Request Health</h2>
              </div>
            </div>
            <div className="operations-table">
              <div className="operations-table__row operations-table__row--head">
                <span>Route Group</span>
                <span>Requests</span>
                <span>Errors</span>
                <span>429s</span>
                <span>Avg ms</span>
              </div>
              {summary.routeMetrics.map((metric) => (
                <div className="operations-table__row" key={metric.routeGroup}>
                  <span>{metric.routeGroup}</span>
                  <span>{formatInteger(metric.requestCount)}</span>
                  <span>{formatInteger(metric.errorCount)}</span>
                  <span>{formatInteger(metric.rateLimitedCount)}</span>
                  <span>{formatInteger(Math.round(metric.avgDurationMs))}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Usage</div>
                <h2>Cost by Event Type</h2>
              </div>
            </div>
            <div className="operations-table">
              <div className="operations-table__row operations-table__row--head">
                <span>Event</span>
                <span>Route</span>
                <span>Requests</span>
                <span>Credits</span>
                <span>Cost</span>
              </div>
              {summary.usageSummary.byEventType.map((metric) => (
                <div
                  className="operations-table__row"
                  key={`${metric.routeGroup}:${metric.eventType}`}
                >
                  <span>{metric.eventType}</span>
                  <span>{metric.routeGroup}</span>
                  <span>{formatInteger(metric.requestCount)}</span>
                  <span>{formatCredits(metric.commercialCredits)}</span>
                  <span>{formatUsd(metric.costUsd)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="operations-panel">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Top Users</div>
                <h2>Usage by User</h2>
              </div>
            </div>
            <div className="operations-table">
              <div className="operations-table__row operations-table__row--head">
                <span>User</span>
                <span>Status</span>
                <span>Requests</span>
                <span>Credits</span>
                <span>Cap</span>
                <span>Cost</span>
              </div>
              {summary.usageSummary.byUser.map((metric) => (
                <div className="operations-table__row" key={metric.userId}>
                  <span>{metric.name}</span>
                  <span>{metric.status}</span>
                  <span>{formatInteger(metric.requestCount)}</span>
                  <span>{formatCredits(metric.creditsUsed)}</span>
                  <span>
                    {metric.creditCap === null
                      ? "Shared pool"
                      : `${formatCredits(metric.remainingCreditCap ?? 0)} left`}
                  </span>
                  <span>{formatUsd(metric.costUsd)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="operations-panel operations-panel--wide">
            <div className="operations-panel__header">
              <div>
                <div className="operations-panel__eyebrow">Recent Failures</div>
                <h2>429s and 5xx Requests</h2>
              </div>
            </div>
            {summary.recentFailures.length === 0 ? (
              <div className="operations-empty operations-empty--compact">
                <p>No recent failures in this window.</p>
              </div>
            ) : (
              <div className="operations-failure-list">
                {summary.recentFailures.map((failure) => {
                  const supportDetails = [
                    { label: "Route", value: failure.routeKey },
                    { label: "Route group", value: failure.routeGroup },
                    { label: "Request ID", value: failure.requestId },
                    { label: "Sandbox run ID", value: failure.sandboxRunId },
                    { label: "Governance job ID", value: failure.governanceJobId },
                    { label: "Knowledge import job ID", value: failure.knowledgeImportJobId },
                    { label: "Turn ID", value: failure.turnId },
                    { label: "Runtime tool call ID", value: failure.runtimeToolCallId },
                  ].filter((item): item is { label: string; value: string } => Boolean(item.value));

                  return (
                    <article className="operations-failure" key={failure.requestId}>
                      <div className="operations-failure__header">
                        <strong>{getFailureHeadline(failure)}</strong>
                        <span className="operations-status operations-status--critical">
                          {failure.statusCode}
                        </span>
                      </div>
                      <div className="operations-failure__meta">
                        <span>{formatTimestamp(failure.completedAt)}</span>
                        <span>{failure.statusCode === 429 ? "Rate limited" : "Request failed"}</span>
                        <span>{failure.errorCode ?? failure.outcome}</span>
                      </div>
                      <details className="operations-failure__details">
                        <summary>Support details</summary>
                        <div className="operations-failure__detail-list">
                          {supportDetails.map((detail) => (
                            <div className="operations-failure__detail-row" key={detail.label}>
                              <span>{detail.label}</span>
                              <code>{detail.value}</code>
                            </div>
                          ))}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
