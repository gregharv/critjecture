import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getPredictiveRunDetail: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/predictive-analysis", () => ({
  getPredictiveRunDetail: mocks.getPredictiveRunDetail,
}));

import { GET } from "@/app/api/predictive/runs/[runId]/route";

describe("GET /api/predictive/runs/[runId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getPredictiveRunDetail.mockResolvedValue({
      answerPackage: {
        createdAt: 125,
        id: "package-1",
        packageJson: "{}",
      },
      answers: [
        {
          answerFormat: "markdown",
          answerText: "grounded predictive answer",
          createdAt: 126,
          id: "answer-1",
          modelName: "grounded-predictive-package-template",
          promptVersion: "predictive_answer_markdown_v1",
        },
      ],
      computeRuns: [
        {
          backend: "python-sandbox-venv",
          completedAt: 123,
          computeKind: "predictive_analysis",
          createdAt: 101,
          failureReason: null,
          id: "compute-1",
          inputManifestJson: "{}",
          metadataJson: "{}",
          runner: "catboost-classifier",
          startedAt: 110,
          status: "completed",
          stderrText: "",
          stdoutText: "{}",
        },
      ],
      dataset: {
        datasetKey: "conversions",
        displayName: "Conversions",
        id: "dataset-1",
      },
      datasetVersion: {
        id: "dataset-version-1",
        rowCount: 120,
        versionNumber: 1,
      },
      result: {
        claimLabel: "ASSOCIATIONAL",
        createdAt: 123,
        featureImportance: { discount_rate: 0.7 },
        metrics: { roc_auc: 0.81 },
        modelName: "catboost_classifier",
        resultJson: "{}",
        rowCount: 120,
        summaryText: "summary",
        taskKind: "classification",
        targetColumnName: "conversion_rate",
      },
      run: {
        claimLabel: "ASSOCIATIONAL",
        completedAt: 123,
        createdAt: 100,
        datasetVersionId: "dataset-version-1",
        featureColumns: ["discount_rate"],
        forecastConfig: null,
        id: "predictive-run-1",
        modelName: "catboost_classifier",
        preset: "standard",
        startedAt: 110,
        status: "completed",
        summaryText: "summary",
        targetColumnName: "conversion_rate",
        taskKind: "classification",
      },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1", undefined, { method: "GET" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns run detail", async () => {
    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1", undefined, { method: "GET" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(200);
    await expect(readJson<{ run: { id: string } }>(response)).resolves.toMatchObject({
      run: { id: "predictive-run-1" },
    });
    expect(mocks.getPredictiveRunDetail).toHaveBeenCalledWith({
      organizationId: "org-1",
      runId: "predictive-run-1",
    });
  });

  it("returns 404 when the run is missing", async () => {
    mocks.getPredictiveRunDetail.mockRejectedValue(new Error("Predictive run not found."));

    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/missing", undefined, { method: "GET" }), {
      params: Promise.resolve({ runId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
