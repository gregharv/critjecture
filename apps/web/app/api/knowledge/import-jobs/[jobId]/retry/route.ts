import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { retryKnowledgeImportJob } from "@/lib/knowledge-imports";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "knowledge_import",
    routeKey: "knowledge.import_jobs.retry",
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

  if (!user.access.canWriteKnowledge) {
    return finalizeObservedRequest(observed, {
      errorCode: "knowledge_import_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse(
        "This membership cannot retry knowledge import jobs.",
        403,
      ),
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

  try {
    const { jobId } = await context.params;
    const job = await retryKnowledgeImportJob(user, jobId);
    const response = NextResponse.json({ job });

    return finalizeObservedRequest(observed, {
      metadata: {
        jobId: job.id,
        retryableFailedFileCount: job.retryableFailedFileCount,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "knowledge_import_retry",
          metadata: {
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
      errorCode: "knowledge_import_retry_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Retry failed.",
        400,
      ),
    });
  }
}
