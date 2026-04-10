"use client";

import { useEffect, useState } from "react";

const SHOW_ERROR_CHATS_STORAGE_KEY = "critjecture.showErrorChats";
const SHOW_ERROR_CHATS_ROOT_CLASS = "crit-show-error-chats";

function applyShowErrorChatsClass(showErrorChats: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle(SHOW_ERROR_CHATS_ROOT_CLASS, showErrorChats);
}

function getInitialShowErrorChatsState() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SHOW_ERROR_CHATS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function ErrorChatToggle() {
  const [showErrorChats, setShowErrorChats] = useState(getInitialShowErrorChatsState);

  useEffect(() => {
    applyShowErrorChatsClass(showErrorChats);

    try {
      window.localStorage.setItem(
        SHOW_ERROR_CHATS_STORAGE_KEY,
        showErrorChats ? "true" : "false",
      );
    } catch {
      // Ignore persistence failures.
    }
  }, [showErrorChats]);

  return (
    <div className="shell-toggle" role="group" aria-label="Chat display options">
      <span className="shell-theme__label">Chat</span>
      <label className="shell-toggle__control">
        <input
          checked={showErrorChats}
          className="shell-toggle__checkbox"
          onChange={(event) => {
            setShowErrorChats(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span>Show error chats</span>
      </label>
    </div>
  );
}
