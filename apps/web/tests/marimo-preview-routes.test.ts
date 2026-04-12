import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-1" })),
  ensureAnalysisPreviewSession: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getAnalysisPreviewTarget: vi.fn(),
  getSessionUser: vi.fn(),
  getUserConversation: vi.fn(),
  runOperationsMaintenance: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/conversations", () => ({
  getUserConversation: mocks.getUserConversation,
}));

vi.mock("@/lib/marimo-preview", () => ({
  ensureAnalysisPreviewSession: mocks.ensureAnalysisPreviewSession,
  getAnalysisPreviewTarget: mocks.getAnalysisPreviewTarget,
}));

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildObservedErrorResponse: (message: string, status: number) =>
      NextResponse.json({ error: message }, { status }),
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { GET as getPreview } from "@/app/api/analysis/workspaces/[conversationId]/preview/route";
import { POST as restartPreview } from "@/app/api/analysis/workspaces/[conversationId]/preview/restart/route";
import { GET as proxyPreviewRoot } from "@/app/api/analysis/workspaces/[conversationId]/preview/proxy/route";

describe("analysis preview routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getUserConversation.mockResolvedValue({ id: "conv-1", title: "Quarterly analysis" });
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.ensureAnalysisPreviewSession.mockResolvedValue({
      expiresAt: 123,
      fallbackHtmlUrl: "/api/generated-files/run-1/outputs/notebook.html",
      port: 27123,
      proxyUrl: "/api/analysis/workspaces/conv-1/preview/proxy/?token=preview-token",
      revisionId: "revision-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
    });
  });

  it("returns preview bootstrap payload", async () => {
    const response = await getPreview(new Request("http://localhost/api/analysis/workspaces/conv-1/preview"), {
      params: Promise.resolve({ conversationId: "conv-1" }),
    });

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      proxyUrl: "/api/analysis/workspaces/conv-1/preview/proxy/?token=preview-token",
      revisionId: "revision-1",
      workspaceId: "workspace-1",
    });
  });

  it("restarts preview when requested", async () => {
    const response = await restartPreview(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/preview/restart", {}),
      {
        params: Promise.resolve({ conversationId: "conv-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(mocks.ensureAnalysisPreviewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        forceRestart: true,
      }),
    );
  });

  it("proxies preview traffic when token is valid", async () => {
    mocks.getAnalysisPreviewTarget.mockResolvedValue({
      port: 27123,
      revisionId: "revision-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>ok</html>", {
        headers: { "Content-Type": "text/html" },
        status: 200,
      }),
    );

    try {
      const response = await proxyPreviewRoot(
        new Request("http://localhost/api/analysis/workspaces/conv-1/preview/proxy/?token=preview-token"),
        {
          params: Promise.resolve({ conversationId: "conv-1" }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("ok");
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:27123/",
        expect.objectContaining({ method: "GET" }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
