import { NextResponse } from "next/server";

import { processDueWorkflowDeliveryRetries } from "@/lib/workflow-delivery";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type RetryRequestBody = {
  limit?: number;
  organizationId?: string;
  runId?: string;
};

function getBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization") ?? "";

  if (authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return authorizationHeader.slice(7).trim();
  }

  return (request.headers.get("x-critjecture-internal-token") ?? "").trim();
}

function isAuthorizedInternalRequest(request: Request) {
  const expectedSecret = (process.env.CRITJECTURE_WORKFLOW_TICK_SECRET ?? "").trim();

  if (!expectedSecret) {
    return { configured: false, authorized: false };
  }

  const providedToken = getBearerToken(request);

  return {
    authorized: Boolean(providedToken) && providedToken === expectedSecret,
    configured: true,
  };
}

export async function POST(request: Request) {
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "workflow",
    routeKey: "workflow.internal.retry_deliveries",
    user: null,
  });
  await runOperationsMaintenance();
  const auth = isAuthorizedInternalRequest(request);

  if (!auth.configured) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_internal_secret_missing",
      outcome: "error",
      response: buildObservedErrorResponse("Internal workflow tick secret is not configured.", 503),
    });
  }

  if (!auth.authorized) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_internal_unauthorized",
      outcome: "blocked",
      response: buildObservedErrorResponse("Unauthorized.", 401),
    });
  }

  let body: RetryRequestBody = {};

  try {
    const rawBody = await request.text();

    if (rawBody.trim()) {
      body = JSON.parse(rawBody) as RetryRequestBody;
    }
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const organizationId =
    typeof body.organizationId === "string" ? body.organizationId.trim() : undefined;
  const runId = typeof body.runId === "string" ? body.runId.trim() : undefined;

  if (typeof body.organizationId === "string" && !organizationId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse(
        "organizationId must be a non-empty string when provided.",
        400,
      ),
    });
  }

  if (typeof body.runId === "string" && !runId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("runId must be a non-empty string when provided.", 400),
    });
  }

  if (typeof body.limit !== "undefined") {
    if (!Number.isFinite(body.limit) || body.limit <= 0) {
      return finalizeObservedRequest(observed, {
        errorCode: "invalid_workflow_request",
        outcome: "error",
        response: buildObservedErrorResponse("limit must be a positive number when provided.", 400),
      });
    }
  }

  try {
    const result = await processDueWorkflowDeliveryRetries({
      limit: body.limit,
      organizationId,
      runId,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        deliveryRetriesProcessed: result.processedCount,
        runId: runId ?? null,
      },
      outcome: "ok",
      response: NextResponse.json(result, { status: 202 }),
      usageEvents: [
        {
          eventType: "workflow_delivery_retries_processed",
          quantity: result.processedCount,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_internal_delivery_retry_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to retry pending workflow deliveries.",
        500,
      ),
    });
  }
}
