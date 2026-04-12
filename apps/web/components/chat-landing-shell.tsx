import { ChatShellWithRole } from "@/components/chat-shell";
import type { SessionUser } from "@/lib/auth-state";

export function ChatLandingShell({ user }: { user: SessionUser }) {
  return (
    <ChatShellWithRole
      organizationSlug={user.organizationSlug}
      redirectToAnalysisOnNotebookRun
      role={user.role}
      showHistory
      showToolbar
      userId={user.id}
    />
  );
}
