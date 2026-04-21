import { CausalStudyPageClient } from "@/components/causal-study-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { listCausalAnswersForStudy } from "@/lib/causal-answers";
import { getCausalDagWorkspaceDetail } from "@/lib/causal-dags";
import { listCausalRunsForStudy } from "@/lib/causal-runs";
import { getCausalStudyById, getStudyQuestionSummary } from "@/lib/causal-studies";
import { getStudyDatasetBindingDetail } from "@/lib/study-dataset-bindings";

export const dynamic = "force-dynamic";

export default async function CausalStudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const user = await requirePageUser();
  const { studyId } = await params;
  const study = await getCausalStudyById({
    organizationId: user.organizationId,
    studyId,
  });

  if (!study) {
    return (
      <section className="causal-page">
        <div className="causal-card">
          <h1 className="causal-card__title">Causal study not found</h1>
          <p className="causal-card__copy">
            The requested study does not exist in this organization.
          </p>
        </div>
      </section>
    );
  }

  const [currentQuestion, datasetBinding, initialDagWorkspace, initialRuns, initialAnswers] = await Promise.all([
    getStudyQuestionSummary({
      organizationId: user.organizationId,
      studyId,
    }),
    getStudyDatasetBindingDetail({
      organizationId: user.organizationId,
      studyId,
    }),
    getCausalDagWorkspaceDetail({
      organizationId: user.organizationId,
      studyId,
    }),
    listCausalRunsForStudy({
      organizationId: user.organizationId,
      studyId,
    }),
    listCausalAnswersForStudy({
      organizationId: user.organizationId,
      studyId,
    }),
  ]);

  return (
    <CausalStudyPageClient
      initialAnswers={initialAnswers}
      initialCurrentQuestion={currentQuestion}
      initialDagWorkspace={initialDagWorkspace}
      initialDatasetBinding={datasetBinding}
      initialRuns={initialRuns}
      study={{
        createdAt: study.createdAt,
        description: study.description,
        id: study.id,
        status: study.status,
        title: study.title,
        updatedAt: study.updatedAt,
      }}
    />
  );
}
