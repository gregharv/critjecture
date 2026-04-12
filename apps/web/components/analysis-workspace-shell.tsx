"use client";

import Link from "next/link";
import { useState } from "react";

import { ChatShellWithRole } from "@/components/chat-shell";
import { MarimoPreviewPane } from "@/components/marimo-preview-pane";
import type { SessionUser } from "@/lib/auth-state";

export function AnalysisWorkspaceShell({
  conversationId,
  user,
}: {
  conversationId: string;
  user: SessionUser;
}) {
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "notebook">("chat");

  return (
    <section className="analysis-workspace">
      <header className="analysis-workspace__header">
        <div>
          <p className="analysis-workspace__eyebrow">Analysis workspace</p>
          <h2 className="analysis-workspace__title">Conversation {conversationId}</h2>
        </div>
        <div className="analysis-workspace__actions">
          <Link className="chat-toolbar__button" href="/chat">
            Back to chats
          </Link>
          <Link className="chat-toolbar__button" href="/chat">
            New analysis
          </Link>
          <button
            className="chat-toolbar__button chat-toolbar__button--primary"
            onClick={() => setPreviewRefreshNonce((value) => value + 1)}
            type="button"
          >
            Refresh notebook
          </button>
        </div>
      </header>

      <div className="analysis-workspace__mobile-tabs" role="tablist" aria-label="Analysis workspace panels">
        <button
          aria-selected={mobileTab === "chat"}
          className={`analysis-workspace__mobile-tab ${mobileTab === "chat" ? "is-active" : ""}`}
          onClick={() => setMobileTab("chat")}
          role="tab"
          type="button"
        >
          Chat
        </button>
        <button
          aria-selected={mobileTab === "notebook"}
          className={`analysis-workspace__mobile-tab ${mobileTab === "notebook" ? "is-active" : ""}`}
          onClick={() => setMobileTab("notebook")}
          role="tab"
          type="button"
        >
          Notebook
        </button>
      </div>

      <div className="analysis-workspace__panes">
        <section
          className={`analysis-workspace__chat-pane ${mobileTab === "chat" ? "is-active" : ""}`}
        >
          <ChatShellWithRole
            initialConversationId={conversationId}
            organizationSlug={user.organizationSlug}
            role={user.role}
            showHistory={false}
            showToolbar={false}
            userId={user.id}
          />
        </section>

        <section
          className={`analysis-workspace__notebook-pane ${mobileTab === "notebook" ? "is-active" : ""}`}
        >
          <MarimoPreviewPane conversationId={conversationId} refreshNonce={previewRefreshNonce} />
        </section>
      </div>
    </section>
  );
}
