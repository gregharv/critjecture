import { AdminLogsPageClient } from "@/components/admin-logs-page-client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireOwnerPageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminLogsPage() {
  const user = await requireOwnerPageUser();

  return (
    <WorkspaceShell activePage="logs" user={user}>
      <AdminLogsPageClient />
    </WorkspaceShell>
  );
}
