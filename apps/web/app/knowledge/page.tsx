import { KnowledgePageClient } from "@/components/knowledge-page-client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requirePageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const user = await requirePageUser();

  return (
    <WorkspaceShell activePage="knowledge" user={user}>
      <KnowledgePageClient access={user.access} role={user.role} />
    </WorkspaceShell>
  );
}
