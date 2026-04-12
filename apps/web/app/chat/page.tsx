import { redirect } from "next/navigation";

import { ChatLandingShell } from "@/components/chat-landing-shell";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requirePageUser } from "@/lib/auth-state";
import { getRestrictedWorkspaceMessage } from "@/lib/access-control";
import { getAnalysisWorkspaceByConversation } from "@/lib/marimo-workspaces";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams?: Promise<{ conversation?: string }>;
}) {
  const user = await requirePageUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedConversationId = resolvedSearchParams?.conversation?.trim() ?? "";

  if (requestedConversationId && user.access.canUseAnswerTools) {
    const workspace = await getAnalysisWorkspaceByConversation({
      conversationId: requestedConversationId,
      organizationId: user.organizationId,
      userId: user.id,
    });

    if (workspace) {
      redirect(`/analysis/${encodeURIComponent(requestedConversationId)}`);
    }
  }

  return (
    <WorkspaceShell activePage="chat" user={user}>
      {user.access.canUseAnswerTools ? (
        <ChatLandingShell user={user} />
      ) : (
        <section className="settings-panel">
          <div className="settings-panel__header">
            <div>
              <div className="settings-panel__eyebrow">Access</div>
              <h2>Workspace restricted</h2>
            </div>
          </div>
          <p>{getRestrictedWorkspaceMessage(user.membershipStatus)}</p>
        </section>
      )}
    </WorkspaceShell>
  );
}
