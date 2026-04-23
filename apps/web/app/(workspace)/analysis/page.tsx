import { AnalysisStudiesPageClient } from "@/components/analysis-studies-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { listAnalysisStudiesForOrganization } from "@/lib/analysis-studies";

export const dynamic = "force-dynamic";

export default async function AnalysisStudiesPage() {
  const user = await requirePageUser();
  const studies = await listAnalysisStudiesForOrganization(user.organizationId);

  return <AnalysisStudiesPageClient initialStudies={studies} />;
}
