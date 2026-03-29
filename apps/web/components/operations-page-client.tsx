"use client";

import { useEffect, useMemo, useState } from "react";

import type { OperationsSummaryResponse } from "@/lib/operations-types";

type OperationsState = {
  error: string | null;
  loading: boolean;
  summary: OperationsSummaryResponse | null;
};

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

function getHealthTone(status: OperationsSummaryResponse["health"]["status"]) {
  if (status === "ok") {
    return "ok";
  }

  if (status === "degraded") {
    return "warning";
  }

  return "critical";
}

export function OperationsPageClient() {
  const [window, setWindow] = useState<"24h" | "7d">("24h");
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
        costUsd: 0,
        openAlerts: 0,
        rateLimited: 0,
        requests: 0,
        sandboxRuns: 0,
        totalTokens: 0,
      };
    }

    return {
      costUsd: summary.usageSummary.byEventType.reduce((sum, item) => sum + item.costUsd, 0),
      openAlerts: summary.alerts.length,
      rateLimited: summary.routeMetrics.reduce(
        (sum, item) => sum + item.rateLimitedCount,
        0,
      ),
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

  return (
    <section className="operations-page">
      <header className="operations-hero">
        <div>
          <div className="operations-hero__eyebrow">Admin</div>
          <h1 className="operations-hero__title">Operations</h1>
          <p className="operations-hero__copy">
            Health, limits, costs, and recent failures for the current organization.
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
                <span className="operations-metric__label">Total Cost</span>
                <strong>{formatUsd(headlineMetrics.costUsd)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Tokens</span>
                <strong>{formatInteger(headlineMetrics.totalTokens)}</strong>
              </article>
              <article className="operations-metric">
                <span className="operations-metric__label">Sandbox Runs</span>
                <strong>{formatInteger(headlineMetrics.sandboxRuns)}</strong>
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
                <span>Tokens</span>
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
                  <span>{formatInteger(metric.totalTokens)}</span>
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
                <span>Requests</span>
                <span>Tokens</span>
                <span>Sandbox</span>
                <span>Cost</span>
              </div>
              {summary.usageSummary.byUser.map((metric) => (
                <div className="operations-table__row" key={metric.userId}>
                  <span>{metric.name}</span>
                  <span>{formatInteger(metric.requestCount)}</span>
                  <span>{formatInteger(metric.totalTokens)}</span>
                  <span>{formatInteger(metric.quantity)}</span>
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
                {summary.recentFailures.map((failure) => (
                  <article className="operations-failure" key={failure.requestId}>
                    <div className="operations-failure__header">
                      <strong>{failure.routeKey}</strong>
                      <span className="operations-status operations-status--critical">
                        {failure.statusCode}
                      </span>
                    </div>
                    <div className="operations-failure__meta">
                      <span>{formatTimestamp(failure.completedAt)}</span>
                      <span>{failure.userEmail ?? "Unknown user"}</span>
                      <span>{failure.errorCode ?? failure.outcome}</span>
                    </div>
                    <code>{failure.requestId}</code>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
