import { AdminSettingsPageClient } from "@/components/admin-settings-page-client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireOwnerPageUser } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await requireOwnerPageUser();

  return (
    <WorkspaceShell activePage="settings" user={user}>
      <AdminSettingsPageClient />
    </WorkspaceShell>
  );
}
