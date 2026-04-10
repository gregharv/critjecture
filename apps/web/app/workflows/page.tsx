import { WorkflowsPageClient } from "@/components/workflows-page-client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requirePageUserCapability } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const user = await requirePageUserCapability("workflow_view");

  return (
    <WorkspaceShell activePage="workflows" user={user}>
      <WorkflowsPageClient access={user.access} />
    </WorkspaceShell>
  );
}
