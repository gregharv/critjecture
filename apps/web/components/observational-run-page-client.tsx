"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { ObservationalRunDetail } from "@/lib/observational-analysis";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type ObservationalRunPageClientProps = {
  initialRunDetail: ObservationalRunDetail;
};

type ParsedAnswerPackage = {
  artifacts: Array<{
    artifactKind?: string;
    createdAt?: number;
    fileName?: string;
    mimeType?: string;
  }>;
  computeRuns: Array<{
    backend?: string;
    completedAt?: number | null;
    computeKind?: string;
    createdAt?: number;
    failureReason?: string | null;
    runner?: string;
    startedAt?: number | null;
    status?: string;
  }>;
  dataset: null | {
    datasetKey?: string;
    displayName?: string;
    id?: string;
  };
  datasetVersion: null | {
    id?: string;
    rowCount?: number | null;
    versionNumber?: number;
  };
  limitations: string[];
  nextSteps: string[];
  result: {
    claimLabel?: string;
    createdAt?: number;
    featureImportance?: Record<string, number>;
    metrics?: Record<string, number>;
    modelName?: string;
    rowCount?: number | null;
    summaryText?: string;
    targetColumnName?: string;
    taskKind?: string;
  };
  run: {
    claimLabel?: string | null;
    completedAt?: number | null;
    createdAt?: number;
    datasetId?: string;
    datasetVersionId?: string;
    featureColumns?: string[];
    modelName?: string | null;
    requestedByUserId?: string | null;
    runId?: string;
    startedAt?: number | null;
    status?: string;
    targetColumnName?: string;
    taskKind?: string;
  };
};

function formatTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
    return value.error;
  }

  return fallbackMessage;
}

function formatNumber(value: number, digits = 4) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)
    : String(value);
}

function formatLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseAnswerPackage(packageJson: string | null | undefined): ParsedAnswerPackage | null {
  if (!packageJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(packageJson) as Partial<ParsedAnswerPackage>;
    return {
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      computeRuns: Array.isArray(parsed.computeRuns) ? parsed.computeRuns : [],
      dataset: parsed.dataset ?? null,
      datasetVersion: parsed.datasetVersion ?? null,
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      result: parsed.result ?? {},
      run: parsed.run ?? {},
    };
  } catch {
    return null;
  }
}

export function ObservationalRunPageClient({ initialRunDetail }: ObservationalRunPageClientProps) {
  const [runDetail, setRunDetail] = useState(initialRunDetail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPackage = useMemo(
    () => parseAnswerPackage(runDetail.answerPackage?.packageJson),
    [runDetail.answerPackage?.packageJson],
  );
  const latestAnswer = runDetail.answers[0] ?? null;

  const metricEntries = useMemo(
    () => Object.entries(parsedPackage?.result.metrics ?? runDetail.result?.metrics ?? {}),
    [parsedPackage?.result.metrics, runDetail.result?.metrics],
  );
  const featureImportanceEntries = useMemo(
    () =>
      Object.entries(parsedPackage?.result.featureImportance ?? runDetail.result?.featureImportance ?? {}).sort(
        (left, right) => right[1] - left[1],
      ),
    [parsedPackage?.result.featureImportance, runDetail.result?.featureImportance],
  );

  async function refreshRun() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/analysis/observational/runs/${runDetail.run.id}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to refresh observational run."));
      }

      setRunDetail(json as ObservationalRunDetail);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to refresh observational run.");
    } finally {
      setPending(false);
    }
  }

  async function handleGenerateAnswer() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/analysis/observational/runs/${runDetail.run.id}/answers`, {
        method: "POST",
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to generate grounded observational answer."));
      }

      await refreshRun();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to generate grounded observational answer.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="observational-page">
      <div className="observational-hero">
        <p className="observational-hero__eyebrow">Observational run detail</p>
        <h1 className="observational-hero__title">{runDetail.dataset?.displayName ?? "Observational run"}</h1>
        <p className="observational-hero__copy">
          Run {runDetail.run.id} · status {runDetail.run.status} · task {runDetail.run.taskKind}
          {runDetail.run.claimLabel ? ` · ${runDetail.run.claimLabel}` : ""}
        </p>
        <p className="observational-card__meta" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="observational-study-list__link" href="/analysis/observational">
            ← Back to observational workspace
          </Link>
          <a
            className="observational-study-list__link"
            href={`/api/analysis/observational/runs/${runDetail.run.id}/export`}
          >
            Download export bundle
          </a>
        </p>
      </div>

      <div className="observational-grid">
        <section className="observational-card">
          <div className="observational-card__header-row">
            <h2 className="observational-card__title">Grounded observational answer</h2>
            <button
              className="observational-intake-form__submit"
              disabled={pending || !runDetail.answerPackage}
              onClick={() => void handleGenerateAnswer()}
              type="button"
            >
              {pending ? "Generating…" : "Generate grounded answer"}
            </button>
          </div>
          <p className="observational-card__copy">
            Final answers are rendered from the stored observational answer package only. They summarize rung-1 observational evidence and do not establish causal effects.
          </p>
          {error ? <p className="observational-intake-form__error">{error}</p> : null}

          {latestAnswer ? (
            <>
              <p className="observational-card__copy">
                <strong>Conclusion:</strong>{" "}
                {parsedPackage?.result.summaryText ?? runDetail.result?.summaryText ?? "No grounded conclusion was stored."}
              </p>
              <ul className="observational-list">
                <li>Claim label: {parsedPackage?.result.claimLabel ?? runDetail.result?.claimLabel ?? "not recorded"}</li>
                <li>Preset: {runDetail.run.preset}</li>
                <li>Task kind: {parsedPackage?.result.taskKind ?? runDetail.run.taskKind}</li>
                <li>Target column: {parsedPackage?.result.targetColumnName ?? runDetail.run.targetColumnName}</li>
                <li>Model: {parsedPackage?.result.modelName ?? runDetail.result?.modelName ?? runDetail.run.modelName ?? "not recorded"}</li>
                <li>
                  Evaluated rows: {formatNumber((parsedPackage?.result.rowCount ?? runDetail.result?.rowCount ?? 0) || 0, 0)}
                </li>
                {runDetail.answerPackage ? <li>Package saved: {formatTimestamp(runDetail.answerPackage.createdAt)}</li> : null}
                <li>Answer generated: {formatTimestamp(latestAnswer.createdAt)}</li>
                {runDetail.run.forecastConfig ? (
                  <li>
                    Forecast setup: {runDetail.run.forecastConfig.timeColumnName} · last {runDetail.run.forecastConfig.horizonValue} {runDetail.run.forecastConfig.horizonUnit}
                  </li>
                ) : null}
              </ul>

              <div className="observational-grid">
                <section className="observational-card">
                  <h3 className="observational-card__title">Metrics</h3>
                  {metricEntries.length ? (
                    <ul className="observational-study-list">
                      {metricEntries.map(([metric, value]) => (
                        <li key={metric} className="observational-study-list__item">
                          <div className="observational-study-list__header">
                            <strong>{formatLabel(metric)}</strong>
                            <span className="observational-study-list__status">{formatNumber(value)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="observational-card__empty">No observational metrics were stored in the grounded package.</p>
                  )}
                </section>

                <section className="observational-card">
                  <h3 className="observational-card__title">Top feature signals</h3>
                  {featureImportanceEntries.length ? (
                    <ul className="observational-study-list">
                      {featureImportanceEntries.slice(0, 5).map(([feature, value]) => (
                        <li key={feature} className="observational-study-list__item">
                          <div className="observational-study-list__header">
                            <strong>{feature}</strong>
                            <span className="observational-study-list__status">{formatNumber(value)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="observational-card__empty">No feature importance values were stored in the grounded package.</p>
                  )}
                </section>
              </div>

              <details>
                <summary className="observational-card__meta">Raw grounded answer markdown</summary>
                <div className="observational-answer-markdown">
                  <pre>{latestAnswer.answerText}</pre>
                </div>
              </details>
            </>
          ) : (
            <p className="observational-card__empty">
              No grounded answer generated yet. Create one after the run finishes packaging.
            </p>
          )}

          {runDetail.answers.length ? (
            <>
              <h3 className="observational-card__title">Answer history</h3>
              <ul className="observational-study-list">
                {runDetail.answers.map((answer, index) => (
                  <li key={answer.id} className="observational-study-list__item">
                    <div className="observational-study-list__header">
                      <strong>{index === 0 ? "Latest grounded answer" : answer.id}</strong>
                      <span className="observational-study-list__status">{answer.modelName}</span>
                    </div>
                    <p className="observational-study-list__meta">
                      Generated {formatTimestamp(answer.createdAt)} · prompt {answer.promptVersion}
                    </p>
                    <details>
                      <summary className="observational-card__meta">View stored markdown</summary>
                      <div className="observational-answer-markdown">
                        <pre>{answer.answerText}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="observational-card">
          <div className="observational-card__header-row">
            <h2 className="observational-card__title">Run grounding and status</h2>
            <button className="observational-intake-form__submit" disabled={pending} onClick={() => void refreshRun()} type="button">
              {pending ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <ul className="observational-list">
            <li>Run status: {runDetail.run.status}</li>
            <li>Dataset: {runDetail.dataset?.displayName ?? "unknown dataset"}</li>
            <li>Dataset key: {runDetail.dataset?.datasetKey ?? "unknown"}</li>
            <li>Dataset version: {runDetail.datasetVersion?.versionNumber ?? "unknown"}</li>
            <li>Target column: {runDetail.run.targetColumnName}</li>
            <li>Preset: {runDetail.run.preset}</li>
            <li>Task kind: {runDetail.run.taskKind}</li>
            <li>Created: {formatTimestamp(runDetail.run.createdAt)}</li>
            {runDetail.run.startedAt ? <li>Started: {formatTimestamp(runDetail.run.startedAt)}</li> : null}
            {runDetail.run.completedAt ? <li>Completed: {formatTimestamp(runDetail.run.completedAt)}</li> : null}
          </ul>
          <p className="observational-card__copy">
            <strong>Feature columns:</strong> {runDetail.run.featureColumns.join(", ") || "none"}
          </p>
          {runDetail.run.forecastConfig ? (
            <p className="observational-card__copy">
              <strong>Forecast setup:</strong> {runDetail.run.forecastConfig.timeColumnName} · last {runDetail.run.forecastConfig.horizonValue} {runDetail.run.forecastConfig.horizonUnit}
            </p>
          ) : null}
          <p className="observational-card__copy">
            {runDetail.run.summaryText ?? "No run summary available yet."}
          </p>

          <h3 className="observational-card__title">Package limitations</h3>
          {parsedPackage?.limitations.length ? (
            <ul className="observational-list">
              {parsedPackage.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p className="observational-card__empty">No package limitations were stored.</p>
          )}

          <h3 className="observational-card__title">Suggested next steps</h3>
          {parsedPackage?.nextSteps.length ? (
            <ul className="observational-list">
              {parsedPackage.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : (
            <p className="observational-card__empty">No next steps were stored.</p>
          )}
        </section>
      </div>

      <div className="observational-grid">
        <section className="observational-card">
          <h2 className="observational-card__title">Stored observational result</h2>
          {runDetail.result ? (
            <>
              <p className="observational-card__copy">
                <strong>Claim label:</strong> {runDetail.result.claimLabel}
              </p>
              <p className="observational-card__copy">
                <strong>Model:</strong> {runDetail.result.modelName}
              </p>
              <p className="observational-card__copy">{runDetail.result.summaryText}</p>

              <h3 className="observational-card__title">All metrics</h3>
              {Object.entries(runDetail.result.metrics).length ? (
                <ul className="observational-study-list">
                  {Object.entries(runDetail.result.metrics).map(([key, value]) => (
                    <li key={key} className="observational-study-list__item">
                      <div className="observational-study-list__header">
                        <strong>{formatLabel(key)}</strong>
                        <span className="observational-study-list__status">{formatNumber(value)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="observational-card__empty">No observational metrics were stored for this run.</p>
              )}

              <h3 className="observational-card__title">All feature importance</h3>
              {featureImportanceEntries.length ? (
                <ul className="observational-study-list">
                  {featureImportanceEntries.map(([key, value]) => (
                    <li key={key} className="observational-study-list__item">
                      <div className="observational-study-list__header">
                        <strong>{key}</strong>
                        <span className="observational-study-list__status">{formatNumber(value)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="observational-card__empty">No feature importance values were stored for this run.</p>
              )}

              <details>
                <summary className="observational-card__meta">Raw result JSON</summary>
                <div className="observational-answer-markdown">
                  <pre>{runDetail.result.resultJson}</pre>
                </div>
              </details>
            </>
          ) : (
            <p className="observational-card__empty">
              No persisted observational result is available for this run yet.
            </p>
          )}
        </section>
      </div>

      <div className="observational-grid">
        <section className="observational-card">
          <h2 className="observational-card__title">Execution telemetry</h2>
          {runDetail.computeRuns.length ? (
            <ul className="observational-study-list">
              {runDetail.computeRuns.map((computeRun) => (
                <li key={computeRun.id} className="observational-study-list__item">
                  <div className="observational-study-list__header">
                    <strong>{formatLabel(computeRun.computeKind)}</strong>
                    <span className="observational-study-list__status">{computeRun.status}</span>
                  </div>
                  <p className="observational-study-list__meta">
                    {computeRun.runner} via {computeRun.backend} · queued {formatTimestamp(computeRun.createdAt)}
                    {computeRun.startedAt ? ` · started ${formatTimestamp(computeRun.startedAt)}` : ""}
                    {computeRun.completedAt ? ` · completed ${formatTimestamp(computeRun.completedAt)}` : ""}
                  </p>
                  {computeRun.failureReason ? (
                    <p className="observational-intake-form__error">{computeRun.failureReason}</p>
                  ) : null}
                  <details>
                    <summary className="observational-card__meta">Telemetry payloads</summary>
                    <div className="observational-answer-markdown">
                      <pre>{computeRun.inputManifestJson}</pre>
                      {computeRun.stdoutText ? <pre>{computeRun.stdoutText}</pre> : null}
                      {computeRun.stderrText ? <pre>{computeRun.stderrText}</pre> : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="observational-card__empty">No compute telemetry was recorded for this run.</p>
          )}
        </section>

        <section className="observational-card">
          <h2 className="observational-card__title">Artifacts</h2>
          {runDetail.artifacts.length ? (
            <ul className="observational-study-list">
              {runDetail.artifacts.map((artifact) => (
                <li key={artifact.id} className="observational-study-list__item">
                  <div className="observational-study-list__header">
                    <strong>{artifact.fileName}</strong>
                    <span className="observational-study-list__status">{artifact.artifactKind}</span>
                  </div>
                  <p className="observational-study-list__meta">
                    Saved {formatTimestamp(artifact.createdAt)} · {artifact.mimeType}
                  </p>
                  <p className="observational-card__meta">
                    <a className="observational-study-list__link" href={artifact.downloadPath}>
                      Download artifact
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="observational-card__empty">No downloadable artifacts were recorded for this run.</p>
          )}
        </section>
      </div>
    </section>
  );
}
