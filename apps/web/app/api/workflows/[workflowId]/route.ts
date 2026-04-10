import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import {
  getWorkflowDetail,
  updateWorkflow,
  type WorkflowVersionInput,
} from "@/lib/workflows";
import {
  isWorkflowStatus,
  isWorkflowVisibility,
  type WorkflowStatus,
  type WorkflowVisibility,
} from "@/lib/workflow-types";

export const runtime = "nodejs";

type WorkflowRouteContext = {
  params: Promise<{
    workflowId: string;
  }>;
};

type UpdateWorkflowRequestBody = {
  description?: string | null;
  name?: string;
  status?: string;
  version?: WorkflowVersionInput;
  visibility?: string;
};

function normalizeWorkflowStatus(status: string | undefined): WorkflowStatus | undefined {
  if (typeof status === "undefined") {
    return undefined;
  }

  return isWorkflowStatus(status) ? status : undefined;
}

function normalizeWorkflowVisibility(
  visibility: string | undefined,
): WorkflowVisibility | undefined {
  if (typeof visibility === "undefined") {
    return undefined;
  }

  return isWorkflowVisibility(visibility) ? visibility : undefined;
}

export async function GET(_request: Request, context: WorkflowRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "workflow",
    routeKey: "workflow.detail",
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

  if (!user.access.canViewWorkflows) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse("This membership cannot view workflows.", 403),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "workflow",
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

  const { workflowId } = await context.params;
  const normalizedWorkflowId = workflowId.trim();

  if (!normalizedWorkflowId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("workflowId must be a non-empty string.", 400),
    });
  }

  try {
    const workflow = await getWorkflowDetail({
      organizationId: user.organizationId,
      workflowId: normalizedWorkflowId,
    });

    if (!workflow) {
      return finalizeObservedRequest(observed, {
        errorCode: "workflow_not_found",
        outcome: "error",
        response: buildObservedErrorResponse("Workflow not found.", 404),
      });
    }

    return finalizeObservedRequest(observed, {
      metadata: {
        workflowId: normalizedWorkflowId,
      },
      outcome: "ok",
      response: NextResponse.json({ workflow }),
      usageEvents: [
        {
          eventType: "workflow_definition_viewed",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_detail_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to load workflow.",
        500,
      ),
    });
  }
}

export async function PATCH(request: Request, context: WorkflowRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "PATCH",
    routeGroup: "workflow",
    routeKey: "workflow.update",
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

  if (!user.access.canManageWorkflows || (user.role !== "admin" && user.role !== "owner")) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse("Only admin and owner can manage workflows.", 403),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "workflow",
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

  const { workflowId } = await context.params;
  const normalizedWorkflowId = workflowId.trim();

  if (!normalizedWorkflowId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("workflowId must be a non-empty string.", 400),
    });
  }

  let body: UpdateWorkflowRequestBody;

  try {
    body = (await request.json()) as UpdateWorkflowRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const normalizedStatus = normalizeWorkflowStatus(body.status);

  if (typeof body.status !== "undefined" && !normalizedStatus) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse(
        "status must be one of draft, active, paused, or archived.",
        400,
      ),
    });
  }

  const normalizedVisibility = normalizeWorkflowVisibility(body.visibility);

  if (typeof body.visibility !== "undefined" && !normalizedVisibility) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("visibility must be private or organization.", 400),
    });
  }

  const hasChanges =
    typeof body.name !== "undefined" ||
    typeof body.description !== "undefined" ||
    typeof normalizedStatus !== "undefined" ||
    typeof normalizedVisibility !== "undefined" ||
    typeof body.version !== "undefined";

  if (!hasChanges) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("No workflow changes were provided.", 400),
    });
  }

  try {
    const workflow = await updateWorkflow({
      organizationId: user.organizationId,
      patch: {
        description: body.description,
        name: body.name,
        status: normalizedStatus,
        version: body.version,
        visibility: normalizedVisibility,
      },
      updatedByUserId: user.id,
      workflowId: normalizedWorkflowId,
    });

    if (!workflow) {
      return finalizeObservedRequest(observed, {
        errorCode: "workflow_not_found",
        outcome: "error",
        response: buildObservedErrorResponse("Workflow not found.", 404),
      });
    }

    return finalizeObservedRequest(observed, {
      metadata: {
        workflowId: normalizedWorkflowId,
      },
      outcome: "ok",
      response: NextResponse.json({ workflow }),
      usageEvents: [
        {
          eventType: "workflow_definition_updated",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_update_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to update workflow.",
        400,
      ),
    });
  }
}
