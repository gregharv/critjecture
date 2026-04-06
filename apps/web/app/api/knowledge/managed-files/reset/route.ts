import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  getGovernanceJob,
  queueImportMetadataPurgeJob,
  queueKnowledgeDeletionJob,
  queueOrganizationExportJob,
} from "@/lib/governance";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForGovernanceJobCompletion(input: {
  label: string;
  jobId: string;
  organizationId: string;
  timeoutMs: number;
}) {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() <= deadline) {
    const { job } = await getGovernanceJob(input.organizationId, input.jobId);

    if (job.status === "completed") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(
        `${input.label} failed${job.errorMessage ? `: ${job.errorMessage}` : "."}`,
      );
    }

    await sleep(1000);
  }

  throw new Error(`${input.label} timed out after ${Math.ceil(input.timeoutMs / 1000)} seconds.`);
}

export async function POST() {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canManageGovernance) {
    return jsonError("Only Owner can manage governance jobs.", 403);
  }

  try {
    const exportJobId = await queueOrganizationExportJob(user);
    const exportJob = await waitForGovernanceJobCompletion({
      label: "Export job",
      jobId: exportJobId,
      organizationId: user.organizationId,
      timeoutMs: 45_000,
    });

    if (exportJob.status !== "completed") {
      return jsonError("The export job did not complete.", 409);
    }

    const cutoffTimestamp = Date.now() + 1;
    const deletionJobId = await queueKnowledgeDeletionJob({
      cutoffTimestamp,
      exportJobId,
      user,
    });
    const importMetadataPurgeJobId = await queueImportMetadataPurgeJob({
      cutoffTimestamp,
      exportJobId,
      user,
    });

    const [deletionJob, importMetadataPurgeJob] = await Promise.all([
      waitForGovernanceJobCompletion({
        label: "Knowledge deletion job",
        jobId: deletionJobId,
        organizationId: user.organizationId,
        timeoutMs: 45_000,
      }),
      waitForGovernanceJobCompletion({
        label: "Import metadata purge job",
        jobId: importMetadataPurgeJobId,
        organizationId: user.organizationId,
        timeoutMs: 45_000,
      }),
    ]);

    const deletedKnowledgeFileCount = Number(
      deletionJob.result?.deletedKnowledgeFileCount ?? 0,
    );
    const deletedImportJobCount = Number(
      importMetadataPurgeJob.result?.deletedImportJobCount ?? 0,
    );

    return NextResponse.json(
      {
        deletedImportJobCount,
        deletedKnowledgeFileCount,
        deletionJobId,
        exportJobId,
        importMetadataPurgeJobId,
      },
      { status: 200 },
    );
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to reset managed files.",
      500,
    );
  }
}
