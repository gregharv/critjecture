import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getKnowledgeImportJob } from "@/lib/knowledge-imports";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  try {
    const { jobId } = await context.params;
    const detail = await getKnowledgeImportJob(user, jobId);
    return NextResponse.json(detail);
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to load knowledge import job.",
      404,
    );
  }
}
