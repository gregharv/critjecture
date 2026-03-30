import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getGovernanceJob } from "@/lib/governance";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    correlation: {
      governanceJobId: jobId,
    },
    method: "GET",
    routeGroup: "governance",
    routeKey: "governance.jobs.detail",
    user,
  });

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      governanceJobId: jobId,
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  if (!user.access.canViewGovernance) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_forbidden",
      governanceJobId: jobId,
      outcome: "error",
      response: buildObservedErrorResponse("This membership cannot view governance jobs.", 403),
    });
  }

  try {
    return finalizeObservedRequest(observed, {
      governanceJobId: jobId,
      outcome: "ok",
      response: NextResponse.json(await getGovernanceJob(user.organizationId, jobId)),
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load governance job.";

    return finalizeObservedRequest(observed, {
      errorCode: "governance_job_lookup_failed",
      governanceJobId: jobId,
      outcome: "error",
      response: buildObservedErrorResponse(message, message.includes("not found") ? 404 : 400),
    });
  }
}
