import { describe, expect, it } from "vitest";

import {
  buildObservationalChatReturnHref,
  buildObservationalWorkspaceHref,
  parseObservationalChatReturn,
  parseObservationalWorkspaceHandoff,
  summarizeObservationalWorkspaceHandoff,
} from "@/lib/observational-handoff";

describe("observational workspace handoff", () => {
  it("builds and parses the canonical observational workspace handoff", () => {
    const href = buildObservationalWorkspaceHref({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      returnToChat: "/chat?conversation=conversation-1",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
    });

    expect(href).toContain("/analysis/observational?");

    const params = new URLSearchParams(href.split("?")[1]);
    expect(parseObservationalWorkspaceHandoff(params)).toEqual({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      returnToChat: "/chat?conversation=conversation-1",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
    });
  });

  it("builds observational chat return links and summaries", () => {
    const href = buildObservationalChatReturnHref({
      claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      metricHighlights: ["mape: 0.1120", "rmse: 21.4000"],
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      returnToChat: "/chat?conversation=conversation-1",
      runId: "predictive-run-1",
      status: "run_completed",
      summary: "Bookings are most sensitive to discounting and seasonal demand.",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
      workspaceHref: "/analysis/observational?datasetVersionId=dataset-version-1",
    });

    expect(href).toContain("observationalChatStatus=run_completed");
    expect(href).toContain("observationalRunId=predictive-run-1");
    expect(parseObservationalChatReturn(new URLSearchParams(href.split("?")[1]))?.status).toBe("run_completed");

    const summary = summarizeObservationalWorkspaceHandoff({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      openInNewTab: true,
      planningNote: "Forecast weekly bookings for the executive review.",
      preset: "forecast",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
    });

    expect(summary).toContain("Observational workspace handoff is ready.");
    expect(summary).toContain("run the observational analysis when ready");
  });
});
