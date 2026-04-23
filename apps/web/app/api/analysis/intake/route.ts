import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { runAnalysisIntake } from "@/lib/analysis-intake";
import { parseAnalysisIntakeRequest } from "@/lib/analysis-routing-types";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsed = parseAnalysisIntakeRequest(body);

  if (!parsed) {
    return jsonError("Request body must include a non-empty message string.", 400);
  }

  try {
    const response = await runAnalysisIntake({
      clarificationState: parsed.clarificationState,
      message: parsed.message,
      requestedStudyId: parsed.studyId,
      user,
    });

    return NextResponse.json(response, {
      status:
        response.decision === "open_rung2_study" || response.decision === "open_rung3_study"
          ? 201
          : 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis intake failed.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
