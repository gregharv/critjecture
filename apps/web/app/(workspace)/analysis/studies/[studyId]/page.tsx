import { AnalysisStudyPageClient } from "@/components/analysis-study-page-client";
import { requirePageUser } from "@/lib/auth-state";
import { listAnalysisAnswersForStudy } from "@/lib/analysis-answers";
import { getAnalysisComparisonStateForStudy } from "@/lib/analysis-comparisons";
import { getAnalysisDagWorkspaceDetail } from "@/lib/analysis-dags";
import { listAnalysisRunsForStudy } from "@/lib/analysis-runs";
import { getAnalysisStudyById, getAnalysisStudyQuestionSummary } from "@/lib/analysis-studies";
import { getStudyDatasetBindingDetail } from "@/lib/study-dataset-bindings";

export const dynamic = "force-dynamic";

function getSingleQueryParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;
}

export default async function AnalysisStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const { studyId } = await params;
  const resolvedSearchParams = await searchParams;
  const study = await getAnalysisStudyById({
    organizationId: user.organizationId,
    studyId,
  });

  if (!study) {
    return (
      <section className="analysis-page">
        <div className="analysis-card">
          <h1 className="analysis-card__title">Analysis study not found</h1>
          <p className="analysis-card__copy">The requested study does not exist in this organization.</p>
        </div>
      </section>
    );
  }

  const [currentQuestion, datasetBinding, initialDagWorkspace, initialRuns, initialAnswers, initialComparisonState] = await Promise.all([
    getAnalysisStudyQuestionSummary({ organizationId: user.organizationId, studyId }),
    getStudyDatasetBindingDetail({ organizationId: user.organizationId, studyId }),
    getAnalysisDagWorkspaceDetail({ organizationId: user.organizationId, studyId }),
    listAnalysisRunsForStudy({ organizationId: user.organizationId, studyId }),
    listAnalysisAnswersForStudy({ organizationId: user.organizationId, studyId }),
    getAnalysisComparisonStateForStudy({ organizationId: user.organizationId, studyId, userId: user.id }),
  ]);

  return (
    <AnalysisStudyPageClient
      initialAnswers={initialAnswers}
      initialComparison={{
        baseRunId: getSingleQueryParam(resolvedSearchParams.baseRunId),
        targetRunId: getSingleQueryParam(resolvedSearchParams.targetRunId),
      }}
      initialComparisonState={initialComparisonState}
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
