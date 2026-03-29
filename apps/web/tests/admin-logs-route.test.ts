import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listRecentChatTurnLogs: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/audit-log", () => ({
  listRecentChatTurnLogs: mocks.listRecentChatTurnLogs,
}));

import { GET } from "@/app/api/admin/logs/route";

describe("GET /api/admin/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.listRecentChatTurnLogs.mockResolvedValue([
      {
        assistantMessages: [],
        chatSessionId: "session-1",
        completedAt: Date.now(),
        conversationId: "conversation-1",
        createdAt: Date.now(),
        id: "turn-1",
        responseCitations: [],
        retrievalRuns: [],
        status: "completed",
        toolCalls: [],
        userEmail: "owner@example.com",
        userId: "user-1",
        userName: "Owner User",
        userPromptText: "What changed?",
        userRole: "owner",
      },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/admin/logs"));

    expect(response.status).toBe(401);
  });

  it("returns 403 for intern users", async () => {
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "intern" }));

    const response = await GET(new Request("http://localhost/api/admin/logs"));

    expect(response.status).toBe(403);
  });

  it("returns org-scoped audit logs for owner users", async () => {
    const response = await GET(new Request("http://localhost/api/admin/logs?limit=10"));
    const body = await readJson<{ turns: Array<{ id: string }> }>(response);

    expect(response.status).toBe(200);
    expect(mocks.listRecentChatTurnLogs).toHaveBeenCalledWith("org-1", 10);
    expect(body.turns[0]?.id).toBe("turn-1");
  });
});
