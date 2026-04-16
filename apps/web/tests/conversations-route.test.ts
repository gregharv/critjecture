import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, createSessionUser, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  deleteConversation: vi.fn(),
  getSessionUser: vi.fn(),
  getUserConversation: vi.fn(),
  updateConversation: vi.fn(),
  upsertConversation: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations")>(
    "@/lib/conversations",
  );

  return {
    ...actual,
    deleteConversation: mocks.deleteConversation,
    getUserConversation: mocks.getUserConversation,
    updateConversation: mocks.updateConversation,
    upsertConversation: mocks.upsertConversation,
  };
});

import { DELETE, GET, PATCH, PUT } from "@/app/api/conversations/[conversationId]/route";

describe("/api/conversations/[conversationId] route", () => {
  const context = {
    params: Promise.resolve({
      conversationId: "conversation-1",
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "owner" }));
    mocks.getUserConversation.mockResolvedValue({
      conversation: {
        createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
        id: "conversation-1",
        lastModified: new Date("2026-03-25T12:15:00.000Z").toISOString(),
        messages: [],
        model: {
          api: "openai",
          id: "gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          provider: "openai",
        },
        thinkingLevel: "medium",
        title: "Budget review",
      },
      metadata: {
        canManage: true,
        createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
        id: "conversation-1",
        isPinned: false,
        lastModified: new Date("2026-03-25T12:15:00.000Z").toISOString(),
        messageCount: 0,
        preview: "",
        thinkingLevel: "medium",
        title: "Budget review",
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
        visibility: "private",
      },
    });
    mocks.upsertConversation.mockResolvedValue({
      conversationId: "conversation-1",
      metadata: {
        canManage: true,
        createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
        id: "conversation-1",
        isPinned: false,
        lastModified: new Date("2026-03-25T12:20:00.000Z").toISOString(),
        messageCount: 1,
        preview: "Budget review",
        thinkingLevel: "medium",
        title: "Budget review",
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
        visibility: "private",
      },
    });
    mocks.updateConversation.mockResolvedValue({
      metadata: {
        canManage: true,
        createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
        id: "conversation-1",
        isPinned: true,
        lastModified: new Date("2026-03-25T12:20:00.000Z").toISOString(),
        messageCount: 1,
        preview: "Budget review",
        thinkingLevel: "medium",
        title: "Budget review",
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
        visibility: "organization",
      },
    });
    mocks.deleteConversation.mockResolvedValue({
      conversationId: "conversation-1",
    });
  });

  it("returns the conversation and metadata on GET", async () => {
    const response = await GET(new Request("http://localhost/api/conversations/conversation-1"), context);
    const body = await readJson<{
      conversation: { id: string };
      metadata: { visibility: string };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.conversation.id).toBe("conversation-1");
    expect(body.metadata.visibility).toBe("private");
  });

  it("validates PATCH payloads", async () => {
    const response = await PATCH(
      createJsonRequest("http://localhost/api/conversations/conversation-1", {
        title: "",
      }, { method: "PATCH" }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.updateConversation).not.toHaveBeenCalled();
  });

  it("updates conversation metadata on PATCH", async () => {
    const response = await PATCH(
      createJsonRequest(
        "http://localhost/api/conversations/conversation-1",
        {
          pinned: true,
          visibility: "organization",
        },
        { method: "PATCH" },
      ),
      context,
    );
    const body = await readJson<{ metadata: { isPinned: boolean; visibility: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.metadata.isPinned).toBe(true);
    expect(body.metadata.visibility).toBe("organization");
    expect(mocks.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          pinned: true,
          visibility: "organization",
        },
      }),
    );
  });

  it("saves a conversation snapshot on PUT", async () => {
    const response = await PUT(
      createJsonRequest(
        "http://localhost/api/conversations/conversation-1",
        {
          sessionData: {
            createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
            id: "conversation-1",
            lastModified: new Date("2026-03-25T12:20:00.000Z").toISOString(),
            messages: [],
            model: {
              api: "openai",
              id: "gpt-5.4-mini",
              name: "GPT-5.4 Mini",
              provider: "openai",
            },
            thinkingLevel: "medium",
            title: "Budget review",
          },
        },
        { method: "PUT" },
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertConversation).toHaveBeenCalled();
  });

  it("deletes a conversation on DELETE", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/conversations/conversation-1", { method: "DELETE" }),
      context,
    );
    const body = await readJson<{ conversationId: string }>(response);

    expect(response.status).toBe(200);
    expect(body.conversationId).toBe("conversation-1");
    expect(mocks.deleteConversation).toHaveBeenCalled();
  });
});
