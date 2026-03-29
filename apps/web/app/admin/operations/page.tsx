import { OperationsPageClient } from "@/components/operations-page-client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireOwnerPageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminOperationsPage() {
  const user = await requireOwnerPageUser();

  return (
    <WorkspaceShell activePage="operations" user={user}>
      <OperationsPageClient />
    </WorkspaceShell>
  );
}
