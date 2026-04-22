"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { deriveCausalEpistemicVerdict } from "@/lib/causal-claim-labels";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type RunDetail = {
  answerPackage: null | {
    createdAt: number;
    id: string;
    packageJson: string;
  };
  answers: Array<{
    answerFormat: string;
    answerText: string;
    createdAt: number;
    id: string;
    modelName: string;
    promptVersion: string;
  }>;
  artifacts: Array<{
    artifactKind: string;
    createdAt: number;
    downloadPath: string;
    fileName: string;
    id: string;
    mimeType: string;
    storagePath: string;
  }>;
  computeRuns: Array<{
    backend: string;
    completedAt: number | null;
    computeKind: string;
    createdAt: number;
    id: string;
    runner: string;
    status: string;
  }>;
  estimates: Array<{
    confidenceIntervalHigh: number | null;
    confidenceIntervalLow: number | null;
    effectName: string;
    estimateValue: number | null;
    estimatorName: string;
    id: string;
    pValue: number | null;
    stdError: number | null;
  }>;
  estimands: Array<{
    estimandExpression: string;
    estimandKind: string;
    estimandLabel: string;
    id: string;
  }>;
  identification: null | {
    adjustmentSetJson: string;
    blockingReasonsJson: string;
    createdAt: number;
    identified: boolean;
    method: string;
  };
  refutations: Array<{
    createdAt: number;
    id: string;
    refuterName: string;
    status: string;
    summaryText: string;
  }>;
  run: {
    completedAt: number | null;
    createdAt: number;
    dagVersionId: string;
    id: string;
    outcomeNodeKey: string;
    primaryDatasetVersionId: string;
    startedAt: number | null;
    status: string;
    treatmentNodeKey: string;
  };
};

type ParsedAnswerPackage = {
  assumptions: Array<{
    assumptionType?: string;
    description?: string;
    status?: string;
  }>;
  approval: null | {
    approvalKind?: string;
    approvalText?: string;
    createdAt?: number;
  };
  estimates: Array<{
    confidenceIntervalHigh?: number | null;
    confidenceIntervalLow?: number | null;
    effectName?: string;
    estimateValue?: number | null;
    estimatorName?: string;
    pValue?: number | null;
    stdError?: number | null;
  }>;
  epistemicVerdict: null | {
    claimLabel?: string;
    summaryText?: string;
  };
  estimands: Array<{
    estimandExpression?: string;
    estimandKind?: string;
    estimandLabel?: string;
  }>;
  identification: null | {
    adjustmentSet?: string[];
    blockingReasons?: string[];
    identified?: boolean;
    method?: string;
    statusLabel?: string;
  };
  limitations: string[];
  nextSteps: string[];
  question: string | null;
  refutations: Array<{
    refuterName?: string;
    status?: string;
    summaryText?: string;
  }>;
  study: {
    title?: string | null;
  };
};

type CausalRunPageClientProps = {
  initialRunDetail: RunDetail;
  study: {
    id: string;
    title: string;
  };
};

function formatTimestamp(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp);
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

function formatNumber(value: number | null, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "not reported";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatLabel(value: string) {
  return value
    .split(/[\s_-]+/)
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
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      approval: parsed.approval ?? null,
      estimates: Array.isArray(parsed.estimates) ? parsed.estimates : [],
      epistemicVerdict: parsed.epistemicVerdict ?? null,
      estimands: Array.isArray(parsed.estimands) ? parsed.estimands : [],
      identification: parsed.identification ?? null,
      limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
      question: typeof parsed.question === "string" ? parsed.question : null,
      refutations: Array.isArray(parsed.refutations) ? parsed.refutations : [],
      study: parsed.study ?? {},
    };
  } catch {
    return null;
  }
}

function parseStringArray(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function getStatusTone(status: string) {
  const normalized = status.toLowerCase();

  if (
    normalized.includes("failed") ||
    normalized.includes("falsified") ||
    normalized.includes("blocked") ||
    normalized.includes("error")
  ) {
    return {
      background: "#fef2f2",
      border: "1px solid rgba(220, 38, 38, 0.18)",
      color: "#b91c1c",
    };
  }

  if (normalized.includes("weakly")) {
    return {
      background: "#fffbeb",
      border: "1px solid rgba(217, 119, 6, 0.18)",
      color: "#b45309",
    };
  }

  if (
    normalized.includes("completed") ||
    normalized.includes("succeeded") ||
    normalized.includes("accepted") ||
    normalized.includes("corroborated")
  ) {
    return {
      background: "#f0fdf4",
      border: "1px solid rgba(22, 163, 74, 0.18)",
      color: "#15803d",
    };
  }

  return {
    background: "#eff6ff",
    border: "1px solid rgba(37, 99, 235, 0.18)",
    color: "#1d4ed8",
  };
}

function describeEstimateDirection(value: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "No quantitative estimate was reported.";
  }

  if (value > 0) {
    return `Estimated positive effect of ${formatNumber(value)}.`;
  }

  if (value < 0) {
    return `Estimated negative effect of ${formatNumber(value)}.`;
  }

  return "Estimated effect is approximately zero.";
}

function formatPreviewList(values: string[], emptyLabel: string, limit = 3) {
  if (!values.length) {
    return emptyLabel;
  }

  const preview = values.slice(0, limit).join(", ");
  return values.length > limit ? `${preview} +${values.length - limit} more` : preview;
}

export function CausalRunPageClient({
  initialRunDetail,
  study,
}: CausalRunPageClientProps) {
  const [runDetail, setRunDetail] = useState(initialRunDetail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPackage = useMemo(
    () => parseAnswerPackage(runDetail.answerPackage?.packageJson),
    [runDetail.answerPackage?.packageJson],
  );
  const latestAnswer = runDetail.answers[0] ?? null;
  const primaryEstimate = runDetail.estimates[0] ?? null;
  const identificationAdjustmentSet = useMemo(() => {
    const fromPackage = parsedPackage?.identification?.adjustmentSet ?? [];
    return fromPackage.length
      ? fromPackage
      : parseStringArray(runDetail.identification?.adjustmentSetJson);
  }, [parsedPackage?.identification?.adjustmentSet, runDetail.identification?.adjustmentSetJson]);
  const identificationBlockingReasons = useMemo(() => {
    const fromPackage = parsedPackage?.identification?.blockingReasons ?? [];
    return fromPackage.length
      ? fromPackage
      : parseStringArray(runDetail.identification?.blockingReasonsJson);
  }, [parsedPackage?.identification?.blockingReasons, runDetail.identification?.blockingReasonsJson]);
  const identified = parsedPackage?.identification?.identified ?? runDetail.identification?.identified ?? null;
  const identificationMethod = parsedPackage?.identification?.method ?? runDetail.identification?.method ?? null;
  const identificationStatusLabel =
    parsedPackage?.identification?.statusLabel ??
    (identified === true ? "identified" : identified === false ? "not identified" : "not recorded");
  const packagePrimaryEstimate = parsedPackage?.estimates[0] ?? null;
  const packagePrimaryEstimand = parsedPackage?.estimands[0] ?? null;
  const derivedEpistemicVerdict = deriveCausalEpistemicVerdict({
    blockingReasons: identificationBlockingReasons,
    identified,
    outcomeNodeKey: runDetail.run.outcomeNodeKey,
    refutationStatuses: runDetail.refutations.map((refutation) => refutation.status),
    treatmentNodeKey: runDetail.run.treatmentNodeKey,
  });
  const epistemicVerdict = {
    claimLabel: parsedPackage?.epistemicVerdict?.claimLabel ?? derivedEpistemicVerdict.claimLabel,
    summaryText: parsedPackage?.epistemicVerdict?.summaryText ?? derivedEpistemicVerdict.summaryText,
  };
  const summaryEstimateValue =
    typeof packagePrimaryEstimate?.estimateValue === "number"
      ? packagePrimaryEstimate.estimateValue
      : primaryEstimate?.estimateValue ?? null;
  const summaryEstimateInterval =
    typeof packagePrimaryEstimate?.confidenceIntervalLow === "number" &&
    typeof packagePrimaryEstimate?.confidenceIntervalHigh === "number"
      ? `${formatNumber(packagePrimaryEstimate.confidenceIntervalLow)} to ${formatNumber(packagePrimaryEstimate.confidenceIntervalHigh)}`
      : typeof primaryEstimate?.confidenceIntervalLow === "number" &&
          typeof primaryEstimate?.confidenceIntervalHigh === "number"
        ? `${formatNumber(primaryEstimate.confidenceIntervalLow)} to ${formatNumber(primaryEstimate.confidenceIntervalHigh)}`
        : null;
  const assumptionHighlights = (parsedPackage?.assumptions ?? []).slice(0, 3);
  const limitationHighlights = (parsedPackage?.limitations ?? []).slice(0, 3);
  const latestComputeRun = runDetail.computeRuns[0] ?? null;

  async function refreshRun() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/causal/runs/${runDetail.run.id}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to refresh causal run."));
      }

      setRunDetail(json as RunDetail);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to refresh causal run.");
    } finally {
      setPending(false);
    }
  }

  async function handleGenerateAnswer() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/causal/runs/${runDetail.run.id}/answers`, {
        method: "POST",
      });
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(getErrorMessage(json, "Failed to generate grounded answer."));
      }

      await refreshRun();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to generate grounded answer.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="causal-page">
      <div className="causal-hero">
        <p className="causal-hero__eyebrow">Causal run detail</p>
        <h1 className="causal-hero__title">{study.title}</h1>
        <p className="causal-hero__copy">
          Run {runDetail.run.id} · status {runDetail.run.status} · treatment {runDetail.run.treatmentNodeKey}
          {" · "}
          outcome {runDetail.run.outcomeNodeKey}
        </p>
        <p className="causal-card__meta" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link className="causal-study-list__link" href={`/causal/studies/${study.id}`}>
            ← Back to study workspace
          </Link>
          <a className="causal-study-list__link" href={`/api/causal/runs/${runDetail.run.id}/export`}>
            Download export bundle
          </a>
        </p>
      </div>

      <div className="causal-grid">
        {[
          {
            label: "Run status",
            tone: getStatusTone(runDetail.run.status),
            value: formatLabel(runDetail.run.status),
          },
          {
            label: "Identification",
            tone: getStatusTone(identificationStatusLabel),
            value: formatLabel(identificationStatusLabel),
          },
          {
            label: "Epistemic verdict",
            tone: getStatusTone(epistemicVerdict.claimLabel),
            value: epistemicVerdict.claimLabel,
          },
          {
            label: "Primary estimate",
            tone: getStatusTone(primaryEstimate?.estimateValue == null ? "pending" : "completed"),
            value: formatNumber(primaryEstimate?.estimateValue ?? null),
          },
          {
            label: "Refutations",
            tone: getStatusTone(runDetail.refutations.length ? "completed" : "pending"),
            value: String(runDetail.refutations.length),
          },
        ].map((card) => (
          <section key={card.label} className="causal-card">
            <p className="causal-card__meta">{card.label}</p>
            <div
              style={{
                ...card.tone,
                borderRadius: 14,
                display: "inline-flex",
                fontSize: 20,
                fontWeight: 700,
                marginTop: 8,
                padding: "10px 14px",
              }}
            >
              {card.value}
            </div>
          </section>
        ))}
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Grounded final answer</h2>
            <div className="causal-inline-actions">
              <button
                className="causal-intake-form__submit"
                disabled={pending}
                onClick={() => void refreshRun()}
                type="button"
              >
                {pending ? "Refreshing…" : "Refresh"}
              </button>
              <button
                className="causal-intake-form__submit"
                disabled={pending || !runDetail.answerPackage}
                onClick={() => void handleGenerateAnswer()}
                type="button"
              >
                {pending ? "Generating…" : "Generate grounded answer"}
              </button>
            </div>
          </div>
          <p className="causal-card__copy">
            Final answers are rendered from the stored causal answer package only. This page is for
            interpreting stored causal evidence, assumptions, and refutation outputs.
          </p>
          {error ? <p className="causal-intake-form__error">{error}</p> : null}

          {latestAnswer ? (
            <>
              <ul className="causal-list">
                <li>Latest answer model: {latestAnswer.modelName}</li>
                <li>Prompt version: {latestAnswer.promptVersion}</li>
                <li>Generated: {formatTimestamp(latestAnswer.createdAt)}</li>
                {runDetail.answerPackage ? (
                  <li>Answer package saved: {formatTimestamp(runDetail.answerPackage.createdAt)}</li>
                ) : null}
              </ul>

              <div className="causal-grid" style={{ marginTop: 16 }}>
                <section className="causal-card">
                  <p className="causal-card__meta">Topline claim</p>
                  <div
                    style={{
                      ...getStatusTone(epistemicVerdict.claimLabel),
                      borderRadius: 12,
                      display: "inline-flex",
                      fontSize: 13,
                      fontWeight: 700,
                      marginTop: 8,
                      padding: "6px 10px",
                    }}
                  >
                    {epistemicVerdict.claimLabel}
                  </div>
                  <p className="causal-card__copy" style={{ marginTop: 12 }}>
                    {epistemicVerdict.summaryText}
                  </p>
                  <p className="causal-card__meta" style={{ marginTop: 12 }}>
                    {identified === false
                      ? `The stored package does not support identification of ${runDetail.run.treatmentNodeKey} → ${runDetail.run.outcomeNodeKey}.`
                      : describeEstimateDirection(summaryEstimateValue)}
                  </p>
                  <p className="causal-card__meta">
                    {packagePrimaryEstimand?.estimandLabel ?? runDetail.estimands[0]?.estimandLabel ?? "No estimand label stored"}
                  </p>
                </section>

                <section className="causal-card">
                  <p className="causal-card__meta">Evidence snapshot</p>
                  <ul className="causal-list">
                    <li>Method: {identificationMethod ? formatLabel(identificationMethod) : "not recorded"}</li>
                    <li>
                      Estimate: {formatNumber(summaryEstimateValue)}
                      {summaryEstimateInterval ? ` · interval ${summaryEstimateInterval}` : ""}
                    </li>
                    <li>
                      Estimator: {packagePrimaryEstimate?.estimatorName ?? primaryEstimate?.estimatorName ?? "not recorded"}
                    </li>
                    <li>Adjustment set: {formatPreviewList(identificationAdjustmentSet, "not recorded")}</li>
                    <li>
                      Refutations: {runDetail.refutations.length || parsedPackage?.refutations.length || 0} stored · {formatPreviewList(
                        runDetail.refutations.map((refutation) => refutation.refuterName),
                        formatPreviewList(
                          (parsedPackage?.refutations ?? [])
                            .map((refutation) => refutation.refuterName)
                            .filter((value): value is string => typeof value === "string" && value.length > 0),
                          "none recorded",
                        ),
                      )}
                    </li>
                  </ul>
                </section>

                <section className="causal-card">
                  <p className="causal-card__meta">Key assumptions</p>
                  {assumptionHighlights.length ? (
                    <ul className="causal-list">
                      {assumptionHighlights.map((assumption, index) => (
                        <li key={`${assumption.description ?? assumption.assumptionType ?? "assumption"}-${index}`}>
                          {assumption.description ?? assumption.assumptionType ?? "Unnamed assumption"}
                          {assumption.status ? ` · ${assumption.status}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="causal-card__empty">No explicit assumptions were stored.</p>
                  )}
                </section>

                <section className="causal-card">
                  <p className="causal-card__meta">Main caveats</p>
                  {identificationBlockingReasons.length || limitationHighlights.length ? (
                    <ul className="causal-list">
                      {(identificationBlockingReasons.length
                        ? identificationBlockingReasons
                        : limitationHighlights
                      )
                        .slice(0, 3)
                        .map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                    </ul>
                  ) : (
                    <p className="causal-card__empty">No blocking reasons or package limitations were stored.</p>
                  )}
                </section>
              </div>

              <details open>
                <summary className="causal-card__meta">Latest grounded answer markdown</summary>
                <div className="causal-answer-markdown">
                  <pre>{latestAnswer.answerText}</pre>
                </div>
              </details>
            </>
          ) : (
            <p className="causal-card__empty">
              No grounded answer generated yet. Create one after the run finishes packaging.
            </p>
          )}

          {runDetail.answers.length ? (
            <>
              <h3 className="causal-card__title">Answer history</h3>
              <ul className="causal-study-list">
                {runDetail.answers.map((answer, index) => (
                  <li key={answer.id} className="causal-study-list__item">
                    <div className="causal-study-list__header">
                      <strong>{index === 0 ? "Latest grounded answer" : answer.id}</strong>
                      <span className="causal-study-list__status">{answer.modelName}</span>
                    </div>
                    <p className="causal-study-list__meta">
                      Generated {formatTimestamp(answer.createdAt)} · prompt {answer.promptVersion}
                    </p>
                    <details>
                      <summary className="causal-card__meta">View stored markdown</summary>
                      <div className="causal-answer-markdown">
                        <pre>{answer.answerText}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Run grounding and status</h2>
          <ul className="causal-list">
            <li>Run status: {runDetail.run.status}</li>
            <li>Epistemic verdict: {epistemicVerdict.claimLabel}</li>
            <li>Verdict summary: {epistemicVerdict.summaryText}</li>
            <li>Primary dataset version: {runDetail.run.primaryDatasetVersionId}</li>
            <li>DAG version: {runDetail.run.dagVersionId}</li>
            <li>Treatment: {runDetail.run.treatmentNodeKey}</li>
            <li>Outcome: {runDetail.run.outcomeNodeKey}</li>
            <li>Created: {formatTimestamp(runDetail.run.createdAt)}</li>
            {runDetail.run.startedAt ? <li>Started: {formatTimestamp(runDetail.run.startedAt)}</li> : null}
            {runDetail.run.completedAt ? <li>Completed: {formatTimestamp(runDetail.run.completedAt)}</li> : null}
          </ul>
          {parsedPackage?.question ? (
            <p className="causal-card__copy">
              <strong>Question:</strong> {parsedPackage.question}
            </p>
          ) : null}
          {parsedPackage?.approval ? (
            <div
              style={{
                background: "#eff6ff",
                border: "1px solid rgba(37, 99, 235, 0.18)",
                borderRadius: 12,
                marginTop: 12,
                padding: 12,
              }}
            >
              <p className="causal-card__meta">
                Approved via {parsedPackage.approval.approvalKind ?? "unknown workflow"} on{" "}
                {parsedPackage.approval.createdAt
                  ? formatTimestamp(parsedPackage.approval.createdAt)
                  : "unknown time"}
              </p>
              {parsedPackage.approval.approvalText ? (
                <p className="causal-card__copy">{parsedPackage.approval.approvalText}</p>
              ) : null}
            </div>
          ) : null}
          <details>
            <summary className="causal-card__meta">Raw answer package JSON</summary>
            <div className="causal-answer-markdown">
              <pre>{runDetail.answerPackage?.packageJson ?? "No answer package stored."}</pre>
            </div>
          </details>
        </section>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <h2 className="causal-card__title">Identification and estimates</h2>
          <p className="causal-card__copy">
            Identification status: {identificationStatusLabel}
            {identificationMethod ? ` · method ${identificationMethod}` : ""}
          </p>

          {identificationBlockingReasons.length ? (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid rgba(220, 38, 38, 0.18)",
                borderRadius: 12,
                marginBottom: 12,
                padding: 12,
              }}
            >
              <h3 className="causal-card__title" style={{ color: "#b91c1c", fontSize: 16 }}>
                Blocking reasons
              </h3>
              <ul className="causal-list">
                {identificationBlockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {runDetail.estimates.length ? (
            <ul className="causal-study-list">
              {runDetail.estimates.map((estimate, index) => (
                <li key={estimate.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{index === 0 ? `${estimate.effectName} (primary)` : estimate.effectName}</strong>
                    <span className="causal-study-list__status">{estimate.estimatorName}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    Estimate {formatNumber(estimate.estimateValue)} · std. error {formatNumber(estimate.stdError)}
                  </p>
                  <p className="causal-study-list__meta">
                    95% interval {formatNumber(estimate.confidenceIntervalLow)} to {" "}
                    {formatNumber(estimate.confidenceIntervalHigh)}
                    {estimate.pValue != null ? ` · p-value ${formatNumber(estimate.pValue)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No causal estimate was stored for this run.</p>
          )}

          {runDetail.estimands.length ? (
            <>
              <h3 className="causal-card__title">Identified estimands</h3>
              <ul className="causal-study-list">
                {runDetail.estimands.map((estimand) => (
                  <li key={estimand.id} className="causal-study-list__item">
                    <div className="causal-study-list__header">
                      <strong>{estimand.estimandLabel}</strong>
                      <span className="causal-study-list__status">{estimand.estimandKind}</span>
                    </div>
                    <details>
                      <summary className="causal-card__meta">View estimand expression</summary>
                      <div className="causal-answer-markdown">
                        <pre>{estimand.estimandExpression}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {identificationAdjustmentSet.length ? (
            <>
              <h3 className="causal-card__title">Adjustment set</h3>
              <ul className="causal-list">
                {identificationAdjustmentSet.map((variable) => (
                  <li key={variable}>{variable}</li>
                ))}
              </ul>
            </>
          ) : null}

          <details>
            <summary className="causal-card__meta">Raw identification record</summary>
            <div className="causal-answer-markdown">
              <pre>{JSON.stringify(runDetail.identification, null, 2)}</pre>
            </div>
          </details>
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Assumptions, limitations, and next steps</h2>
          <h3 className="causal-card__title">Assumptions</h3>
          {parsedPackage?.assumptions.length ? (
            <ul className="causal-study-list">
              {parsedPackage.assumptions.map((assumption, index) => (
                <li key={`${assumption.description ?? assumption.assumptionType ?? "assumption"}-${index}`} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{assumption.description ?? assumption.assumptionType ?? "Unnamed assumption"}</strong>
                    <span className="causal-study-list__status">{assumption.status ?? "not labeled"}</span>
                  </div>
                  {assumption.assumptionType ? (
                    <p className="causal-study-list__meta">Type {assumption.assumptionType}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No explicit assumptions were stored.</p>
          )}

          <h3 className="causal-card__title">Limitations</h3>
          {parsedPackage?.limitations.length ? (
            <ul className="causal-list">
              {parsedPackage.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No additional limitations were stored.</p>
          )}

          <h3 className="causal-card__title">Next steps</h3>
          {parsedPackage?.nextSteps.length ? (
            <ul className="causal-list">
              {parsedPackage.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No next steps were stored.</p>
          )}
        </section>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <h2 className="causal-card__title">Refutations</h2>
          {runDetail.refutations.length ? (
            <ul className="causal-study-list">
              {runDetail.refutations.map((refutation) => (
                <li key={refutation.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{refutation.refuterName}</strong>
                    <span className="causal-study-list__status">{refutation.status}</span>
                  </div>
                  <p className="causal-study-list__meta">{refutation.summaryText}</p>
                  <p className="causal-study-list__meta">Recorded {formatTimestamp(refutation.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : parsedPackage?.refutations.length ? (
            <ul className="causal-study-list">
              {parsedPackage.refutations.map((refutation, index) => (
                <li key={`${refutation.refuterName ?? "refutation"}-${index}`} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{refutation.refuterName ?? "Unnamed refuter"}</strong>
                    <span className="causal-study-list__status">{refutation.status ?? "not labeled"}</span>
                  </div>
                  <p className="causal-study-list__meta">{refutation.summaryText ?? "No summary stored."}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No refutation rows were stored for this run.</p>
          )}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Compute history and artifacts</h2>
          {latestComputeRun ? (
            <p className="causal-card__copy">
              Latest compute run: {latestComputeRun.computeKind} via {latestComputeRun.runner} on {latestComputeRun.backend}
              {latestComputeRun.completedAt ? ` · completed ${formatTimestamp(latestComputeRun.completedAt)}` : ""}
            </p>
          ) : null}
          {runDetail.computeRuns.length ? (
            <ul className="causal-study-list">
              {runDetail.computeRuns.map((computeRun) => (
                <li key={computeRun.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{computeRun.computeKind}</strong>
                    <span className="causal-study-list__status">{computeRun.status}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    {computeRun.runner} via {computeRun.backend} · created {formatTimestamp(computeRun.createdAt)}
                    {computeRun.completedAt ? ` · completed ${formatTimestamp(computeRun.completedAt)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No compute runs recorded.</p>
          )}

          {runDetail.artifacts.length ? (
            <>
              <h3 className="causal-card__title">Artifacts</h3>
              <ul className="causal-study-list">
                {runDetail.artifacts.map((artifact) => (
                  <li key={artifact.id} className="causal-study-list__item">
                    <div className="causal-study-list__header">
                      <strong>{artifact.fileName}</strong>
                      <span className="causal-study-list__status">{artifact.artifactKind}</span>
                    </div>
                    <p className="causal-study-list__meta">
                      Stored {formatTimestamp(artifact.createdAt)} · {artifact.mimeType}
                    </p>
                    <p className="causal-card__meta">
                      <a className="causal-study-list__link" href={artifact.downloadPath}>
                        Download artifact
                      </a>
                    </p>
                    <details>
                      <summary className="causal-card__meta">View storage path</summary>
                      <div className="causal-answer-markdown">
                        <pre>{artifact.storagePath}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="causal-card__empty">No artifacts were stored for this run.</p>
          )}
        </section>
      </div>
    </section>
  );
}
