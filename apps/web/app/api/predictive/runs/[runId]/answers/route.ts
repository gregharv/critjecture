import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { createGroundedPredictiveAnswer, listPredictiveAnswersForRun } from "@/lib/predictive-answers";

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
    const answers = await listPredictiveAnswersForRun({
      organizationId: user.organizationId,
      runId,
    });

    return NextResponse.json({ answers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load predictive answers.";
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
    const answer = await createGroundedPredictiveAnswer({
      organizationId: user.organizationId,
      runId,
    });

    return NextResponse.json({ answer }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate grounded predictive answer.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
