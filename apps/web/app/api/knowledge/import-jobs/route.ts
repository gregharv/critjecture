import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  createKnowledgeImportJobFromArchive,
  createKnowledgeImportJobFromFiles,
  listKnowledgeImportJobs,
} from "@/lib/knowledge-imports";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getStringFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  try {
    const jobs = await listKnowledgeImportJobs(user);
    return NextResponse.json({ jobs });
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to load knowledge import jobs.",
      500,
    );
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "knowledge_import",
    routeKey: "knowledge.import_jobs.create",
    user,
  });
  await runOperationsMaintenance();

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "knowledge_import",
    user,
  });

  if (rateLimitDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: rateLimitDecision.errorCode,
      metadata: {
        limit: rateLimitDecision.limit,
        scope: rateLimitDecision.scope,
        windowMs: rateLimitDecision.windowMs,
      },
      outcome: "rate_limited",
      response: buildRateLimitedResponse(rateLimitDecision),
    });
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_form_data",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be multipart form data.", 400),
    });
  }

  const scope = getStringFormValue(formData, "scope") || "public";
  const mode = getStringFormValue(formData, "mode") || "directory";
  const archive = formData.get("archive");

  try {
    let job;

    if (archive instanceof File) {
      job = await createKnowledgeImportJobFromArchive({
        archive,
        requestedScope: scope,
        user,
      });
    } else {
      const fileEntries = formData.getAll("files");
      const pathEntries = formData.getAll("paths");
      const files = fileEntries
        .map((entry, index) => {
          if (!(entry instanceof File)) {
            return null;
          }

          const relativePath =
            typeof pathEntries[index] === "string" && String(pathEntries[index]).trim()
              ? String(pathEntries[index]).trim()
              : entry.name;

          return {
            file: entry,
            relativePath,
          };
        })
        .filter((entry): entry is { file: File; relativePath: string } => entry !== null);

      job = await createKnowledgeImportJobFromFiles({
        files,
        requestedScope: scope,
        sourceKind: mode === "single_file" ? "single_file" : "directory",
        user,
      });
    }

    const response = NextResponse.json({ job }, { status: 202 });
    return finalizeObservedRequest(observed, {
      metadata: {
        accessScope: job.accessScope,
        jobId: job.id,
        sourceKind: job.sourceKind,
        totalFileCount: job.totalFileCount,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "knowledge_import_job",
          metadata: {
            accessScope: job.accessScope,
            sourceKind: job.sourceKind,
          },
          quantity: 1,
          status: job.status,
          subjectName: job.id,
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "knowledge_import_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Knowledge import failed.",
        400,
      ),
    });
  }
}
