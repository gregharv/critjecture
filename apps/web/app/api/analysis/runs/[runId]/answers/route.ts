import { NextResponse } from "next/server";

import { createGroundedAnalysisAnswer, listAnalysisAnswersForRun } from "@/lib/analysis-answers";
import { getSessionUser } from "@/lib/auth-state";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { runId } = await context.params;

  try {
    const answers = await listAnalysisAnswersForRun({
      organizationId: user.organizationId,
      runId,
    });

    return NextResponse.json({ answers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load analysis answers.";
    return jsonError(message, 400);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canUseAnswerTools) {
    return jsonError("This membership cannot generate grounded answers.", 403);
  }

  const { runId } = await context.params;

  try {
    const answer = await createGroundedAnalysisAnswer({
      organizationId: user.organizationId,
      runId,
    });

    return NextResponse.json({ answer }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate grounded analysis answer.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
