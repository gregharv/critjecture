"use client";

import type { ReactNode } from "react";

import Image from "next/image";
import Link from "next/link";

import { buildRoleHref } from "@/lib/role-query";
import { getRoleLabel, USER_ROLES, type UserRole } from "@/lib/roles";

type WorkspaceShellProps = {
  activePage: "chat" | "logs";
  children: ReactNode;
  role: UserRole;
  onRoleChange: (role: UserRole) => void;
};

export function WorkspaceShell({
  activePage,
  children,
  role,
  onRoleChange,
}: WorkspaceShellProps) {
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
                href={buildRoleHref("/chat", role)}
              >
                Chat
              </Link>
              <Link
                className={`shell-nav__link ${activePage === "logs" ? "is-active" : ""}`}
                href={buildRoleHref("/admin/logs", role)}
              >
                Audit Logs
              </Link>
            </nav>
            <div className="role-toggle" aria-label="Role selector">
              {USER_ROLES.map((candidate) => (
                <button
                  key={candidate}
                  className={`role-button ${candidate === role ? "is-active" : ""}`}
                  onClick={() => onRoleChange(candidate)}
                  type="button"
                >
                  {getRoleLabel(candidate)}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="shell-body">{children}</div>
      </section>
    </main>
  );
}
