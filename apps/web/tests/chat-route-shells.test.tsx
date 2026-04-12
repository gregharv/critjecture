import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  ChatShellWithRole: vi.fn(() => null),
  MarimoPreviewPane: vi.fn(() => null),
}));

vi.mock("@/components/chat-shell", () => ({
  ChatShellWithRole: mocks.ChatShellWithRole,
}));

vi.mock("@/components/marimo-preview-pane", () => ({
  MarimoPreviewPane: mocks.MarimoPreviewPane,
}));

vi.mock("next/link", () => ({
  default: () => null,
}));

import { AnalysisWorkspaceShell } from "@/components/analysis-workspace-shell";
import { ChatLandingShell } from "@/components/chat-landing-shell";

describe("chat and analysis route shells", () => {
  it("configures the chat landing shell to redirect into analysis on notebook runs", () => {
    const user = createSessionUser();

    ChatLandingShell({ user });

    expect(mocks.ChatShellWithRole).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationSlug: user.organizationSlug,
        redirectToAnalysisOnNotebookRun: true,
        role: user.role,
        showHistory: true,
        showToolbar: true,
        userId: user.id,
      }),
      undefined,
    );
  });

  it("renders the analysis workspace with chat history disabled", () => {
    const user = createSessionUser();

    renderToStaticMarkup(
      <AnalysisWorkspaceShell
        conversationId="conv-1"
        user={user}
      />,
    );

    expect(mocks.ChatShellWithRole).toHaveBeenCalledWith(
      expect.objectContaining({
        initialConversationId: "conv-1",
        organizationSlug: user.organizationSlug,
        role: user.role,
        showHistory: false,
        showToolbar: false,
        userId: user.id,
      }),
      undefined,
    );
    expect(mocks.MarimoPreviewPane).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        refreshNonce: 0,
      }),
      undefined,
    );
  });
});
