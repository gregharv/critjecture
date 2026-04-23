import { ObservationalRunPageClient } from "@/components/observational-run-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { getObservationalRunDetail } from "@/lib/observational-analysis";

export const dynamic = "force-dynamic";

export default async function ObservationalRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const user = await requirePageUser();
  const { runId } = await params;

  let runDetail: Awaited<ReturnType<typeof getObservationalRunDetail>> | null = null;

  try {
    runDetail = await getObservationalRunDetail({
      organizationId: user.organizationId,
      runId,
    });
  } catch {
    runDetail = null;
  }

  if (!runDetail) {
    return (
      <section className="observational-page">
        <div className="observational-card">
          <h1 className="observational-card__title">Observational run not found</h1>
          <p className="observational-card__copy">
            The requested observational run does not exist in the current organization.
          </p>
        </div>
      </section>
    );
  }

  return <ObservationalRunPageClient initialRunDetail={runDetail} />;
}
