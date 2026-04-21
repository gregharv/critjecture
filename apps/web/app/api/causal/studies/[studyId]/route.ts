import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { listCausalAnswersForStudy } from "@/lib/causal-answers";
import { getCausalDagWorkspaceDetail } from "@/lib/causal-dags";
import { listCausalRunsForStudy } from "@/lib/causal-runs";
import { getCausalStudyById, getStudyQuestionSummary, updateCausalStudy } from "@/lib/causal-studies";
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
  const study = await getCausalStudyById({
    organizationId: user.organizationId,
    studyId,
  });

  if (!study) {
    return jsonError("Causal study not found.", 404);
  }

  const [currentQuestion, datasetBinding, dagWorkspace, runs, answers] = await Promise.all([
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

  return NextResponse.json({
    answers,
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
    const study = await updateCausalStudy({
      description,
      organizationId: user.organizationId,
      studyId,
      title,
    });

    return NextResponse.json({ study });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update causal study.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
