import Link from "next/link";

type AnalysisRunSummary = {
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
  run: AnalysisRunSummary | null;
};

type AnalysisRunHighlightsProps = {
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

export function AnalysisRunHighlights({
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
}: AnalysisRunHighlightsProps) {
  if (!runHighlights.length) {
    return null;
  }

  return (
    <div className="analysis-grid" style={{ marginTop: 16 }}>
      {runHighlights.map((highlight) => (
        <section key={highlight.label} className="analysis-card">
          <div className="analysis-card__header-row">
            <div>
              <p className="analysis-card__meta">{highlight.label}</p>
              {highlight.run ? (
                <strong>
                  <Link className="analysis-study-list__link" href={`/analysis/studies/${studyId}/runs/${highlight.run.id}`}>
                    {highlight.run.id}
                  </Link>
                </strong>
              ) : (
                <strong>No matching run</strong>
              )}
            </div>
            {highlight.run ? (
              <span className="analysis-study-list__status">{formatLabel(highlight.run.status)}</span>
            ) : null}
          </div>
          <p className="analysis-card__copy">{highlight.description}</p>
          {highlight.run ? (
            <>
              <p className="analysis-card__meta">
                Started {formatTimestamp(highlight.run.createdAt)}
                {highlight.run.completedAt
                  ? ` · completed ${formatTimestamp(highlight.run.completedAt)}`
                  : " · still running or packaging"}
              </p>
              <p className="analysis-card__meta">
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
              <p className="analysis-card__meta">
                {highlight.run.refutationCount} refutations · {highlight.run.answerCount} answers · {highlight.run.artifactCount} artifacts
              </p>
              <p className="analysis-card__meta">
                Adjustment set: {formatPreviewList(highlight.run.adjustmentSet, "not recorded")}
              </p>
              <div className="analysis-inline-actions" style={{ marginTop: 8, rowGap: 8 }}>
                <Link className="analysis-study-list__link" href={`/analysis/studies/${studyId}/runs/${highlight.run.id}`}>
                  Open run
                </Link>
                <a className="analysis-study-list__link" href={`/api/analysis/runs/${highlight.run.id}/export`}>
                  Export
                </a>
                {runsLength >= 2 ? (
                  <>
                    <button
                      className="analysis-inline-button"
                      onClick={() => onSetComparisonBaseline(highlight.run!.id)}
                      type="button"
                    >
                      {comparisonBaseRunId === highlight.run.id ? "Baseline selected" : "Use as baseline"}
                    </button>
                    <button
                      className="analysis-inline-button"
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
            <p className="analysis-card__empty">No run in this study matches that highlight yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
