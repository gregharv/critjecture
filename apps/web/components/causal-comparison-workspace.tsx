import Link from "next/link";

import { CausalComparisonUtilities } from "@/components/causal-comparison-utilities";

type CausalRunSummary = {
  adjustmentSet: string[];
  answerCount: number;
  artifactCount: number;
  blockingReasons: string[];
  completedAt: number | null;
  createdAt: number;
  estimandLabels: string[];
  estimatorName: string | null;
  id: string;
  identificationMethod: string | null;
  identified: boolean | null;
  outcomeNodeKey: string;
  primaryEstimateIntervalHigh: number | null;
  primaryEstimateIntervalLow: number | null;
  primaryEstimateValue: number | null;
  refutationCount: number;
  refuterNames: string[];
  status: string;
  treatmentNodeKey: string;
};

type ComparisonSnapshotRow = {
  available: boolean;
  baseRunId: string;
  id: string;
  name: string;
  pinned: boolean;
  targetRunId: string;
  updatedAt: number;
};

type RecentComparisonRow = {
  available: boolean;
  baseRunId: string;
  id: string;
  targetRunId: string;
  updatedAt: number;
};

type CausalComparisonWorkspaceProps = {
  bestSupportedIdentifiedRun: CausalRunSummary | null;
  comparisonAdjustmentDiff: { added: string[]; removed: string[] };
  comparisonBaseRun: CausalRunSummary | null;
  comparisonBaseRunId: string;
  comparisonBlockingReasonDiff: { added: string[]; removed: string[] };
  comparisonError: string | null;
  comparisonEstimandDiff: { added: string[]; removed: string[] };
  comparisonLastSyncedAt: number | null;
  comparisonLinkStatus: null | "copied" | "failed";
  comparisonPending: boolean;
  comparisonPendingAction: string | null;
  comparisonRefuterDiff: { added: string[]; removed: string[] };
  comparisonSnapshots: ComparisonSnapshotRow[];
  comparisonSuccessMessage: string | null;
  comparisonTargetRun: CausalRunSummary | null;
  comparisonTargetRunId: string;
  editingComparisonSnapshotId: string | null;
  formatComparisonPairLabel: (baseRunId: string, targetRunId: string) => string;
  formatLabel: (value: string) => string;
  formatNumber: (value: number | null, digits?: number) => string;
  formatPreviewList: (values: string[], emptyLabel: string, limit?: number) => string;
  formatTimestamp: (timestamp: number) => string;
  latestAnswerBearingRun: CausalRunSummary | null;
  latestCompletedRun: CausalRunSummary | null;
  latestRun: CausalRunSummary | null;
  newComparisonSnapshotName: string;
  onApplyComparisonSnapshot: (snapshotId: string) => void;
  onApplyRecentComparison: (entryId: string) => void;
  onCancelComparisonSnapshotEdit: () => void;
  onClearRecentComparisons: () => void;
  onCopyComparisonLink: () => void;
  onDeleteComparisonSnapshot: (snapshotId: string) => void;
  onDeleteRecentComparison: (entryId: string) => void;
  onLoadSnapshotIntoEditor: (snapshot: { baseRunId: string; name: string; targetRunId: string }) => void;
  onNewComparisonSnapshotNameChange: (value: string) => void;
  onOpenComparisonRuns: () => void;
  onSaveComparisonSnapshot: () => void;
  onSaveRecentComparisonAsSnapshot: (entryId: string) => void;
  onSetComparisonBaseline: (runId: string) => void;
  onSetComparisonPair: (baseRunId: string, targetRunId: string) => void;
  onSetComparisonTarget: (runId: string) => void;
  onStartRenameComparisonSnapshot: (snapshotId: string) => void;
  onSuggestSnapshotName: (value: string) => void;
  onSwapComparisonRuns: () => void;
  onTogglePinComparisonSnapshot: (snapshotId: string) => void;
  onResetComparisonSelection: () => void;
  recentComparisons: RecentComparisonRow[];
  runs: CausalRunSummary[];
  studyId: string;
};

const COMPARISON_PANEL_STYLE = {
  background: "#f8fafc",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 16,
  display: "grid",
  gap: 12,
  marginBottom: 16,
  padding: 16,
} as const;

function areStringSetsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSorted = [...left].sort((a, b) => a.localeCompare(b));
  const rightSorted = [...right].sort((a, b) => a.localeCompare(b));

  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function CausalComparisonWorkspace({
  bestSupportedIdentifiedRun,
  comparisonAdjustmentDiff,
  comparisonBaseRun,
  comparisonBaseRunId,
  comparisonBlockingReasonDiff,
  comparisonError,
  comparisonEstimandDiff,
  comparisonLastSyncedAt,
  comparisonLinkStatus,
  comparisonPending,
  comparisonPendingAction,
  comparisonRefuterDiff,
  comparisonSnapshots,
  comparisonSuccessMessage,
  comparisonTargetRun,
  comparisonTargetRunId,
  editingComparisonSnapshotId,
  formatComparisonPairLabel,
  formatLabel,
  formatNumber,
  formatPreviewList,
  formatTimestamp,
  latestAnswerBearingRun,
  latestCompletedRun,
  latestRun,
  newComparisonSnapshotName,
  onApplyComparisonSnapshot,
  onApplyRecentComparison,
  onCancelComparisonSnapshotEdit,
  onClearRecentComparisons,
  onCopyComparisonLink,
  onDeleteComparisonSnapshot,
  onDeleteRecentComparison,
  onLoadSnapshotIntoEditor,
  onNewComparisonSnapshotNameChange,
  onOpenComparisonRuns,
  onSaveComparisonSnapshot,
  onSaveRecentComparisonAsSnapshot,
  onSetComparisonBaseline,
  onSetComparisonPair,
  onSetComparisonTarget,
  onStartRenameComparisonSnapshot,
  onSuggestSnapshotName,
  onSwapComparisonRuns,
  onTogglePinComparisonSnapshot,
  onResetComparisonSelection,
  recentComparisons,
  runs,
  studyId,
}: CausalComparisonWorkspaceProps) {
  if (runs.length < 2) {
    return null;
  }

  return (
    <div aria-busy={comparisonPending} style={COMPARISON_PANEL_STYLE}>
      <div className="causal-card__header-row">
        <h3 className="causal-card__title" style={{ fontSize: 16 }}>Run comparison</h3>
        <div className="causal-inline-actions">
          <span className="causal-card__meta">Compare identification and estimate changes across runs. The current pair stays encoded in the URL.</span>
          {comparisonBaseRunId && comparisonTargetRunId ? (
            <>
              <button className="causal-inline-button" onClick={onCopyComparisonLink} type="button">
                {comparisonLinkStatus === "copied"
                  ? "Link copied"
                  : comparisonLinkStatus === "failed"
                    ? "Copy failed"
                    : "Copy comparison link"}
              </button>
              <a
                className="causal-study-list__link"
                href={`/api/causal/studies/${studyId}/compare-export?baseRunId=${encodeURIComponent(comparisonBaseRunId)}&targetRunId=${encodeURIComponent(comparisonTargetRunId)}`}
              >
                Export comparison bundle
              </a>
            </>
          ) : null}
        </div>
      </div>
      <div className="causal-inline-form">
        <select
          aria-label="Baseline run"
          className="causal-select"
          disabled={comparisonPending}
          onChange={(event) => onSetComparisonBaseline(event.target.value)}
          value={comparisonBaseRunId}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              Baseline · {run.id} · {formatLabel(run.status)}
            </option>
          ))}
        </select>
        <select
          aria-label="Comparison run"
          className="causal-select"
          disabled={comparisonPending}
          onChange={(event) => onSetComparisonTarget(event.target.value)}
          value={comparisonTargetRunId}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              Comparison · {run.id} · {formatLabel(run.status)}
            </option>
          ))}
        </select>
      </div>
      <div className="causal-inline-actions">
        <button
          className="causal-inline-button"
          disabled={comparisonPending || !comparisonBaseRunId || !comparisonTargetRunId}
          onClick={onSwapComparisonRuns}
          type="button"
        >
          Swap baseline/comparison
        </button>
        <button
          className="causal-inline-button"
          disabled={comparisonPending || !comparisonBaseRunId || !comparisonTargetRunId}
          onClick={onResetComparisonSelection}
          type="button"
        >
          Reset comparison
        </button>
        <button
          className="causal-inline-button"
          disabled={comparisonPending || !comparisonBaseRunId || !comparisonTargetRunId}
          onClick={onOpenComparisonRuns}
          type="button"
        >
          Open both runs
        </button>
      </div>
      <div className="causal-inline-actions">
        {bestSupportedIdentifiedRun ? (
          <button
            className="causal-inline-button"
            disabled={comparisonPending}
            onClick={() => onSetComparisonBaseline(bestSupportedIdentifiedRun.id)}
            type="button"
          >
            Baseline ← best identified
          </button>
        ) : null}
        {latestCompletedRun ? (
          <button
            className="causal-inline-button"
            disabled={comparisonPending}
            onClick={() => onSetComparisonTarget(latestCompletedRun.id)}
            type="button"
          >
            Comparison ← latest completed
          </button>
        ) : null}
        {bestSupportedIdentifiedRun && latestCompletedRun && bestSupportedIdentifiedRun.id !== latestCompletedRun.id ? (
          <button
            className="causal-inline-button"
            disabled={comparisonPending}
            onClick={() => onSetComparisonPair(bestSupportedIdentifiedRun.id, latestCompletedRun.id)}
            type="button"
          >
            Compare best identified vs latest completed
          </button>
        ) : null}
        {latestRun && latestAnswerBearingRun && latestRun.id !== latestAnswerBearingRun.id ? (
          <button
            className="causal-inline-button"
            disabled={comparisonPending}
            onClick={() => onSetComparisonPair(latestRun.id, latestAnswerBearingRun.id)}
            type="button"
          >
            Compare latest run vs latest answer-bearing
          </button>
        ) : null}
      </div>
      <CausalComparisonUtilities
        comparisonBaseRunId={comparisonBaseRunId}
        comparisonError={comparisonError}
        comparisonLastSyncedAt={comparisonLastSyncedAt}
        comparisonPending={comparisonPending}
        comparisonPendingAction={comparisonPendingAction}
        comparisonSnapshots={comparisonSnapshots}
        comparisonSuccessMessage={comparisonSuccessMessage}
        comparisonTargetRunId={comparisonTargetRunId}
        editingComparisonSnapshotId={editingComparisonSnapshotId}
        formatComparisonPairLabel={formatComparisonPairLabel}
        formatTimestamp={formatTimestamp}
        newComparisonSnapshotName={newComparisonSnapshotName}
        onApplyComparisonSnapshot={onApplyComparisonSnapshot}
        onApplyRecentComparison={onApplyRecentComparison}
        onCancelComparisonSnapshotEdit={onCancelComparisonSnapshotEdit}
        onClearRecentComparisons={onClearRecentComparisons}
        onDeleteComparisonSnapshot={onDeleteComparisonSnapshot}
        onDeleteRecentComparison={onDeleteRecentComparison}
        onLoadSnapshotIntoEditor={onLoadSnapshotIntoEditor}
        onNewComparisonSnapshotNameChange={onNewComparisonSnapshotNameChange}
        onSaveComparisonSnapshot={onSaveComparisonSnapshot}
        onSaveRecentComparisonAsSnapshot={onSaveRecentComparisonAsSnapshot}
        onStartRenameComparisonSnapshot={onStartRenameComparisonSnapshot}
        onSuggestSnapshotName={onSuggestSnapshotName}
        onTogglePinComparisonSnapshot={onTogglePinComparisonSnapshot}
        recentComparisons={recentComparisons}
      />
      {comparisonBaseRun && comparisonTargetRun ? (
        <div className="causal-grid" style={{ marginTop: 0 }}>
          {[comparisonBaseRun, comparisonTargetRun].map((run, index) => (
            <section key={run.id} className="causal-card">
              <div className="causal-card__header-row">
                <strong>{index === 0 ? "Baseline" : "Comparison"}</strong>
                <span className="causal-study-list__status">{formatLabel(run.status)}</span>
              </div>
              <p className="causal-card__meta">
                <Link className="causal-study-list__link" href={`/causal/studies/${studyId}/runs/${run.id}`}>
                  {run.id}
                </Link>
              </p>
              <ul className="causal-list">
                <li>Identification: {run.identified == null ? "not recorded" : run.identified ? "identified" : "not identified"}</li>
                <li>Method: {run.identificationMethod ? formatLabel(run.identificationMethod) : "not recorded"}</li>
                <li>Estimator: {run.estimatorName ? formatLabel(run.estimatorName) : "not recorded"}</li>
                <li>Primary estimate: {formatNumber(run.primaryEstimateValue)}</li>
                <li>
                  Interval: {typeof run.primaryEstimateIntervalLow === "number" && typeof run.primaryEstimateIntervalHigh === "number"
                    ? `${formatNumber(run.primaryEstimateIntervalLow)} to ${formatNumber(run.primaryEstimateIntervalHigh)}`
                    : "not reported"}
                </li>
                <li>Refutations: {run.refutationCount}</li>
                <li>Answers: {run.answerCount}</li>
                <li>Artifacts: {run.artifactCount}</li>
              </ul>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                <div>
                  <strong className="causal-card__meta">Adjustment set</strong>
                  {run.adjustmentSet.length ? (
                    <ul className="causal-list">
                      {run.adjustmentSet.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="causal-card__meta">No stored adjustment set.</p>
                  )}
                </div>
                <div>
                  <strong className="causal-card__meta">Estimands</strong>
                  {run.estimandLabels.length ? (
                    <ul className="causal-list">
                      {run.estimandLabels.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="causal-card__meta">No stored estimands.</p>
                  )}
                </div>
                <div>
                  <strong className="causal-card__meta">Blocking reasons</strong>
                  {run.blockingReasons.length ? (
                    <ul className="causal-list">
                      {run.blockingReasons.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="causal-card__meta">No stored blocking reasons.</p>
                  )}
                </div>
                <div>
                  <strong className="causal-card__meta">Refuters</strong>
                  {run.refuterNames.length ? (
                    <ul className="causal-list">
                      {run.refuterNames.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="causal-card__meta">No stored refuters.</p>
                  )}
                </div>
              </div>
            </section>
          ))}
          <section className="causal-card">
            <h3 className="causal-card__title">Delta summary</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <strong className="causal-card__meta">Headline changes</strong>
                <ul className="causal-list">
                  <li>Identification changed: {String(comparisonBaseRun.identified !== comparisonTargetRun.identified)}</li>
                  <li>Method changed: {String(comparisonBaseRun.identificationMethod !== comparisonTargetRun.identificationMethod)}</li>
                  <li>Estimator changed: {String(comparisonBaseRun.estimatorName !== comparisonTargetRun.estimatorName)}</li>
                  <li>
                    Estimate delta: {typeof comparisonBaseRun.primaryEstimateValue === "number" && typeof comparisonTargetRun.primaryEstimateValue === "number"
                      ? formatNumber(comparisonTargetRun.primaryEstimateValue - comparisonBaseRun.primaryEstimateValue)
                      : "not computable"}
                  </li>
                  <li>
                    Interval changed: {String(
                      comparisonBaseRun.primaryEstimateIntervalLow !== comparisonTargetRun.primaryEstimateIntervalLow ||
                        comparisonBaseRun.primaryEstimateIntervalHigh !== comparisonTargetRun.primaryEstimateIntervalHigh,
                    )}
                  </li>
                  <li>
                    Treatment/outcome changed: {String(
                      comparisonBaseRun.treatmentNodeKey !== comparisonTargetRun.treatmentNodeKey ||
                        comparisonBaseRun.outcomeNodeKey !== comparisonTargetRun.outcomeNodeKey,
                    )}
                  </li>
                </ul>
              </div>

              <div>
                <strong className="causal-card__meta">Support deltas</strong>
                <ul className="causal-list">
                  <li>Refutation delta: {comparisonTargetRun.refutationCount - comparisonBaseRun.refutationCount}</li>
                  <li>Answer delta: {comparisonTargetRun.answerCount - comparisonBaseRun.answerCount}</li>
                  <li>Artifact delta: {comparisonTargetRun.artifactCount - comparisonBaseRun.artifactCount}</li>
                </ul>
              </div>

              <div>
                <strong className="causal-card__meta">Adjustment set diff</strong>
                <ul className="causal-list">
                  <li>Changed: {String(!areStringSetsEqual(comparisonBaseRun.adjustmentSet, comparisonTargetRun.adjustmentSet))}</li>
                  <li>Added in comparison: {formatPreviewList(comparisonAdjustmentDiff.added, "none")}</li>
                  <li>Removed from baseline: {formatPreviewList(comparisonAdjustmentDiff.removed, "none")}</li>
                </ul>
              </div>

              <div>
                <strong className="causal-card__meta">Estimand diff</strong>
                <ul className="causal-list">
                  <li>Changed: {String(!areStringSetsEqual(comparisonBaseRun.estimandLabels, comparisonTargetRun.estimandLabels))}</li>
                  <li>Added in comparison: {formatPreviewList(comparisonEstimandDiff.added, "none")}</li>
                  <li>Removed from baseline: {formatPreviewList(comparisonEstimandDiff.removed, "none")}</li>
                </ul>
              </div>

              <div>
                <strong className="causal-card__meta">Blocking reason diff</strong>
                <ul className="causal-list">
                  <li>Changed: {String(!areStringSetsEqual(comparisonBaseRun.blockingReasons, comparisonTargetRun.blockingReasons))}</li>
                  <li>Added in comparison: {formatPreviewList(comparisonBlockingReasonDiff.added, "none")}</li>
                  <li>Removed from baseline: {formatPreviewList(comparisonBlockingReasonDiff.removed, "none")}</li>
                </ul>
              </div>

              <div>
                <strong className="causal-card__meta">Refuter diff</strong>
                <ul className="causal-list">
                  <li>Changed: {String(!areStringSetsEqual(comparisonBaseRun.refuterNames, comparisonTargetRun.refuterNames))}</li>
                  <li>Added in comparison: {formatPreviewList(comparisonRefuterDiff.added, "none")}</li>
                  <li>Removed from baseline: {formatPreviewList(comparisonRefuterDiff.removed, "none")}</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
