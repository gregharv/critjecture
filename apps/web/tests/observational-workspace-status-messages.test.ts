import { describe, expect, it } from "vitest";

import {
  buildObservationalWorkspaceNextStepRecommendation,
  buildObservationalWorkspaceStatusAssistantSummary,
} from "@/lib/observational-workspace-status-messages";

describe("observational workspace status assistant summary", () => {
  it("summarizes a completed observational run for chat follow-up", () => {
    const summary = buildObservationalWorkspaceStatusAssistantSummary({
      claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      metricHighlights: ["mape: 0.1120", "rmse: 21.4000"],
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      runId: "predictive-run-1",
      status: "run_completed",
      summary: "Bookings are most sensitive to discounting and seasonal demand.",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
      workspaceHref: "/analysis/observational?datasetVersionId=dataset-version-1",
    });

    expect(summary).toContain("Your observational run for bookings has completed.");
    expect(summary).toContain("forecast quality looks useful for planning");
  });

  it("recommends refinement when observational classification signal is weak", () => {
    const recommendation = buildObservationalWorkspaceNextStepRecommendation({
      claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: null,
      forecastHorizonValue: null,
      metricHighlights: ["roc_auc: 0.5900"],
      planningNote: null,
      preset: "standard",
      runId: "predictive-run-1",
      status: "run_completed",
      summary: "Current signal is limited.",
      targetColumn: "conversion_rate",
      taskKind: "classification",
      timeColumn: null,
      workspaceHref: "/analysis/observational?datasetVersionId=dataset-version-1",
    });

    expect(recommendation).toContain("predictive signal looks weak");
  });
});
