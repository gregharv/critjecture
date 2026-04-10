import { NextResponse } from "next/server";

import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import { getWorkflowSchedulerGateStatus } from "@/lib/workflow-flags";
import { tickDueWorkflowSchedules } from "@/lib/workflow-scheduler";

export const runtime = "nodejs";

type TickRequestBody = {
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
    routeKey: "workflow.internal.tick",
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

  const gate = getWorkflowSchedulerGateStatus();

  if (!gate.enabled) {
    return finalizeObservedRequest(observed, {
      metadata: {
        schedulerEnabled: false,
        skippedReason: gate.reason,
      },
      outcome: "ok",
      response: NextResponse.json(
        {
          schedulerEnabled: false,
          skippedReason: gate.reason,
        },
        { status: 202 },
      ),
    });
  }

  let body: TickRequestBody = {};

  try {
    const rawBody = await request.text();

    if (rawBody.trim()) {
      body = JSON.parse(rawBody) as TickRequestBody;
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
    const summary = await tickDueWorkflowSchedules({
      limit: body.limit,
      organizationId,
      requestId: observed.requestId,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        claimedWorkflowCount: summary.claimedWorkflowCount,
        initializedNextRunCount: summary.initializedNextRunCount,
        queuedRunCount: summary.queuedRunCount,
        windowCount: summary.windowCount,
      },
      outcome: "ok",
      response: NextResponse.json(summary, { status: 202 }),
      usageEvents: [
        {
          eventType: "workflow_scheduler_tick",
          quantity: summary.windowCount,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_internal_tick_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to run workflow scheduler tick.",
        500,
      ),
    });
  }
}
