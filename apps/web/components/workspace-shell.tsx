import type { ReactNode } from "react";

import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";

import { logoutAction } from "@/app/auth-actions";
import { setThemePreferenceAction } from "@/app/theme-actions";
import { ChatHistoryToggle } from "@/components/chat-history-toggle";
import { DetailsOutsideDismiss } from "@/components/details-outside-dismiss";
import { ErrorChatToggle } from "@/components/error-chat-toggle";
import type { SessionUser } from "@/lib/auth-state";
import { getRoleLabel } from "@/lib/roles";
import { THEME_COOKIE_NAME, normalizeThemePreference } from "@/lib/theme";

type WorkspaceShellProps = {
  activePage: "chat" | "knowledge" | "logs" | "operations" | "settings";
  children: ReactNode;
  user: SessionUser;
};

export async function WorkspaceShell({
  activePage,
  children,
  user,
}: WorkspaceShellProps) {
  const displayName = user.name || user.email;
  const cookieStore = await cookies();
  const themePreference = normalizeThemePreference(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const returnTo =
    activePage === "chat"
      ? "/chat"
      : activePage === "knowledge"
        ? "/knowledge"
        : activePage === "logs"
          ? "/admin/logs"
          : activePage === "operations"
            ? "/admin/operations"
            : "/admin/settings";

  return (
    <main className="shell-page">
      <DetailsOutsideDismiss />
      <section className="shell-frame">
        <header className="shell-header">
          <details className="shell-menu" data-dismiss-on-outside="true">
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
                >
                  Chat
                </Link>
                <Link
                  className={`shell-nav__link ${activePage === "knowledge" ? "is-active" : ""}`}
                  href="/knowledge"
                >
                  Knowledge
                </Link>
                {user.access.canViewOperations ? (
                  <>
                    <Link
                      className={`shell-nav__link ${activePage === "operations" ? "is-active" : ""}`}
                      href="/admin/operations"
                    >
                      Operations
                    </Link>
                    <Link
                      className={`shell-nav__link ${activePage === "logs" ? "is-active" : ""}`}
                      href="/admin/logs"
                    >
                      Audit Logs
                    </Link>
                    <Link
                      className={`shell-nav__link ${activePage === "settings" ? "is-active" : ""}`}
                      href="/admin/settings"
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
        <div className="shell-body">{children}</div>
      </section>
    </main>
  );
}
