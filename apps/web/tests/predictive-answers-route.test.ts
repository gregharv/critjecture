import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  createGroundedPredictiveAnswer: vi.fn(),
  getSessionUser: vi.fn(),
  listPredictiveAnswersForRun: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/predictive-answers", () => ({
  createGroundedPredictiveAnswer: mocks.createGroundedPredictiveAnswer,
  listPredictiveAnswersForRun: mocks.listPredictiveAnswersForRun,
}));

import { GET, POST } from "@/app/api/predictive/runs/[runId]/answers/route";

describe("/api/predictive/runs/[runId]/answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.listPredictiveAnswersForRun.mockResolvedValue([
      {
        answerFormat: "markdown",
        answerPackageId: "package-1",
        answerText: "grounded predictive answer",
        createdAt: 123,
        id: "answer-1",
        modelName: "grounded-predictive-package-template",
        organizationId: "org-1",
        promptVersion: "predictive_answer_markdown_v1",
        runId: "predictive-run-1",
      },
    ]);
    mocks.createGroundedPredictiveAnswer.mockResolvedValue({
      answerFormat: "markdown",
      answerPackageId: "package-1",
      answerText: "grounded predictive answer",
      createdAt: 124,
      id: "answer-2",
      modelName: "grounded-predictive-package-template",
      organizationId: "org-1",
      promptVersion: "predictive_answer_markdown_v1",
      runId: "predictive-run-1",
    });
  });

  it("GET returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1/answers", undefined, { method: "GET" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("GET returns predictive answer history", async () => {
    const response = await GET(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1/answers", undefined, { method: "GET" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(200);
    await expect(readJson<{ answers: Array<{ id: string }> }>(response)).resolves.toMatchObject({
      answers: [{ id: "answer-1" }],
    });
    expect(mocks.listPredictiveAnswersForRun).toHaveBeenCalledWith({
      organizationId: "org-1",
      runId: "predictive-run-1",
    });
  });

  it("POST returns 403 when answer tools are unavailable", async () => {
    mocks.getSessionUser.mockResolvedValue(
      createSessionUser({
        access: {
          ...createSessionUser().access,
          canUseAnswerTools: false,
        },
      }),
    );

    const response = await POST(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1/answers", undefined, { method: "POST" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("POST creates a grounded predictive answer", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/predictive/runs/predictive-run-1/answers", undefined, { method: "POST" }), {
      params: Promise.resolve({ runId: "predictive-run-1" }),
    });

    expect(response.status).toBe(201);
    await expect(readJson<{ answer: { id: string } }>(response)).resolves.toMatchObject({
      answer: { id: "answer-2" },
    });
    expect(mocks.createGroundedPredictiveAnswer).toHaveBeenCalledWith({
      organizationId: "org-1",
      runId: "predictive-run-1",
    });
  });

  it("POST returns 404 when the predictive run is missing", async () => {
    mocks.createGroundedPredictiveAnswer.mockRejectedValue(new Error("Predictive run not found."));

    const response = await POST(createJsonRequest("http://localhost/api/predictive/runs/missing/answers", undefined, { method: "POST" }), {
      params: Promise.resolve({ runId: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
