import { CausalRunPageClient } from "@/components/causal-run-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { getCausalRunDetail } from "@/lib/causal-runs";
import { getCausalStudyById } from "@/lib/causal-studies";

export const dynamic = "force-dynamic";

export default async function CausalRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string; studyId: string }>;
}) {
  const user = await requirePageUser();
  const { runId, studyId } = await params;

  const [study, runDetail] = await Promise.all([
    getCausalStudyById({
      organizationId: user.organizationId,
      studyId,
    }),
    getCausalRunDetail({
      organizationId: user.organizationId,
      runId,
    }),
  ]);

  if (!study || runDetail.run.studyId !== studyId) {
    return (
      <section className="causal-page">
        <div className="causal-card">
          <h1 className="causal-card__title">Causal run not found</h1>
          <p className="causal-card__copy">
            The requested run does not exist for this study in the current organization.
          </p>
        </div>
      </section>
    );
  }

  return (
    <CausalRunPageClient
      initialRunDetail={runDetail}
      study={{
        id: study.id,
        title: study.title,
      }}
    />
  );
}
