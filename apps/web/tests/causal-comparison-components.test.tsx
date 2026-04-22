import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

import { CausalComparisonUtilities } from "@/components/causal-comparison-utilities";
import { CausalComparisonWorkspace } from "@/components/causal-comparison-workspace";
import { CausalRunHighlights } from "@/components/causal-run-highlights";

function formatTimestamp(timestamp: number) {
  return `ts-${timestamp}`;
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatNumber(value: number | null) {
  return value == null ? "not reported" : String(value);
}

function formatPreviewList(values: string[], emptyLabel: string, limit = 3) {
  if (!values.length) {
    return emptyLabel;
  }

  const preview = values.slice(0, limit).join(", ");
  return values.length > limit ? `${preview} +${values.length - limit} more` : preview;
}

function formatComparisonPairLabel(baseRunId: string, targetRunId: string) {
  return `${baseRunId} -> ${targetRunId}`;
}

function buildRun(overrides: Partial<{
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
}> = {}) {
  return {
    adjustmentSet: ["seasonality"],
    answerCount: 1,
    artifactCount: 2,
    blockingReasons: [],
    completedAt: 20,
    createdAt: 10,
    estimandLabels: ["ATE"],
    estimatorName: "dml",
    id: "run-1",
    identificationMethod: "backdoor",
    identified: true,
    outcomeNodeKey: "conversion_rate",
    primaryEstimateIntervalHigh: 1.5,
    primaryEstimateIntervalLow: 0.5,
    primaryEstimateValue: 1,
    refutationCount: 2,
    refuterNames: ["placebo"],
    status: "completed",
    treatmentNodeKey: "discount_rate",
    ...overrides,
  };
}

describe("causal comparison components", () => {
  it("renders comparison utility feedback and account-backed copy", () => {
    const markup = renderToStaticMarkup(
      <CausalComparisonUtilities
        comparisonBaseRunId="run-1"
        comparisonError={null}
        comparisonLastSyncedAt={123}
        comparisonPending={false}
        comparisonPendingAction={null}
        comparisonSnapshots={[
          {
            available: true,
            baseRunId: "run-1",
            id: "snapshot-1",
            name: "Best vs latest",
            pinned: true,
            targetRunId: "run-2",
            updatedAt: 456,
          },
        ]}
        comparisonSuccessMessage="Comparison snapshot saved."
        comparisonTargetRunId="run-2"
        editingComparisonSnapshotId={null}
        formatComparisonPairLabel={formatComparisonPairLabel}
        formatTimestamp={formatTimestamp}
        newComparisonSnapshotName="Best vs latest"
        onApplyComparisonSnapshot={() => undefined}
        onApplyRecentComparison={() => undefined}
        onCancelComparisonSnapshotEdit={() => undefined}
        onClearRecentComparisons={() => undefined}
        onDeleteComparisonSnapshot={() => undefined}
        onDeleteRecentComparison={() => undefined}
        onLoadSnapshotIntoEditor={() => undefined}
        onNewComparisonSnapshotNameChange={() => undefined}
        onSaveComparisonSnapshot={() => undefined}
        onSaveRecentComparisonAsSnapshot={() => undefined}
        onStartRenameComparisonSnapshot={() => undefined}
        onSuggestSnapshotName={() => undefined}
        onTogglePinComparisonSnapshot={() => undefined}
        recentComparisons={[]}
      />,
    );

    expect(markup).toContain("Saved to your account for this study.");
    expect(markup).toContain("Comparison snapshot saved.");
    expect(markup).toContain("Best vs latest");
    expect(markup).toContain("Pinned");
    expect(markup).toContain("run-1 -&gt; run-2");
  });

  it("renders comparison workspace controls and delta summary", () => {
    const baseRun = buildRun({
      adjustmentSet: ["seasonality"],
      id: "run-1",
      primaryEstimateValue: 1,
      refutationCount: 1,
      refuterNames: ["placebo"],
    });
    const targetRun = buildRun({
      adjustmentSet: ["seasonality", "region"],
      answerCount: 3,
      artifactCount: 5,
      estimandLabels: ["ATE", "ATT"],
      id: "run-2",
      primaryEstimateIntervalHigh: 2.5,
      primaryEstimateIntervalLow: 0.25,
      primaryEstimateValue: 2,
      refutationCount: 4,
      refuterNames: ["placebo", "bootstrap"],
      treatmentNodeKey: "price_change",
    });

    const markup = renderToStaticMarkup(
      <CausalComparisonWorkspace
        bestSupportedIdentifiedRun={baseRun}
        comparisonAdjustmentDiff={{ added: ["region"], removed: [] }}
        comparisonBaseRun={baseRun}
        comparisonBaseRunId="run-1"
        comparisonBlockingReasonDiff={{ added: ["missing_confounder"], removed: [] }}
        comparisonError={null}
        comparisonEstimandDiff={{ added: ["ATT"], removed: [] }}
        comparisonLastSyncedAt={789}
        comparisonLinkStatus="copied"
        comparisonPending={false}
        comparisonPendingAction={null}
        comparisonRefuterDiff={{ added: ["bootstrap"], removed: [] }}
        comparisonSnapshots={[]}
        comparisonSuccessMessage={null}
        comparisonTargetRun={targetRun}
        comparisonTargetRunId="run-2"
        editingComparisonSnapshotId={null}
        formatComparisonPairLabel={formatComparisonPairLabel}
        formatLabel={formatLabel}
        formatNumber={formatNumber}
        formatPreviewList={formatPreviewList}
        formatTimestamp={formatTimestamp}
        latestAnswerBearingRun={targetRun}
        latestCompletedRun={targetRun}
        latestRun={targetRun}
        newComparisonSnapshotName=""
        onApplyComparisonSnapshot={() => undefined}
        onApplyRecentComparison={() => undefined}
        onCancelComparisonSnapshotEdit={() => undefined}
        onClearRecentComparisons={() => undefined}
        onCopyComparisonLink={() => undefined}
        onDeleteComparisonSnapshot={() => undefined}
        onDeleteRecentComparison={() => undefined}
        onLoadSnapshotIntoEditor={() => undefined}
        onNewComparisonSnapshotNameChange={() => undefined}
        onOpenComparisonRuns={() => undefined}
        onResetComparisonSelection={() => undefined}
        onSaveComparisonSnapshot={() => undefined}
        onSaveRecentComparisonAsSnapshot={() => undefined}
        onSetComparisonBaseline={() => undefined}
        onSetComparisonPair={() => undefined}
        onSetComparisonTarget={() => undefined}
        onStartRenameComparisonSnapshot={() => undefined}
        onSuggestSnapshotName={() => undefined}
        onSwapComparisonRuns={() => undefined}
        onTogglePinComparisonSnapshot={() => undefined}
        recentComparisons={[]}
        runs={[baseRun, targetRun]}
        studyId="study-1"
      />,
    );

    expect(markup).toContain("Run comparison");
    expect(markup).toContain("Link copied");
    expect(markup).toContain("Export comparison bundle");
    expect(markup).toContain("Compare best identified vs latest completed");
    expect(markup).toContain("Delta summary");
    expect(markup).toContain("Estimate delta: 1");
    expect(markup).toContain("Added in comparison: region");
    expect(markup).toContain("Added in comparison: ATT");
    expect(markup).toContain("Added in comparison: missing_confounder");
    expect(markup).toContain("Added in comparison: bootstrap");
    expect(markup).toContain("Treatment/outcome changed: true");
  });

  it("omits comparison workspace when fewer than two runs exist", () => {
    const markup = renderToStaticMarkup(
      <CausalComparisonWorkspace
        bestSupportedIdentifiedRun={null}
        comparisonAdjustmentDiff={{ added: [], removed: [] }}
        comparisonBaseRun={null}
        comparisonBaseRunId="run-1"
        comparisonBlockingReasonDiff={{ added: [], removed: [] }}
        comparisonError={null}
        comparisonEstimandDiff={{ added: [], removed: [] }}
        comparisonLastSyncedAt={null}
        comparisonLinkStatus={null}
        comparisonPending={false}
        comparisonPendingAction={null}
        comparisonRefuterDiff={{ added: [], removed: [] }}
        comparisonSnapshots={[]}
        comparisonSuccessMessage={null}
        comparisonTargetRun={null}
        comparisonTargetRunId=""
        editingComparisonSnapshotId={null}
        formatComparisonPairLabel={formatComparisonPairLabel}
        formatLabel={formatLabel}
        formatNumber={formatNumber}
        formatPreviewList={formatPreviewList}
        formatTimestamp={formatTimestamp}
        latestAnswerBearingRun={null}
        latestCompletedRun={null}
        latestRun={null}
        newComparisonSnapshotName=""
        onApplyComparisonSnapshot={() => undefined}
        onApplyRecentComparison={() => undefined}
        onCancelComparisonSnapshotEdit={() => undefined}
        onClearRecentComparisons={() => undefined}
        onCopyComparisonLink={() => undefined}
        onDeleteComparisonSnapshot={() => undefined}
        onDeleteRecentComparison={() => undefined}
        onLoadSnapshotIntoEditor={() => undefined}
        onNewComparisonSnapshotNameChange={() => undefined}
        onOpenComparisonRuns={() => undefined}
        onResetComparisonSelection={() => undefined}
        onSaveComparisonSnapshot={() => undefined}
        onSaveRecentComparisonAsSnapshot={() => undefined}
        onSetComparisonBaseline={() => undefined}
        onSetComparisonPair={() => undefined}
        onSetComparisonTarget={() => undefined}
        onStartRenameComparisonSnapshot={() => undefined}
        onSuggestSnapshotName={() => undefined}
        onSwapComparisonRuns={() => undefined}
        onTogglePinComparisonSnapshot={() => undefined}
        recentComparisons={[]}
        runs={[buildRun()]}
        studyId="study-1"
      />,
    );

    expect(markup).toBe("");
  });

  it("renders run highlights with selection affordances", () => {
    const markup = renderToStaticMarkup(
      <CausalRunHighlights
        comparisonBaseRunId="run-1"
        comparisonTargetRunId="run-2"
        formatLabel={formatLabel}
        formatNumber={formatNumber}
        formatPreviewList={formatPreviewList}
        formatTimestamp={formatTimestamp}
        onCompareAgainstHighlight={() => undefined}
        onSetComparisonBaseline={() => undefined}
        runHighlights={[
          {
            description: "Most recently created run.",
            label: "Latest run",
            run: buildRun({ id: "run-1" }),
          },
          {
            description: "No matching run available.",
            label: "Latest completed",
            run: null,
          },
        ]}
        runsLength={2}
        studyId="study-1"
      />,
    );

    expect(markup).toContain("Latest run");
    expect(markup).toContain("Baseline selected");
    expect(markup).toContain("Use as comparison");
    expect(markup).toContain("No matching run");
    expect(markup).toContain("No run in this study matches that highlight yet.");
  });
});
