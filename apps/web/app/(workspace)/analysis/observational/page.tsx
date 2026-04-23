import { ObservationalWorkspacePageClient } from "@/components/observational-workspace-page-client";
import { requirePageUser } from "@/lib/auth-state";
import {
  listObservationalDatasetCatalog,
  listObservationalRunsForOrganization,
} from "@/lib/observational-analysis";

export const dynamic = "force-dynamic";

export default async function ObservationalWorkspacePage() {
  const user = await requirePageUser();
  const [catalog, runs] = await Promise.all([
    listObservationalDatasetCatalog(user.organizationId),
    listObservationalRunsForOrganization({ organizationId: user.organizationId, limit: 20 }),
  ]);

  return <ObservationalWorkspacePageClient initialCatalog={catalog} initialRuns={runs} />;
}
