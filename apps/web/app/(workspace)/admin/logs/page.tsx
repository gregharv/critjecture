import { AdminLogsPageClient } from "@/components/admin-logs-page-client";
import { requirePageUserCapability } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminLogsPage() {
  await requirePageUserCapability("audit_logs_view");

  return <AdminLogsPageClient />;
}
