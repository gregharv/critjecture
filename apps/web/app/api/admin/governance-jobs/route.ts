import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  getGovernanceJob,
  listGovernanceJobs,
  queueHistoryPurgeJob,
  queueImportMetadataPurgeJob,
  queueKnowledgeDeletionJob,
  queueOrganizationExportJob,
} from "@/lib/governance";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
} from "@/lib/operations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireOwnerUser() {
  const user = await getSessionUser();

  if (!user) {
    return { error: jsonError("Authentication required.", 401), user: null };
  }

  return { error: null, user };
}

export async function GET() {
  const { error, user } = await requireOwnerUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "governance",
    routeKey: "governance.jobs.list",
    user,
  });

  if (error || !user) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_forbidden",
      outcome: "error",
      response: error ?? jsonError("Authentication required.", 401),
    });
  }

  if (!user.access.canViewGovernance) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_forbidden",
      outcome: "error",
      response: buildObservedErrorResponse("This membership cannot view governance jobs.", 403),
    });
  }

  return finalizeObservedRequest(observed, {
    outcome: "ok",
    response: NextResponse.json(await listGovernanceJobs(user.organizationId)),
  });
}

export async function POST(request: Request) {
  const { error, user } = await requireOwnerUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "governance",
    routeKey: "governance.jobs.create",
    user,
  });

  if (error || !user) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_forbidden",
      outcome: "error",
      response: error ?? jsonError("Authentication required.", 401),
    });
  }

  if (!user.access.canManageGovernance) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_forbidden",
      outcome: "error",
      response: buildObservedErrorResponse("Only Owner can manage governance jobs.", 403),
    });
  }

  let body: {
    cutoffTimestamp?: number;
    exportJobId?: string;
    jobType?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  try {
    let jobId: string;

    if (body.jobType === "organization_export") {
      jobId = await queueOrganizationExportJob(user, observed.requestId);
    } else if (
      typeof body.cutoffTimestamp === "number" &&
      typeof body.exportJobId === "string" &&
      body.jobType === "history_purge"
    ) {
      jobId = await queueHistoryPurgeJob({
        cutoffTimestamp: body.cutoffTimestamp,
        exportJobId: body.exportJobId,
        triggerRequestId: observed.requestId,
        user,
      });
    } else if (
      typeof body.cutoffTimestamp === "number" &&
      typeof body.exportJobId === "string" &&
      body.jobType === "import_metadata_purge"
    ) {
      jobId = await queueImportMetadataPurgeJob({
        cutoffTimestamp: body.cutoffTimestamp,
        exportJobId: body.exportJobId,
        triggerRequestId: observed.requestId,
        user,
      });
    } else if (
      typeof body.cutoffTimestamp === "number" &&
      typeof body.exportJobId === "string" &&
      body.jobType === "knowledge_delete"
    ) {
      jobId = await queueKnowledgeDeletionJob({
        cutoffTimestamp: body.cutoffTimestamp,
        exportJobId: body.exportJobId,
        triggerRequestId: observed.requestId,
        user,
      });
    } else {
      return finalizeObservedRequest(observed, {
        errorCode: "invalid_governance_request",
        governanceJobId: null,
        outcome: "error",
        response: buildObservedErrorResponse("Invalid governance job request.", 400),
      });
    }

    return finalizeObservedRequest(observed, {
      governanceJobId: jobId,
      metadata: {
        governanceJobId: jobId,
      },
      outcome: "ok",
      response: NextResponse.json(await getGovernanceJob(user.organizationId, jobId), {
        status: 202,
      }),
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "governance_job_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to queue governance job.",
        400,
      ),
    });
  }
}
