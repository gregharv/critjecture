import { AnalysisRunPageClient } from "@/components/analysis-run-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { getAnalysisRunDetail } from "@/lib/analysis-runs";
import { getAnalysisStudyById } from "@/lib/analysis-studies";

export const dynamic = "force-dynamic";

export default async function AnalysisRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string; studyId: string }>;
}) {
  const user = await requirePageUser();
  const { runId, studyId } = await params;

  const [study, runDetail] = await Promise.all([
    getAnalysisStudyById({ organizationId: user.organizationId, studyId }),
    getAnalysisRunDetail({ organizationId: user.organizationId, runId }),
  ]);

  if (!study || runDetail.run.studyId !== studyId) {
    return (
      <section className="analysis-page">
        <div className="analysis-card">
          <h1 className="analysis-card__title">Analysis run not found</h1>
          <p className="analysis-card__copy">
            The requested run does not exist for this study in the current organization.
          </p>
        </div>
      </section>
    );
  }

  return (
    <AnalysisRunPageClient
      initialRunDetail={runDetail}
      study={{ id: study.id, title: study.title }}
    />
  );
}
