import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getGovernanceJob } from "@/lib/governance";

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

  if (user.role !== "owner") {
    return jsonError("Only Owner can view governance jobs.", 403);
  }

  try {
    const { jobId } = await context.params;
    return NextResponse.json(await getGovernanceJob(user.organizationId, jobId));
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load governance job.";

    return jsonError(message, message.includes("not found") ? 404 : 400);
  }
}
