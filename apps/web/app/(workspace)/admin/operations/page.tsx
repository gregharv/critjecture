import { OperationsPageClient } from "@/components/operations-page-client";
import { requirePageUserCapability } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function AdminOperationsPage() {
  await requirePageUserCapability("operations_view");

  return <OperationsPageClient />;
}
