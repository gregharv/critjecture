"use client";

import { useEffect, useState } from "react";

const CHAT_HISTORY_SIDEBAR_COLLAPSED_STORAGE_KEY = "critjecture.chatHistorySidebarCollapsed";
const CHAT_HISTORY_SIDEBAR_COLLAPSED_ROOT_CLASS = "crit-chat-history-collapsed";

function applyChatHistoryCollapsedClass(collapsed: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle(CHAT_HISTORY_SIDEBAR_COLLAPSED_ROOT_CLASS, collapsed);
}

function getInitialCollapsedState() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(CHAT_HISTORY_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function ChatHistoryToggle() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsedState);

  useEffect(() => {
    applyChatHistoryCollapsedClass(collapsed);

    try {
      window.localStorage.setItem(
        CHAT_HISTORY_SIDEBAR_COLLAPSED_STORAGE_KEY,
        collapsed ? "true" : "false",
      );
    } catch {
      // Ignore persistence failures.
    }
  }, [collapsed]);

  return (
    <button
      aria-label={collapsed ? "Show conversation history sidebar" : "Hide conversation history sidebar"}
      aria-pressed={collapsed}
      className="shell-header__chat-history-toggle"
      onClick={() => setCollapsed((current) => !current)}
      type="button"
    >
      {collapsed ? "Show history" : "Hide history"}
    </button>
  );
}
