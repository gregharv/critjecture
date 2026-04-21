"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
    fileName: string;
    id: string;
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

function parseAnswerPackage(packageJson: string | null | undefined): ParsedAnswerPackage | null {
  if (!packageJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(packageJson) as Partial<ParsedAnswerPackage>;
    return {
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      approval: parsed.approval ?? null,
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

  async function refreshRun() {
    const response = await fetch(`/api/causal/runs/${runDetail.run.id}`, {
      cache: "no-store",
    });
    const json = (await response.json()) as unknown;

    if (!response.ok) {
      throw new Error(getErrorMessage(json, "Failed to refresh causal run."));
    }

    setRunDetail(json as RunDetail);
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
        <p className="causal-card__meta">
          <Link className="causal-study-list__link" href={`/causal/studies/${study.id}`}>
            ← Back to study workspace
          </Link>
        </p>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <div className="causal-card__header-row">
            <h2 className="causal-card__title">Grounded final answer</h2>
            <button
              className="causal-intake-form__submit"
              disabled={pending || !runDetail.answerPackage}
              onClick={() => void handleGenerateAnswer()}
              type="button"
            >
              {pending ? "Generating…" : "Generate grounded answer"}
            </button>
          </div>
          <p className="causal-card__copy">
            Final answers are rendered from the stored causal answer package only. No direct dataset
            analysis is available on this path.
          </p>
          {error ? <p className="causal-intake-form__error">{error}</p> : null}
          {latestAnswer ? (
            <article className="causal-answer-markdown">
              <pre>{latestAnswer.answerText}</pre>
            </article>
          ) : (
            <p className="causal-card__empty">
              No grounded answer generated yet. Create one after the run finishes packaging.
            </p>
          )}
          {runDetail.answers.length ? (
            <ul className="causal-study-list">
              {runDetail.answers.map((answer) => (
                <li key={answer.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{answer.id}</strong>
                    <span className="causal-study-list__status">{answer.modelName}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    Generated {formatTimestamp(answer.createdAt)} · prompt {answer.promptVersion}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Run grounding and status</h2>
          <ul className="causal-list">
            <li>Run status: {runDetail.run.status}</li>
            <li>Primary dataset version: {runDetail.run.primaryDatasetVersionId}</li>
            <li>DAG version: {runDetail.run.dagVersionId}</li>
            <li>Treatment: {runDetail.run.treatmentNodeKey}</li>
            <li>Outcome: {runDetail.run.outcomeNodeKey}</li>
            <li>Created: {formatTimestamp(runDetail.run.createdAt)}</li>
            {runDetail.run.completedAt ? <li>Completed: {formatTimestamp(runDetail.run.completedAt)}</li> : null}
          </ul>
          {parsedPackage?.question ? (
            <p className="causal-card__copy">
              <strong>Question:</strong> {parsedPackage.question}
            </p>
          ) : null}
          {parsedPackage?.approval ? (
            <p className="causal-card__meta">
              Approved via {parsedPackage.approval.approvalKind} on{" "}
              {parsedPackage.approval.createdAt
                ? formatTimestamp(parsedPackage.approval.createdAt)
                : "unknown time"}
            </p>
          ) : null}
        </section>
      </div>

      <div className="causal-grid">
        <section className="causal-card">
          <h2 className="causal-card__title">Identification and estimate</h2>
          <p className="causal-card__copy">
            Identification status: {parsedPackage?.identification?.statusLabel ?? "not recorded"}
            {parsedPackage?.identification?.method ? ` · method ${parsedPackage.identification.method}` : ""}
          </p>
          {runDetail.estimates.length ? (
            <ul className="causal-study-list">
              {runDetail.estimates.map((estimate) => (
                <li key={estimate.id} className="causal-study-list__item">
                  <div className="causal-study-list__header">
                    <strong>{estimate.effectName}</strong>
                    <span className="causal-study-list__status">{estimate.estimatorName}</span>
                  </div>
                  <p className="causal-study-list__meta">
                    Estimate {formatNumber(estimate.estimateValue)} · std. error {formatNumber(estimate.stdError)}
                  </p>
                  <p className="causal-study-list__meta">
                    95% interval {formatNumber(estimate.confidenceIntervalLow)} to{" "}
                    {formatNumber(estimate.confidenceIntervalHigh)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No causal estimate was stored for this run.</p>
          )}
          {parsedPackage?.identification?.adjustmentSet?.length ? (
            <>
              <h3 className="causal-card__title">Adjustment set</h3>
              <ul className="causal-list">
                {parsedPackage.identification.adjustmentSet.map((variable) => (
                  <li key={variable}>{variable}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Assumptions and limitations</h2>
          <h3 className="causal-card__title">Assumptions</h3>
          {parsedPackage?.assumptions.length ? (
            <ul className="causal-list">
              {parsedPackage.assumptions.map((assumption, index) => (
                <li key={`${assumption.description ?? assumption.assumptionType ?? "assumption"}-${index}`}>
                  {assumption.description ?? assumption.assumptionType ?? "Unnamed assumption"}
                  {assumption.status ? ` (${assumption.status})` : ""}
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
                </li>
              ))}
            </ul>
          ) : (
            <p className="causal-card__empty">No refutation rows were stored for this run.</p>
          )}
        </section>

        <section className="causal-card">
          <h2 className="causal-card__title">Compute history and artifacts</h2>
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
              <ul className="causal-list">
                {runDetail.artifacts.map((artifact) => (
                  <li key={artifact.id}>
                    {artifact.fileName} · {artifact.artifactKind}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}
