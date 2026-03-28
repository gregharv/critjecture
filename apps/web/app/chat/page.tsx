import { ChatShellWithRole } from "@/components/chat-shell";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requirePageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requirePageUser();

  return (
    <WorkspaceShell activePage="chat" user={user}>
      <ChatShellWithRole role={user.role} userId={user.id} />
    </WorkspaceShell>
  );
}
