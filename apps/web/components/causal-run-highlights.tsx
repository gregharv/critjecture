import Link from "next/link";

type CausalRunSummary = {
  adjustmentSet: string[];
  answerCount: number;
  artifactCount: number;
  completedAt: number | null;
  createdAt: number;
  id: string;
  identificationMethod: string | null;
  identified: boolean | null;
  primaryEstimateValue: number | null;
  refutationCount: number;
  status: string;
};

type RunHighlight = {
  description: string;
  label: string;
  run: CausalRunSummary | null;
};

type CausalRunHighlightsProps = {
  comparisonBaseRunId: string;
  comparisonTargetRunId: string;
  formatLabel: (value: string) => string;
  formatNumber: (value: number | null, digits?: number) => string;
  formatPreviewList: (values: string[], emptyLabel: string, limit?: number) => string;
  formatTimestamp: (timestamp: number) => string;
  onCompareAgainstHighlight: (runId: string) => void;
  onSetComparisonBaseline: (runId: string) => void;
  runHighlights: RunHighlight[];
  runsLength: number;
  studyId: string;
};

export function CausalRunHighlights({
  comparisonBaseRunId,
  comparisonTargetRunId,
  formatLabel,
  formatNumber,
  formatPreviewList,
  formatTimestamp,
  onCompareAgainstHighlight,
  onSetComparisonBaseline,
  runHighlights,
  runsLength,
  studyId,
}: CausalRunHighlightsProps) {
  if (!runHighlights.length) {
    return null;
  }

  return (
    <div className="causal-grid" style={{ marginTop: 16 }}>
      {runHighlights.map((highlight) => (
        <section key={highlight.label} className="causal-card">
          <div className="causal-card__header-row">
            <div>
              <p className="causal-card__meta">{highlight.label}</p>
              {highlight.run ? (
                <strong>
                  <Link className="causal-study-list__link" href={`/causal/studies/${studyId}/runs/${highlight.run.id}`}>
                    {highlight.run.id}
                  </Link>
                </strong>
              ) : (
                <strong>No matching run</strong>
              )}
            </div>
            {highlight.run ? (
              <span className="causal-study-list__status">{formatLabel(highlight.run.status)}</span>
            ) : null}
          </div>
          <p className="causal-card__copy">{highlight.description}</p>
          {highlight.run ? (
            <>
              <p className="causal-card__meta">
                Started {formatTimestamp(highlight.run.createdAt)}
                {highlight.run.completedAt
                  ? ` · completed ${formatTimestamp(highlight.run.completedAt)}`
                  : " · still running or packaging"}
              </p>
              <p className="causal-card__meta">
                {highlight.run.identified == null
                  ? "Identification pending"
                  : highlight.run.identified
                    ? "Identified"
                    : "Not identified"}
                {highlight.run.identificationMethod
                  ? ` · ${formatLabel(highlight.run.identificationMethod)}`
                  : ""}
                {highlight.run.primaryEstimateValue != null
                  ? ` · estimate ${formatNumber(highlight.run.primaryEstimateValue)}`
                  : ""}
              </p>
              <p className="causal-card__meta">
                {highlight.run.refutationCount} refutations · {highlight.run.answerCount} answers · {highlight.run.artifactCount} artifacts
              </p>
              <p className="causal-card__meta">
                Adjustment set: {formatPreviewList(highlight.run.adjustmentSet, "not recorded")}
              </p>
              <div className="causal-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                <Link className="causal-study-list__link" href={`/causal/studies/${studyId}/runs/${highlight.run.id}`}>
                  Open run
                </Link>
                <a className="causal-study-list__link" href={`/api/causal/runs/${highlight.run.id}/export`}>
                  Export
                </a>
                {runsLength >= 2 ? (
                  <>
                    <button
                      className="causal-inline-button"
                      onClick={() => onSetComparisonBaseline(highlight.run!.id)}
                      type="button"
                    >
                      {comparisonBaseRunId === highlight.run.id ? "Baseline selected" : "Use as baseline"}
                    </button>
                    <button
                      className="causal-inline-button"
                      onClick={() => onCompareAgainstHighlight(highlight.run!.id)}
                      type="button"
                    >
                      {comparisonTargetRunId === highlight.run.id ? "Comparison selected" : "Use as comparison"}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <p className="causal-card__empty">No run in this study matches that highlight yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
