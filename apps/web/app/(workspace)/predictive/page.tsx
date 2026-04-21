import { PredictiveWorkspacePageClient } from "@/components/predictive-workspace-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { listPredictiveDatasetCatalog, listPredictiveRunsForOrganization } from "@/lib/predictive-analysis";

export const dynamic = "force-dynamic";

export default async function PredictiveWorkspacePage() {
  const user = await requirePageUser();
  const [catalog, runs] = await Promise.all([
    listPredictiveDatasetCatalog(user.organizationId),
    listPredictiveRunsForOrganization({ organizationId: user.organizationId, limit: 20 }),
  ]);

  return <PredictiveWorkspacePageClient initialCatalog={catalog} initialRuns={runs} />;
}
