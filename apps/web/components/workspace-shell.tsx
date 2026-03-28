import type { ReactNode } from "react";

import Image from "next/image";
import Link from "next/link";

import { logoutAction } from "@/app/auth-actions";
import type { SessionUser } from "@/lib/auth-state";
import { getRoleLabel } from "@/lib/roles";

type WorkspaceShellProps = {
  activePage: "chat" | "logs";
  children: ReactNode;
  user: SessionUser;
};

export function WorkspaceShell({
  activePage,
  children,
  user,
}: WorkspaceShellProps) {
  const displayName = user.name || user.email;

  return (
    <main className="shell-page">
      <section className="shell-frame">
        <header className="shell-header">
          <div className="shell-topline">
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
            <nav className="shell-nav" aria-label="Workspace navigation">
              <Link
                className={`shell-nav__link ${activePage === "chat" ? "is-active" : ""}`}
                href="/chat"
              >
                Chat
              </Link>
              {user.role === "owner" ? (
                <Link
                  className={`shell-nav__link ${activePage === "logs" ? "is-active" : ""}`}
                  href="/admin/logs"
                >
                  Audit Logs
                </Link>
              ) : null}
            </nav>
            <div className="shell-user">
              <div className="shell-user__identity">
                <span className="shell-user__name">{displayName}</span>
                <span className="shell-user__meta">
                  {getRoleLabel(user.role)}
                  {" · "}
                  {user.email}
                </span>
              </div>
              <form action={logoutAction}>
                <button className="shell-signout" type="submit">
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </header>
        <div className="shell-body">{children}</div>
      </section>
    </main>
  );
}
