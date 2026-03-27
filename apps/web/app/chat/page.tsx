"use client";

import { useState } from "react";

import Image from "next/image";

import { ChatShellWithRole } from "@/components/chat-shell";
import { getRoleLabel, USER_ROLES, type UserRole } from "@/lib/roles";

export default function ChatPage() {
  const [role, setRole] = useState<UserRole>("intern");

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
            <div className="role-toggle" aria-label="Role selector">
              {USER_ROLES.map((candidate) => (
                <button
                  key={candidate}
                  className={`role-button ${candidate === role ? "is-active" : ""}`}
                  onClick={() => setRole(candidate)}
                  type="button"
                >
                  {getRoleLabel(candidate)}
                </button>
              ))}
            </div>
          </div>
        </header>
        <div className="shell-body">
          <ChatShellWithRole role={role} />
        </div>
      </section>
    </main>
  );
}
