import { describe, expect, it } from "vitest";

import type { SessionData } from "@mariozechner/pi-web-ui";

import {
  deleteConversation,
  getUserConversation,
  listUserConversations,
  updateConversation,
  upsertConversation,
} from "@/lib/conversations";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import { createTestAppEnvironment } from "@/tests/helpers/test-environment";

function buildSessionData(id: string, title: string) {
  return {
    createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
    id,
    lastModified: new Date("2026-03-25T12:05:00.000Z").toISOString(),
    messages: [
      {
        content: [{ text: `${title} prompt`, type: "text" }],
        role: "user" as const,
      },
      {
        content: [{ text: `${title} answer`, type: "text" }],
        role: "assistant" as const,
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
      },
    ],
    model: {
      api: "openai",
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      provider: "openai",
    },
    thinkingLevel: "medium" as const,
    title,
  } as unknown as SessionData;
}

describe("conversations integration", () => {
  it("supports org sharing, per-user pins, rename, and delete permissions", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const owner = await getAuthenticatedUserByEmail("owner@example.com");
      const member = await getAuthenticatedUserByEmail("intern@example.com");

      expect(owner).not.toBeNull();
      expect(member).not.toBeNull();

      if (!owner || !member) {
        throw new Error("Seed users were not created.");
      }

      await upsertConversation({
        conversationId: "member-conversation",
        organizationId: member.organizationId,
        sessionData: buildSessionData("member-conversation", "Member budget review"),
        userId: member.id,
        userRole: member.role,
      });
      await upsertConversation({
        conversationId: "owner-conversation",
        organizationId: owner.organizationId,
        sessionData: buildSessionData("owner-conversation", "Owner strategy"),
        userId: owner.id,
        userRole: owner.role,
      });

      const sharedMemberConversation = await updateConversation({
        conversationId: "member-conversation",
        organizationId: member.organizationId,
        patch: {
          visibility: "organization",
        },
        userId: member.id,
        userRole: member.role,
      });

      expect(sharedMemberConversation?.metadata.visibility).toBe("organization");

      const ownerHistory = await listUserConversations({
        organizationId: owner.organizationId,
        userId: owner.id,
        userRole: owner.role,
      });
      const ownerVisibleShared = ownerHistory.find(
        (conversation) => conversation.id === "member-conversation",
      );

      expect(ownerVisibleShared).toMatchObject({
        canManage: false,
        visibility: "organization",
      });

      const pinnedSharedConversation = await updateConversation({
        conversationId: "member-conversation",
        organizationId: owner.organizationId,
        patch: {
          pinned: true,
        },
        userId: owner.id,
        userRole: owner.role,
      });

      expect(pinnedSharedConversation?.metadata.isPinned).toBe(true);

      await expect(
        updateConversation({
          conversationId: "member-conversation",
          organizationId: owner.organizationId,
          patch: {
            title: "Owner cannot rename this",
          },
          userId: owner.id,
          userRole: owner.role,
        }),
      ).rejects.toMatchObject({
        message: "Only the conversation owner can rename or share it.",
        status: 403,
      });

      await updateConversation({
        conversationId: "owner-conversation",
        organizationId: owner.organizationId,
        patch: {
          visibility: "organization",
        },
        userId: owner.id,
        userRole: owner.role,
      });

      const memberHistory = await listUserConversations({
        organizationId: member.organizationId,
        userId: member.id,
        userRole: member.role,
      });

      expect(
        memberHistory.some((conversation) => conversation.id === "owner-conversation"),
      ).toBe(false);

      const renamedMemberConversation = await updateConversation({
        conversationId: "member-conversation",
        organizationId: member.organizationId,
        patch: {
          title: "Renamed member budget review",
        },
        userId: member.id,
        userRole: member.role,
      });

      expect(renamedMemberConversation?.metadata.title).toBe("Renamed member budget review");

      const memberConversation = await getUserConversation({
        conversationId: "member-conversation",
        organizationId: member.organizationId,
        userId: member.id,
        userRole: member.role,
      });

      expect(memberConversation?.conversation.title).toBe("Renamed member budget review");

      await expect(
        deleteConversation({
          conversationId: "member-conversation",
          organizationId: owner.organizationId,
          userId: owner.id,
          userRole: owner.role,
        }),
      ).rejects.toMatchObject({
        message: "Only the conversation owner can delete it.",
        status: 403,
      });

      await expect(
        deleteConversation({
          conversationId: "member-conversation",
          organizationId: member.organizationId,
          userId: member.id,
          userRole: member.role,
        }),
      ).resolves.toEqual({
        conversationId: "member-conversation",
      });

      await expect(
        getUserConversation({
          conversationId: "member-conversation",
          organizationId: member.organizationId,
          userId: member.id,
          userRole: member.role,
        }),
      ).resolves.toBeNull();
    } finally {
      await environment.cleanup();
    }
  });
});
