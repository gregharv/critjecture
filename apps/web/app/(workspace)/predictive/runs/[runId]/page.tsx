import { PredictiveRunPageClient } from "@/components/predictive-run-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { getPredictiveRunDetail } from "@/lib/predictive-analysis";

export const dynamic = "force-dynamic";

export default async function PredictiveRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const user = await requirePageUser();
  const { runId } = await params;

  try {
    const runDetail = await getPredictiveRunDetail({
      organizationId: user.organizationId,
      runId,
    });

    return <PredictiveRunPageClient initialRunDetail={runDetail} />;
  } catch {
    return (
      <section className="causal-page">
        <div className="causal-card">
          <h1 className="causal-card__title">Predictive run not found</h1>
          <p className="causal-card__copy">
            The requested predictive run does not exist in the current organization.
          </p>
        </div>
      </section>
    );
  }
}
