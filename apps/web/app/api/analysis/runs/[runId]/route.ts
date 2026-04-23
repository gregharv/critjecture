import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getAnalysisRunDetail } from "@/lib/analysis-runs";

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
    const result = await getAnalysisRunDetail({
      organizationId: user.organizationId,
      runId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load analysis run.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
