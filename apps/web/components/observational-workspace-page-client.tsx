"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import type {
  ObservationalAnalysisPreset,
  ObservationalDatasetCatalogItem,
  ObservationalRunResult,
  ObservationalRunSummary,
  ObservationalTaskKind,
} from "@/lib/observational-analysis";
import {
  buildObservationalChatReturnHref,
  buildObservationalWorkspaceHref,
  parseObservationalWorkspaceHandoff,
} from "@/lib/observational-handoff";

type ObservationalWorkspacePageClientProps = {
  initialCatalog: ObservationalDatasetCatalogItem[];
  initialRuns: ObservationalRunSummary[];
};

function formatMetricValue(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
    return value.error;
  }

  return fallbackMessage;
}

export function ObservationalWorkspacePageClient({
  initialCatalog,
  initialRuns,
}: ObservationalWorkspacePageClientProps) {
  const searchParams = useSearchParams();
  const [catalog] = useState(initialCatalog);
  const [datasetVersionId, setDatasetVersionId] = useState(
    initialCatalog[0]?.versions[0]?.id ?? "",
  );
  const [targetColumn, setTargetColumn] = useState("");
  const [featureColumns, setFeatureColumns] = useState<string[]>([]);
  const [taskKind, setTaskKind] = useState<ObservationalTaskKind>("classification");
  const [preset, setPreset] = useState<ObservationalAnalysisPreset>("standard");
  const [forecastHorizonValue, setForecastHorizonValue] = useState(7);
  const [forecastHorizonUnit, setForecastHorizonUnit] = useState("rows");
  const [timeColumn, setTimeColumn] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ObservationalRunResult | null>(null);
  const [runs, setRuns] = useState(initialRuns);
  const appliedHandoffSignatureRef = useRef<string | null>(null);

  const handoffSignature = searchParams.toString();
  const handoff = useMemo(
    () => parseObservationalWorkspaceHandoff(searchParams),
    [searchParams],
  );

  const selectedVersion = useMemo(() => {
    for (const dataset of catalog) {
      const version = dataset.versions.find((entry) => entry.id === datasetVersionId);
      if (version) {
        return {
          dataset,
          version,
        };
      }
    }

    return null;
  }, [catalog, datasetVersionId]);

  const availableColumns = useMemo(
    () => selectedVersion?.version.columns ?? [],
    [selectedVersion],
  );
  const availableTimeColumns = useMemo(
    () => availableColumns.filter((column) => column.semanticType === "time"),
    [availableColumns],
  );
  const returnToChat = handoff?.returnToChat ?? "/chat";
  const observationalWorkspaceHref = useMemo(
    () =>
      buildObservationalWorkspaceHref({
        datasetVersionId,
        featureColumns,
        forecastHorizonUnit,
        forecastHorizonValue,
        planningNote: handoff?.planningNote,
        preset,
        returnToChat,
        targetColumn,
        taskKind,
        timeColumn,
      }),
    [
      datasetVersionId,
      featureColumns,
      forecastHorizonUnit,
      forecastHorizonValue,
      handoff?.planningNote,
      preset,
      returnToChat,
      targetColumn,
      taskKind,
      timeColumn,
    ],
  );
  const workspaceReadyChatHref = useMemo(
    () =>
      buildObservationalChatReturnHref({
        datasetVersionId,
        featureColumns,
        forecastHorizonUnit,
        forecastHorizonValue,
        planningNote: handoff?.planningNote,
        preset,
        returnToChat,
        status: "workspace_ready",
        targetColumn,
        taskKind,
        timeColumn,
        workspaceHref: observationalWorkspaceHref,
      }),
    [
      datasetVersionId,
      featureColumns,
      forecastHorizonUnit,
      forecastHorizonValue,
      handoff?.planningNote,
      observationalWorkspaceHref,
      preset,
      returnToChat,
      targetColumn,
      taskKind,
      timeColumn,
    ],
  );
  const runCompletedChatHref = useMemo(() => {
    if (!result) {
      return null;
    }

    const metricHighlights = Object.entries(result.metrics)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${formatMetricValue(value)}`);

    return buildObservationalChatReturnHref({
      claimLabel: result.claimLabel,
      datasetVersionId: result.datasetVersionId,
      featureColumns: result.featureColumns,
      forecastHorizonUnit: result.forecastConfig?.horizonUnit,
      forecastHorizonValue: result.forecastConfig?.horizonValue,
      metricHighlights,
      planningNote: handoff?.planningNote,
      preset: result.preset,
      returnToChat,
      runId: result.id,
      status: "run_completed",
      summary: result.summary,
      targetColumn: result.targetColumn,
      taskKind: result.taskKind,
      timeColumn: result.forecastConfig?.timeColumnName ?? timeColumn,
      workspaceHref: observationalWorkspaceHref,
    });
  }, [handoff?.planningNote, observationalWorkspaceHref, result, returnToChat, timeColumn]);

  useEffect(() => {
    if (!timeColumn && availableTimeColumns[0]?.columnName) {
      setTimeColumn(availableTimeColumns[0].columnName);
    }
  }, [availableTimeColumns, timeColumn]);

  useEffect(() => {
    if (!handoff || appliedHandoffSignatureRef.current === handoffSignature) {
      return;
    }

    const hasRequestedDatasetVersion =
      handoff.datasetVersionId &&
      catalog.some((dataset) => dataset.versions.some((version) => version.id === handoff.datasetVersionId));

    if (
      hasRequestedDatasetVersion &&
      handoff.datasetVersionId &&
      handoff.datasetVersionId !== datasetVersionId
    ) {
      setDatasetVersionId(handoff.datasetVersionId);
      setTargetColumn("");
      setFeatureColumns([]);
      setResult(null);
      setTimeColumn("");
      return;
    }

    if (handoff.taskKind) {
      setTaskKind(handoff.taskKind);
    }

    if (handoff.preset) {
      setPreset(handoff.preset);
    }

    if (handoff.forecastHorizonValue) {
      setForecastHorizonValue(handoff.forecastHorizonValue);
    }

    if (handoff.forecastHorizonUnit) {
      setForecastHorizonUnit(handoff.forecastHorizonUnit);
    }

    if (
      handoff.timeColumn &&
      availableColumns.some((column) => column.columnName === handoff.timeColumn)
    ) {
      setTimeColumn(handoff.timeColumn);
    }

    if (
      handoff.targetColumn &&
      availableColumns.some((column) => column.columnName === handoff.targetColumn)
    ) {
      setTargetColumn(handoff.targetColumn);
    }

    const filteredFeatureColumns = handoff.featureColumns.filter(
      (columnName) =>
        availableColumns.some((column) => column.columnName === columnName) &&
        columnName !== (handoff.targetColumn ?? targetColumn),
    );

    if (filteredFeatureColumns.length > 0) {
      setFeatureColumns(filteredFeatureColumns);
    }

    appliedHandoffSignatureRef.current = handoffSignature;
  }, [
    availableColumns,
    catalog,
    datasetVersionId,
    handoff,
    handoffSignature,
    targetColumn,
  ]);

  function handleToggleFeature(columnName: string) {
    setFeatureColumns((current) =>
      current.includes(columnName)
        ? current.filter((value) => value !== columnName)
        : [...current, columnName],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/analysis/observational/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          datasetVersionId,
          featureColumns,
          forecastHorizonUnit,
          forecastHorizonValue,
          preset,
          targetColumn,
          taskKind,
          timeColumn,
        }),
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Observational analysis failed."));
      }

      const nextResult = json as ObservationalRunResult;
      setResult(nextResult);
      setRuns((current) => [
        {
          claimLabel: nextResult.claimLabel,
          createdAt: Date.now(),
          datasetDisplayName: selectedVersion?.dataset.displayName ?? nextResult.datasetVersionId,
          datasetVersionId: nextResult.datasetVersionId,
          featureColumns: nextResult.featureColumns,
          forecastConfig: nextResult.forecastConfig,
          id: nextResult.id,
          metrics: nextResult.metrics,
          modelName: nextResult.modelName,
          preset: nextResult.preset,
          status: "completed",
          summaryText: nextResult.summary,
          targetColumnName: nextResult.targetColumn,
          taskKind: nextResult.taskKind,
        },
        ...current.filter((entry) => entry.id !== nextResult.id),
      ]);
    } catch (caughtError) {
      setResult(null);
      setError(caughtError instanceof Error ? caughtError.message : "Observational analysis failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="observational-page">
      <div className="observational-hero">
        <p className="observational-hero__eyebrow">Rung-1 observational workspace</p>
        <h1 className="observational-hero__title">Observational analysis</h1>
        <p className="observational-hero__copy">
          Use this workspace to run rung-1 non-causal analysis such as associations, predictors,
          feature importance, and forecasts after the modeling approach has been worked out. Outputs here must remain observational and must not be narrated as intervention or counterfactual findings.
        </p>
      </div>

      <div className="observational-grid">
        <section className="observational-card">
          <h2 className="observational-card__title">Run observational analysis</h2>
          <p className="observational-card__copy">
            This workspace is for execution, not model-framing from scratch. Business users should
            use chat first to work through target definition, forecast horizon, candidate features,
            and success metrics before running a rung-1 observational model here.
          </p>
          {handoff ? (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid rgba(37, 99, 235, 0.18)",
                borderRadius: 12,
                marginTop: 12,
                padding: 12,
              }}
            >
              <p className="observational-card__meta">Prefilled from chat planning</p>
              <ul className="observational-list" style={{ marginTop: 8 }}>
                {handoff.datasetVersionId ? <li>Suggested dataset version: {handoff.datasetVersionId}</li> : null}
                {handoff.targetColumn ? <li>Suggested target: {handoff.targetColumn}</li> : null}
                {handoff.featureColumns.length ? (
                  <li>Suggested features: {handoff.featureColumns.join(", ")}</li>
                ) : null}
                {handoff.taskKind ? <li>Suggested task kind: {handoff.taskKind}</li> : null}
                {handoff.preset ? <li>Suggested preset: {handoff.preset}</li> : null}
                {handoff.timeColumn ? <li>Suggested time column: {handoff.timeColumn}</li> : null}
                {handoff.forecastHorizonValue ? (
                  <li>
                    Suggested horizon: {handoff.forecastHorizonValue} {handoff.forecastHorizonUnit ?? "rows"}
                  </li>
                ) : null}
              </ul>
              {handoff.planningNote ? (
                <p className="observational-card__copy" style={{ marginTop: 8 }}>
                  <strong>Planning note:</strong> {handoff.planningNote}
                </p>
              ) : null}
              <div className="observational-inline-actions" style={{ marginTop: 12 }}>
                <Link className="observational-study-list__link" href={returnToChat}>
                  Continue planning in chat
                </Link>
                <Link className="observational-study-list__link" href={workspaceReadyChatHref}>
                  Send observational-workspace update to chat
                </Link>
              </div>
            </div>
          ) : null}
          <form className="observational-intake-form" onSubmit={handleSubmit}>
            <label className="observational-intake-form__label" htmlFor="observational-dataset-version">
              Dataset version
            </label>
            <select
              id="observational-dataset-version"
              className="observational-intake-form__textarea"
              disabled={pending}
              onChange={(event) => {
                setDatasetVersionId(event.target.value);
                setTargetColumn("");
                setFeatureColumns([]);
                setResult(null);
                setTimeColumn("");
              }}
              value={datasetVersionId}
            >
              {catalog.flatMap((dataset) =>
                dataset.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {dataset.displayName} — v{version.versionNumber}
                  </option>
                )),
              )}
            </select>

            <label className="observational-intake-form__label" htmlFor="observational-preset">
              Analysis preset
            </label>
            <select
              id="observational-preset"
              className="observational-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setPreset(event.target.value as ObservationalAnalysisPreset)}
              value={preset}
            >
              <option value="standard">Standard instrumental / heuristic prediction</option>
              <option value="forecast">Forecast-style time-aware holdout</option>
            </select>

            {preset === "forecast" ? (
              <p className="observational-card__meta">
                Forecast mode validates that a time column exists and evaluates the model on the last N ordered rows instead of a random split. This remains instrumental / heuristic prediction, not causal.
              </p>
            ) : null}
            {preset === "forecast" && availableTimeColumns.length === 0 ? (
              <p className="observational-intake-form__error">
                This dataset version does not expose a time-typed column yet, so forecast mode may be blocked until the dataset schema marks one.
              </p>
            ) : null}

            <label className="observational-intake-form__label" htmlFor="observational-task-kind">
              Task kind
            </label>
            <select
              id="observational-task-kind"
              className="observational-intake-form__textarea"
              disabled={pending}
              onChange={(event) => setTaskKind(event.target.value as ObservationalTaskKind)}
              value={taskKind}
            >
              <option value="classification">Classification / heuristic prediction</option>
              <option value="regression">Regression / heuristic prediction</option>
            </select>

            <label className="observational-intake-form__label" htmlFor="observational-target-column">
              Target column
            </label>
            <select
              id="observational-target-column"
              className="observational-intake-form__textarea"
              disabled={pending || availableColumns.length === 0}
              onChange={(event) => setTargetColumn(event.target.value)}
              value={targetColumn}
            >
              <option value="">Select target column</option>
              {availableColumns.map((column) => (
                <option key={column.id} value={column.columnName}>
                  {column.displayName}
                </option>
              ))}
            </select>

            {preset === "forecast" ? (
              <>
                <label className="observational-intake-form__label" htmlFor="observational-time-column">
                  Time column
                </label>
                <select
                  id="observational-time-column"
                  className="observational-intake-form__textarea"
                  disabled={pending || availableTimeColumns.length === 0}
                  onChange={(event) => setTimeColumn(event.target.value)}
                  value={timeColumn}
                >
                  <option value="">Select time column</option>
                  {availableTimeColumns.map((column) => (
                    <option key={column.id} value={column.columnName}>
                      {column.displayName}
                    </option>
                  ))}
                </select>

                <label className="observational-intake-form__label" htmlFor="observational-forecast-horizon">
                  Forecast horizon
                </label>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(140px, 180px)" }}>
                  <input
                    id="observational-forecast-horizon"
                    className="observational-intake-form__textarea"
                    disabled={pending}
                    min={1}
                    onChange={(event) => setForecastHorizonValue(Number.parseInt(event.target.value || "0", 10) || 0)}
                    type="number"
                    value={forecastHorizonValue}
                  />
                  <input
                    className="observational-intake-form__textarea"
                    disabled={pending}
                    onChange={(event) => setForecastHorizonUnit(event.target.value)}
                    placeholder="rows"
                    value={forecastHorizonUnit}
                  />
                </div>
              </>
            ) : null}

            <div>
              <div className="observational-intake-form__label">Feature columns</div>
              <div style={{ display: "grid", gap: 8 }}>
                {availableColumns.map((column) => (
                  <label key={column.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      checked={featureColumns.includes(column.columnName)}
                      disabled={pending || column.columnName === targetColumn}
                      onChange={() => handleToggleFeature(column.columnName)}
                      type="checkbox"
                    />
                    <span>
                      {column.displayName} <small>({column.semanticType})</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="observational-intake-form__actions">
              <button className="observational-intake-form__submit" disabled={pending} type="submit">
                {pending ? "Running…" : "Run observational analysis"}
              </button>
              {error ? <p className="observational-intake-form__error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="observational-card">
          <h2 className="observational-card__title">Latest result</h2>
          {result ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p><strong>Claim label:</strong> {result.claimLabel}</p>
              <p><strong>Preset:</strong> {result.preset}</p>
              <p><strong>Model:</strong> {result.modelName}</p>
              <p><strong>Rows used:</strong> {result.rowCount}</p>
              {result.forecastConfig ? (
                <p><strong>Forecast setup:</strong> {result.forecastConfig.timeColumnName} · last {result.forecastConfig.horizonValue} {result.forecastConfig.horizonUnit}</p>
              ) : null}
              <p>{result.summary}</p>
              <div>
                <strong>Metrics</strong>
                <ul>
                  {Object.entries(result.metrics).map(([key, value]) => (
                    <li key={key}>{key}: {formatMetricValue(value)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Feature importance</strong>
                <ul>
                  {Object.entries(result.featureImportance)
                    .sort((left, right) => right[1] - left[1])
                    .map(([key, value]) => (
                      <li key={key}>{key}: {formatMetricValue(value)}</li>
                    ))}
                </ul>
              </div>
              <div className="observational-inline-actions">
                <Link className="observational-study-list__link" href={runCompletedChatHref ?? returnToChat}>
                  Return to chat with this run update
                </Link>
                <Link className="observational-study-list__link" href={`/analysis/observational/runs/${result.id}`}>
                  Open observational run detail
                </Link>
              </div>
            </div>
          ) : (
            <p className="observational-card__empty">
              No observational result yet. Select a dataset version, target, and features to run the
              CatBoost-based rung-1 path.
            </p>
          )}
        </section>

        <section className="observational-card">
          <div className="observational-card__header-row">
            <h2 className="observational-card__title">Run history</h2>
            <span className="observational-card__meta">{runs.length} total</span>
          </div>
          {runs.length > 0 ? (
            <ul className="observational-study-list">
              {runs.map((run) => (
                <li key={run.id} className="observational-study-list__item">
                  <div className="observational-study-list__header">
                    <strong>
                      <Link className="observational-study-list__link" href={`/analysis/observational/runs/${run.id}`}>
                        {run.datasetDisplayName}
                      </Link>
                    </strong>
                    <span className="observational-study-list__status">{run.status}</span>
                  </div>
                  <p className="observational-study-list__question">
                    {run.claimLabel ?? "PENDING"} • {run.preset} • {run.taskKind} • target {run.targetColumnName}
                  </p>
                  <p className="observational-study-list__meta">
                    Features: {run.featureColumns.join(", ") || "none"}
                  </p>
                  {run.forecastConfig ? (
                    <p className="observational-study-list__meta">
                      Forecast setup: {run.forecastConfig.timeColumnName} · last {run.forecastConfig.horizonValue} {run.forecastConfig.horizonUnit}
                    </p>
                  ) : null}
                  <p className="observational-study-list__meta">
                    {run.summaryText ?? "No summary yet."}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="observational-card__empty">
              No observational runs yet. Run CatBoost analysis to create durable rung-1 history.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
