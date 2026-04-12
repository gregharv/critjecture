import { AnalysisWorkspaceShell } from "@/components/analysis-workspace-shell";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getRestrictedWorkspaceMessage } from "@/lib/access-control";
import { requirePageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AnalysisWorkspacePage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const user = await requirePageUser();
  const { conversationId } = await params;

  return (
    <WorkspaceShell activePage="analysis" returnTo={`/analysis/${conversationId}`} user={user}>
      {user.access.canUseAnswerTools ? (
        <AnalysisWorkspaceShell conversationId={conversationId} user={user} />
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
