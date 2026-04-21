import { CausalStudiesPageClient } from "@/components/causal-studies-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { listCausalStudiesForOrganization } from "@/lib/causal-studies";

export const dynamic = "force-dynamic";

export default async function CausalStudiesPage() {
  const user = await requirePageUser();
  const studies = await listCausalStudiesForOrganization(user.organizationId);

  return <CausalStudiesPageClient initialStudies={studies} />;
}
