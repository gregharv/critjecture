import { NextResponse } from "next/server";

import { listAnalysisAnswersForStudy } from "@/lib/analysis-answers";
import { getAnalysisComparisonStateForStudy } from "@/lib/analysis-comparisons";
import { getAnalysisDagWorkspaceDetail } from "@/lib/analysis-dags";
import { listAnalysisRunsForStudy } from "@/lib/analysis-runs";
import {
  getAnalysisStudyById,
  getAnalysisStudyQuestionSummary,
  updateAnalysisStudy,
} from "@/lib/analysis-studies";
import { getSessionUser } from "@/lib/auth-state";
import { getStudyDatasetBindingDetail } from "@/lib/study-dataset-bindings";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { studyId } = await context.params;
  const study = await getAnalysisStudyById({
    organizationId: user.organizationId,
    studyId,
  });

  if (!study) {
    return jsonError("Analysis study not found.", 404);
  }

  const [currentQuestion, datasetBinding, dagWorkspace, runs, answers, comparisonState] = await Promise.all([
    getAnalysisStudyQuestionSummary({ organizationId: user.organizationId, studyId }),
    getStudyDatasetBindingDetail({ organizationId: user.organizationId, studyId }),
    getAnalysisDagWorkspaceDetail({ organizationId: user.organizationId, studyId }),
    listAnalysisRunsForStudy({ organizationId: user.organizationId, studyId }),
    listAnalysisAnswersForStudy({ organizationId: user.organizationId, studyId }),
    getAnalysisComparisonStateForStudy({ organizationId: user.organizationId, studyId, userId: user.id }),
  ]);

  return NextResponse.json({
    answers,
    comparisonState,
    currentQuestion,
    dagWorkspace,
    datasetBinding,
    runs,
    study: {
      createdAt: study.createdAt,
      currentQuestionId: study.currentQuestionId,
      description: study.description,
      id: study.id,
      status: study.status,
      title: study.title,
      updatedAt: study.updatedAt,
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { studyId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const title =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title
      : undefined;
  const description =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { description?: unknown }).description === "string"
      ? (body as { description: string }).description
      : undefined;

  if (typeof title === "undefined" && typeof description === "undefined") {
    return jsonError("At least one of title or description must be provided.", 400);
  }

  try {
    const study = await updateAnalysisStudy({
      description,
      organizationId: user.organizationId,
      studyId,
      title,
    });

    return NextResponse.json({ study });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update analysis study.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
