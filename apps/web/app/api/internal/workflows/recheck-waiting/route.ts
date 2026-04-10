import { NextResponse } from "next/server";

import { processDueWorkflowDeliveryRetries } from "@/lib/workflow-delivery";
import { recheckWaitingWorkflowRuns } from "@/lib/workflow-resume";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type RecheckRequestBody = {
  limit?: number;
  organizationId?: string;
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
    routeKey: "workflow.internal.recheck_waiting",
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

  let body: RecheckRequestBody = {};

  try {
    const rawBody = await request.text();

    if (rawBody.trim()) {
      body = JSON.parse(rawBody) as RecheckRequestBody;
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
    const [waitingRunRecheck, deliveryRetries] = await Promise.all([
      recheckWaitingWorkflowRuns({
        limit: body.limit,
        organizationId,
      }),
      processDueWorkflowDeliveryRetries({
        limit: body.limit,
        organizationId,
      }),
    ]);

    return finalizeObservedRequest(observed, {
      metadata: {
        deliveryRetriesProcessed: deliveryRetries.processedCount,
        waitingRunsAttempted: waitingRunRecheck.attemptedCount,
      },
      outcome: "ok",
      response: NextResponse.json(
        {
          deliveryRetries,
          waitingRunRecheck,
        },
        { status: 202 },
      ),
      usageEvents: [
        {
          eventType: "workflow_waiting_runs_rechecked",
          quantity: waitingRunRecheck.attemptedCount,
          status: "ok",
          usageClass: "system",
        },
        {
          eventType: "workflow_delivery_retries_processed",
          quantity: deliveryRetries.processedCount,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_internal_recheck_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to recheck waiting workflow runs.",
        500,
      ),
    });
  }
}
