import { describe, expect, it } from "vitest";

import {
  buildPredictiveWorkspaceNextStepRecommendation,
  buildPredictiveWorkspaceStatusAssistantSummary,
} from "@/lib/predictive-workspace-status-messages";

describe("predictive workspace status assistant summary", () => {
  it("summarizes a completed predictive run for chat follow-up", () => {
    const summary = buildPredictiveWorkspaceStatusAssistantSummary({
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
      workspaceHref: "/predictive?datasetVersionId=dataset-version-1",
    });

    expect(summary).toContain("INSTRUMENTAL / HEURISTIC PREDICTION");
    expect(summary).toContain("Your predictive run for bookings has completed.");
    expect(summary).toContain("Metric highlights: mape: 0.1120; rmse: 21.4000.");
    expect(summary).toContain("not as a causal conclusion");
    expect(summary).toContain("forecast quality looks useful for planning");
    expect(summary).toContain("changed a policy, treatment, price, or intervention");
  });

  it("summarizes a workspace-ready predictive setup for chat follow-up", () => {
    const summary = buildPredictiveWorkspaceStatusAssistantSummary({
      claimLabel: null,
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      metricHighlights: [],
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      runId: null,
      status: "workspace_ready",
      summary: null,
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
      workspaceHref: "/predictive?datasetVersionId=dataset-version-1",
    });

    expect(summary).toContain("DESCRIPTIVE");
    expect(summary).toContain("Your predictive setup is ready in the workspace with target bookings, task regression, horizon 14 days.");
    expect(summary).toContain("Current feature candidates: discount_rate, seasonality.");
    expect(summary).toContain("Run the predictive analysis if the setup is ready");
  });

  it("recommends refinement when predictive classification signal is weak", () => {
    const recommendation = buildPredictiveWorkspaceNextStepRecommendation({
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
      workspaceHref: "/predictive?datasetVersionId=dataset-version-1",
    });

    expect(recommendation).toContain("predictive signal looks weak");
    expect(recommendation).toContain("revisit the target, horizon, feature set, and data quality");
  });
});
