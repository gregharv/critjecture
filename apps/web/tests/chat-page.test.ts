import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  ChatLandingShell: vi.fn(() => null),
  WorkspaceShell: vi.fn(({ children }: { children: unknown }) => children),
  getAnalysisWorkspaceByConversation: vi.fn(),
  getRestrictedWorkspaceMessage: vi.fn(() => "Restricted."),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  requirePageUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/components/chat-landing-shell", () => ({
  ChatLandingShell: mocks.ChatLandingShell,
}));

vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: mocks.WorkspaceShell,
}));

vi.mock("@/lib/auth-state", () => ({
  requirePageUser: mocks.requirePageUser,
}));

vi.mock("@/lib/access-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access-control")>();

  return {
    ...actual,
    getRestrictedWorkspaceMessage: mocks.getRestrictedWorkspaceMessage,
  };
});

vi.mock("@/lib/marimo-workspaces", () => ({
  getAnalysisWorkspaceByConversation: mocks.getAnalysisWorkspaceByConversation,
}));

import ChatPage from "@/app/chat/page";

describe("/chat page", () => {
  it("redirects to /analysis/[conversationId] when the requested conversation already has a workspace", async () => {
    const user = createSessionUser();
    mocks.requirePageUser.mockResolvedValue(user);
    mocks.getAnalysisWorkspaceByConversation.mockResolvedValue({ id: "workspace-1" });

    await expect(
      ChatPage({
        searchParams: Promise.resolve({ conversation: "conv-1" }),
      }),
    ).rejects.toThrow("redirect:/analysis/conv-1");

    expect(mocks.getAnalysisWorkspaceByConversation).toHaveBeenCalledWith({
      conversationId: "conv-1",
      organizationId: user.organizationId,
      userId: user.id,
    });
  });

  it("renders the chat landing shell when no analysis workspace exists", async () => {
    const user = createSessionUser();
    mocks.requirePageUser.mockResolvedValue(user);
    mocks.getAnalysisWorkspaceByConversation.mockResolvedValue(null);

    const result = await ChatPage({
      searchParams: Promise.resolve({ conversation: "conv-1" }),
    });

    renderToStaticMarkup(result);

    expect(mocks.ChatLandingShell).toHaveBeenCalledWith(
      expect.objectContaining({ user }),
      undefined,
    );
  });
});
