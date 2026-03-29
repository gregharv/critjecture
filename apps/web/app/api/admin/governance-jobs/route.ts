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

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireOwnerUser() {
  const user = await getSessionUser();

  if (!user) {
    return { error: jsonError("Authentication required.", 401), user: null };
  }

  if (user.role !== "owner") {
    return { error: jsonError("Only Owner can manage governance jobs.", 403), user: null };
  }

  return { error: null, user };
}

export async function GET() {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  return NextResponse.json(await listGovernanceJobs(user.organizationId));
}

export async function POST(request: Request) {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  let body: {
    cutoffTimestamp?: number;
    exportJobId?: string;
    jobType?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  try {
    let jobId: string;

    if (body.jobType === "organization_export") {
      jobId = await queueOrganizationExportJob(user);
    } else if (
      typeof body.cutoffTimestamp === "number" &&
      typeof body.exportJobId === "string" &&
      body.jobType === "history_purge"
    ) {
      jobId = await queueHistoryPurgeJob({
        cutoffTimestamp: body.cutoffTimestamp,
        exportJobId: body.exportJobId,
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
        user,
      });
    } else {
      return jsonError("Invalid governance job request.", 400);
    }

    return NextResponse.json(await getGovernanceJob(user.organizationId, jobId), {
      status: 202,
    });
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to queue governance job.",
      400,
    );
  }
}
