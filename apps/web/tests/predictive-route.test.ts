import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  executePredictiveRun: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/predictive-analysis", () => ({
  executePredictiveRun: mocks.executePredictiveRun,
}));

import { POST } from "@/app/api/predictive/run/route";

describe("POST /api/predictive/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.executePredictiveRun.mockResolvedValue({
      claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      featureImportance: {
        discount_rate: 0.7,
        seasonality: 0.3,
      },
      forecastConfig: null,
      id: "predictive-run-1",
      metrics: {
        roc_auc: 0.81,
      },
      modelName: "catboost_classifier",
      preset: "standard",
      rowCount: 120,
      summary: "INSTRUMENTAL / HEURISTIC PREDICTION result from catboost_classifier with roc_auc=0.8100.",
      targetColumn: "conversion_rate",
      taskKind: "classification",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate"],
      targetColumn: "conversion_rate",
    }));

    expect(response.status).toBe(401);
  });

  it("returns 403 when answer tools are unavailable", async () => {
    mocks.getSessionUser.mockResolvedValue(
      createSessionUser({
        access: {
          ...createSessionUser().access,
          canUseAnswerTools: false,
        },
      }),
    );

    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate"],
      targetColumn: "conversion_rate",
    }));

    expect(response.status).toBe(403);
  });

  it("returns 400 for invalid bodies", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: [],
      targetColumn: "conversion_rate",
    }));

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "featureColumns must include at least one column name.",
    });
  });

  it("passes forecast preset settings through to predictive execution", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastHorizonUnit: "days",
      forecastHorizonValue: 14,
      preset: "forecast",
      targetColumn: "conversion_rate",
      taskKind: "regression",
      timeColumn: "event_date",
    }));

    expect(response.status).toBe(200);
    expect(mocks.executePredictiveRun).toHaveBeenCalledWith({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastConfig: {
        horizonUnit: "days",
        horizonValue: 14,
        timeColumnName: "event_date",
      },
      organizationId: "org-1",
      organizationSlug: "critjecture-test-org",
      preset: "forecast",
      requestedByUserId: "user-1",
      targetColumn: "conversion_rate",
      taskKind: "regression",
    });
  });

  it("returns 400 for invalid forecast bodies", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate"],
      forecastHorizonValue: 0,
      preset: "forecast",
      targetColumn: "conversion_rate",
    }));

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "forecastHorizonValue must be a positive integer when preset is forecast.",
    });
  });

  it("returns predictive results", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/predictive/run", {
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      targetColumn: "conversion_rate",
      taskKind: "classification",
    }));

    expect(response.status).toBe(200);
    await expect(readJson<{ claimLabel: string; modelName: string }>(response)).resolves.toMatchObject({
      claimLabel: "INSTRUMENTAL / HEURISTIC PREDICTION",
      modelName: "catboost_classifier",
    });
    expect(mocks.executePredictiveRun).toHaveBeenCalledWith({
      datasetVersionId: "dataset-version-1",
      featureColumns: ["discount_rate", "seasonality"],
      forecastConfig: null,
      organizationId: "org-1",
      organizationSlug: "critjecture-test-org",
      preset: "standard",
      requestedByUserId: "user-1",
      targetColumn: "conversion_rate",
      taskKind: "classification",
    });
  });
});
