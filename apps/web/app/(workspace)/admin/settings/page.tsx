import { AdminSettingsPageClient } from "@/components/admin-settings-page-client";
import { requirePageUserCapability } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await requirePageUserCapability("admin_settings");

  return <AdminSettingsPageClient access={user.access} role={user.role} />;
}
