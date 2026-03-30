import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  createKnowledgeImportJobFromArchive,
  createKnowledgeImportJobFromFiles,
  listKnowledgeImportJobs,
} from "@/lib/knowledge-imports";
import {
  beginObservedRequest,
  buildBudgetExceededResponse,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceBudgetPolicy,
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
  const routeKey = "knowledge.import_jobs.create";
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "knowledge_import",
    routeKey,
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

  const fileEntries = archive instanceof File ? [] : formData.getAll("files");
  const pathEntries = archive instanceof File ? [] : formData.getAll("paths");
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
  const importQuantity = archive instanceof File ? 1 : files.length;

  if (importQuantity > 0) {
    const budgetDecision = await enforceBudgetPolicy({
      quantity: importQuantity,
      requestId: observed.requestId,
      routeGroup: "knowledge_import",
      routeKey,
      user,
    });

    if (budgetDecision) {
      return finalizeObservedRequest(observed, {
        errorCode: budgetDecision.errorCode,
        metadata: budgetDecision.metadata,
        outcome: "blocked",
        response: buildBudgetExceededResponse(budgetDecision),
      });
    }
  }

  try {
    let job;

    if (archive instanceof File) {
      job = await createKnowledgeImportJobFromArchive({
        archive,
        requestedScope: scope,
        triggerRequestId: observed.requestId,
        user,
      });
    } else {
      job = await createKnowledgeImportJobFromFiles({
        files,
        requestedScope: scope,
        sourceKind: mode === "single_file" ? "single_file" : "directory",
        triggerRequestId: observed.requestId,
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
      knowledgeImportJobId: job.id,
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "knowledge_import_job",
          metadata: {
            accessScope: job.accessScope,
            sourceKind: job.sourceKind,
          },
          quantity: job.totalFileCount,
          status: job.status,
          subjectName: job.id,
          usageClass: "import",
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
