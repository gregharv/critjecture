import { describe, expect, it } from "vitest";

import {
  buildPredictiveChatReturnHref,
  buildPredictiveWorkspaceHref,
  clearPredictiveChatReturnParams,
  parsePredictiveChatReturn,
  parsePredictiveWorkspaceHandoff,
  summarizePredictiveWorkspaceHandoff,
} from "@/lib/predictive-handoff";

describe("predictive workspace handoff", () => {
  it("builds a predictive workspace URL with repeated feature columns", () => {
    const href = buildPredictiveWorkspaceHref({
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

    expect(href).toContain("/predictive?");
    expect(href).toContain("datasetVersionId=dataset-version-1");
    expect(href).toContain("targetColumn=bookings");
    expect(href).toContain("featureColumn=discount_rate");
    expect(href).toContain("featureColumn=seasonality");
    expect(href).toContain("forecastHorizonValue=14");
    expect(href).toContain("returnToChat=%2Fchat%3Fconversation%3Dconversation-1");
  });

  it("parses predictive workspace handoff parameters", () => {
    const params = new URLSearchParams(
      "datasetVersionId=dataset-version-1&targetColumn=bookings&featureColumn=discount_rate&featureColumn=seasonality&taskKind=regression&preset=forecast&timeColumn=event_date&forecastHorizonValue=14&forecastHorizonUnit=days&planningNote=Forecast+weekly+bookings+for+the+executive+review&returnToChat=%2Fchat%3Fconversation%3Dconversation-1",
    );

    expect(parsePredictiveWorkspaceHandoff(params)).toEqual({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      planningNote: "Forecast weekly bookings for the executive review",
      preset: "forecast",
      returnToChat: "/chat?conversation=conversation-1",
      targetColumn: "bookings",
      taskKind: "regression",
      timeColumn: "event_date",
    });
  });

  it("returns null when no handoff parameters are present", () => {
    expect(parsePredictiveWorkspaceHandoff(new URLSearchParams(""))).toBeNull();
  });

  it("builds a business-readable predictive handoff summary", () => {
    const summary = summarizePredictiveWorkspaceHandoff({
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

    expect(summary).toContain("Predictive workspace handoff is ready.");
    expect(summary).toContain("Target: bookings.");
    expect(summary).toContain("Prediction horizon: 14 days.");
    expect(summary).toContain("Feature candidates: discount_rate, seasonality.");
    expect(summary).toContain("opened in a new tab");
    expect(summary).toContain("Next step: review the prefilled setup");
  });

  it("builds and parses a chat return URL for predictive results", () => {
    const href = buildPredictiveChatReturnHref({
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
      workspaceHref: "/predictive?datasetVersionId=dataset-version-1",
    });

    expect(href).toContain("/chat?conversation=conversation-1");
    expect(href).toContain("predictiveChatStatus=run_completed");
    expect(href).toContain("predictiveRunId=predictive-run-1");

    expect(parsePredictiveChatReturn(new URLSearchParams(href.split("?")[1]))).toEqual({
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
  });

  it("clears predictive chat return params from a URL", () => {
    const url = new URL(
      "https://critjecture.local/chat?conversation=conversation-1&predictiveChatStatus=workspace_ready&predictiveTargetColumn=bookings&predictiveFeatureColumn=discount_rate",
    );

    clearPredictiveChatReturnParams(url);

    expect(url.pathname + url.search).toBe("/chat?conversation=conversation-1");
  });
});
