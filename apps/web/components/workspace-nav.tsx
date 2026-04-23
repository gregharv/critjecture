"use client";

import { useCallback, useRef } from "react";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/app/auth-actions";
import { setThemePreferenceAction } from "@/app/theme-actions";
import { ChatHistoryToggle } from "@/components/chat-history-toggle";
import { ErrorChatToggle } from "@/components/error-chat-toggle";
import type { SessionUser } from "@/lib/auth-state";
import { getRoleLabel } from "@/lib/roles";

export function WorkspaceNav({
  user,
  themePreference,
}: {
  user: SessionUser;
  themePreference: "light" | "dark";
}) {
  const pathname = usePathname() || "";
  const menuRef = useRef<HTMLDetailsElement>(null);
  const displayName = user.name || user.email;

  const activePage =
    pathname.startsWith("/chat")
      ? "chat"
      : pathname.startsWith("/analysis/observational")
        ? "observational"
        : pathname.startsWith("/analysis")
          ? "analysis"
          : pathname.startsWith("/knowledge")
            ? "knowledge"
            : pathname.startsWith("/workflows")
              ? "workflows"
              : pathname.startsWith("/admin/logs")
                ? "logs"
                : pathname.startsWith("/admin/operations")
                  ? "operations"
                  : pathname.startsWith("/admin/settings")
                    ? "settings"
                    : "chat";

  const returnTo = pathname;
  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
  }, []);

  return (
    <header className="shell-header">
      <details
        ref={menuRef}
        className="shell-menu"
        data-dismiss-on-outside="true"
      >
        <summary className="shell-menu__summary">
          <div className="brand-lockup">
            <Image
              alt=""
              aria-hidden="true"
              className="brand-icon"
              height={28}
              priority
              src="/icon.svg"
              width={28}
            />
            <div>
              <span className="brand-name">Critjecture</span>
            </div>
          </div>
          <span aria-hidden="true" className="shell-menu__caret">
            ⌄
          </span>
        </summary>

        <div className="shell-menu__panel">
          <nav className="shell-nav" aria-label="Workspace navigation">
            <Link
              className={`shell-nav__link ${activePage === "chat" ? "is-active" : ""}`}
              href="/chat"
              onClick={closeMenu}
            >
              Chat
            </Link>
            <Link
              className={`shell-nav__link ${activePage === "observational" ? "is-active" : ""}`}
              href="/analysis/observational"
              onClick={closeMenu}
            >
              Observational
            </Link>
            <Link
              className={`shell-nav__link ${activePage === "analysis" ? "is-active" : ""}`}
              href="/analysis"
              onClick={closeMenu}
            >
              Analysis
            </Link>
            <Link
              className={`shell-nav__link ${activePage === "knowledge" ? "is-active" : ""}`}
              href="/knowledge"
              onClick={closeMenu}
            >
              Knowledge
            </Link>
            {user.access.canViewWorkflows ? (
              <Link
                className={`shell-nav__link ${activePage === "workflows" ? "is-active" : ""}`}
                href="/workflows"
                onClick={closeMenu}
              >
                Workflows
              </Link>
            ) : null}
            {user.access.canViewOperations ? (
              <>
                <Link
                  className={`shell-nav__link ${activePage === "operations" ? "is-active" : ""}`}
                  href="/admin/operations"
                  onClick={closeMenu}
                >
                  Operations
                </Link>
                <Link
                  className={`shell-nav__link ${activePage === "logs" ? "is-active" : ""}`}
                  href="/admin/logs"
                  onClick={closeMenu}
                >
                  Audit Logs
                </Link>
                <Link
                  className={`shell-nav__link ${activePage === "settings" ? "is-active" : ""}`}
                  href="/admin/settings"
                  onClick={closeMenu}
                >
                  Settings
                </Link>
              </>
            ) : null}
          </nav>

          <div className="shell-user">
            <div className="shell-user__identity">
              <span className="shell-user__name">{displayName}</span>
              <span className="shell-user__meta">
                {user.organizationName}
                {" · "}
                {getRoleLabel(user.role)}
                {" · "}
                {user.membershipStatus}
                {" · "}
                {user.email}
              </span>
            </div>
            <div className="shell-theme" role="group" aria-label="Appearance">
              <span className="shell-theme__label">Appearance</span>
              <div className="shell-theme__actions">
                <form action={setThemePreferenceAction}>
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <input name="theme" type="hidden" value="dark" />
                  <button
                    className={`shell-theme__button ${themePreference === "dark" ? "is-active" : ""}`}
                    disabled={themePreference === "dark"}
                    type="submit"
                  >
                    Dark
                  </button>
                </form>
                <form action={setThemePreferenceAction}>
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <input name="theme" type="hidden" value="light" />
                  <button
                    className={`shell-theme__button ${themePreference === "light" ? "is-active" : ""}`}
                    disabled={themePreference === "light"}
                    type="submit"
                  >
                    Light
                  </button>
                </form>
              </div>
            </div>
            <ErrorChatToggle />
            <form action={logoutAction}>
              <button className="shell-signout" type="submit">
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </details>
      {activePage === "chat" ? <ChatHistoryToggle /> : null}
    </header>
  );
}
