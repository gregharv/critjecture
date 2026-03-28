"use client";

import { ChatShellWithRole } from "@/components/chat-shell";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useRoleQueryState } from "@/lib/role-query";

export function ChatPageClient() {
  const { role, setRole } = useRoleQueryState("intern");

  return (
    <WorkspaceShell activePage="chat" onRoleChange={setRole} role={role}>
      <ChatShellWithRole role={role} />
    </WorkspaceShell>
  );
}
