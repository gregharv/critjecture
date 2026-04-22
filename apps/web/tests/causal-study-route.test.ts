import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getCausalDagWorkspaceDetail: vi.fn(),
  getCausalStudyById: vi.fn(),
  getComparisonStateForStudy: vi.fn(),
  getSessionUser: vi.fn(),
  getStudyDatasetBindingDetail: vi.fn(),
  getStudyQuestionSummary: vi.fn(),
  listCausalAnswersForStudy: vi.fn(),
  listCausalRunsForStudy: vi.fn(),
  updateCausalStudy: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/causal-answers", () => ({
  listCausalAnswersForStudy: mocks.listCausalAnswersForStudy,
}));

vi.mock("@/lib/causal-comparisons", () => ({
  getComparisonStateForStudy: mocks.getComparisonStateForStudy,
}));

vi.mock("@/lib/causal-dags", () => ({
  getCausalDagWorkspaceDetail: mocks.getCausalDagWorkspaceDetail,
}));

vi.mock("@/lib/causal-runs", () => ({
  listCausalRunsForStudy: mocks.listCausalRunsForStudy,
}));

vi.mock("@/lib/causal-studies", () => ({
  getCausalStudyById: mocks.getCausalStudyById,
  getStudyQuestionSummary: mocks.getStudyQuestionSummary,
  updateCausalStudy: mocks.updateCausalStudy,
}));

vi.mock("@/lib/study-dataset-bindings", () => ({
  getStudyDatasetBindingDetail: mocks.getStudyDatasetBindingDetail,
}));

import { GET, PATCH } from "@/app/api/causal/studies/[studyId]/route";
import { createJsonRequest, readJson } from "@/tests/helpers/route-test-utils";

describe("/api/causal/studies/[studyId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getCausalStudyById.mockResolvedValue({
      createdAt: 1,
      currentQuestionId: "question-1",
      description: "Study description",
      id: "study-1",
      status: "draft",
      title: "Study title",
      updatedAt: 2,
    });
    mocks.getStudyQuestionSummary.mockResolvedValue({ id: "question-1", questionText: "Did X affect Y?" });
    mocks.getStudyDatasetBindingDetail.mockResolvedValue(null);
    mocks.getCausalDagWorkspaceDetail.mockResolvedValue({ dag: null, approvals: [], currentVersion: null });
    mocks.listCausalRunsForStudy.mockResolvedValue([]);
    mocks.listCausalAnswersForStudy.mockResolvedValue([]);
    mocks.getComparisonStateForStudy.mockResolvedValue({
      recentComparisons: [{ baseRunId: "run-1", id: "recent-1", targetRunId: "run-2", updatedAt: 10 }],
      snapshots: [
        {
          baseRunId: "run-1",
          createdAt: 9,
          id: "snapshot-1",
          name: "Best vs latest",
          pinned: true,
          targetRunId: "run-2",
          updatedAt: 10,
        },
      ],
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/causal/studies/study-1"), {
      params: Promise.resolve({ studyId: "study-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when the study is missing", async () => {
    mocks.getCausalStudyById.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/causal/studies/study-1"), {
      params: Promise.resolve({ studyId: "study-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns comparison state alongside the study payload", async () => {
    const response = await GET(new Request("http://localhost/api/causal/studies/study-1"), {
      params: Promise.resolve({ studyId: "study-1" }),
    });

    expect(response.status).toBe(200);
    const json = await readJson<{
      comparisonState: {
        recentComparisons: Array<{ id: string }>;
        snapshots: Array<{ id: string; pinned: boolean }>;
      };
    }>(response);

    expect(json.comparisonState.snapshots[0]).toMatchObject({
      id: "snapshot-1",
      pinned: true,
    });
    expect(json.comparisonState.recentComparisons[0]).toMatchObject({
      id: "recent-1",
    });
    expect(mocks.getComparisonStateForStudy).toHaveBeenCalledWith({
      organizationId: "org-1",
      studyId: "study-1",
      userId: "user-1",
    });
  });

  it("patches study metadata", async () => {
    mocks.updateCausalStudy.mockResolvedValue({
      description: "Updated description",
      id: "study-1",
      title: "Updated title",
      updatedAt: 3,
    });

    const response = await PATCH(
      createJsonRequest("http://localhost/api/causal/studies/study-1", {
        description: "Updated description",
        title: "Updated title",
      }, { method: "PATCH" }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateCausalStudy).toHaveBeenCalledWith({
      description: "Updated description",
      organizationId: "org-1",
      studyId: "study-1",
      title: "Updated title",
    });
  });

  it("returns 400 when patch body omits both title and description", async () => {
    const response = await PATCH(
      createJsonRequest("http://localhost/api/causal/studies/study-1", {}, { method: "PATCH" }),
      { params: Promise.resolve({ studyId: "study-1" }) },
    );

    expect(response.status).toBe(400);
  });
});
