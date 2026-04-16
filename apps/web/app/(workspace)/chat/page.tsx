import { ChatShellWithRole } from "@/components/chat-shell";
import { requirePageUser } from "@/lib/auth-state";
import { getRestrictedWorkspaceMessage } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requirePageUser();

  return user.access.canUseAnswerTools ? (
    <ChatShellWithRole
      organizationSlug={user.organizationSlug}
      role={user.role}
      userId={user.id}
    />
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
  );
}
