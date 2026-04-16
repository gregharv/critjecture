import { WorkflowsPageClient } from "@/components/workflows-page-client";
import { requirePageUserCapability } from "@/lib/auth-state";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const user = await requirePageUserCapability("workflow_view");

  return <WorkflowsPageClient access={user.access} />;
}
