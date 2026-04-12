import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getAnalysisWorkspaceByConversation: vi.fn(),
  getLatestAnalysisNotebookRevision: vi.fn(),
  getSessionUser: vi.fn(),
  getUserConversation: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/conversations", () => ({
  getUserConversation: mocks.getUserConversation,
}));

vi.mock("@/lib/marimo-workspaces", () => ({
  getAnalysisWorkspaceByConversation: mocks.getAnalysisWorkspaceByConversation,
  getLatestAnalysisNotebookRevision: mocks.getLatestAnalysisNotebookRevision,
}));

import { GET } from "@/app/api/analysis/workspaces/[conversationId]/route";

describe("GET /api/analysis/workspaces/[conversationId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getUserConversation.mockResolvedValue({ id: "conv-1", title: "Quarterly analysis" });
    mocks.getAnalysisWorkspaceByConversation.mockResolvedValue({
      conversationId: "conv-1",
      createdAt: 1,
      id: "workspace-1",
      latestRevisionId: "revision-2",
      latestSandboxRunId: "run-2",
      organizationId: "org-1",
      status: "completed",
      title: "Quarterly analysis",
      updatedAt: 2,
      userId: "user-1",
    });
    mocks.getLatestAnalysisNotebookRevision.mockResolvedValue({
      createdAt: 2,
      htmlExportPath: "outputs/notebook.html",
      id: "revision-2",
      notebookPath: "analysis_workspaces/workspace-1/revisions/2/notebook.py",
      notebookSource: "import marimo",
      revisionNumber: 2,
      sandboxRunId: "run-2",
      status: "completed",
      structuredResultPath: null,
      summary: "Done",
      turnId: "turn-2",
      workspaceId: "workspace-1",
    });
  });

  it("returns workspace state for an analysis conversation", async () => {
    const response = await GET(
      new Request("http://localhost/api/analysis/workspaces/conv-1"),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      latestRevision: {
        id: "revision-2",
        workspaceId: "workspace-1",
      },
      workspace: {
        id: "workspace-1",
        conversationId: "conv-1",
      },
    });
  });

  it("returns 404 when the conversation has no analysis workspace", async () => {
    mocks.getAnalysisWorkspaceByConversation.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/analysis/workspaces/conv-1"),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Analysis workspace not found.",
    });
  });
});
