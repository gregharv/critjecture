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
  createWorkflow,
  listWorkflowsForOrganization,
  type WorkflowVersionInput,
} from "@/lib/workflows";
import {
  isWorkflowStatus,
  isWorkflowVisibility,
  type WorkflowStatus,
  type WorkflowVisibility,
} from "@/lib/workflow-types";

export const runtime = "nodejs";

type CreateWorkflowRequestBody = {
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

export async function GET() {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "workflow",
    routeKey: "workflow.list",
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

  try {
    const payload = await listWorkflowsForOrganization(user.organizationId);

    return finalizeObservedRequest(observed, {
      metadata: {
        workflowCount: payload.workflows.length,
      },
      outcome: "ok",
      response: NextResponse.json(payload),
      usageEvents: [
        {
          eventType: "workflow_definitions_listed",
          quantity: payload.workflows.length,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_list_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to list workflows.",
        500,
      ),
    });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "workflow",
    routeKey: "workflow.create",
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

  let body: CreateWorkflowRequestBody;

  try {
    body = (await request.json()) as CreateWorkflowRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  if (typeof body.name !== "string") {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("name is required.", 400),
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

  try {
    const workflow = await createWorkflow({
      createdByUserId: user.id,
      description: body.description,
      name: body.name,
      organizationId: user.organizationId,
      status: normalizedStatus,
      version: body.version,
      visibility: normalizedVisibility,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        workflowId: workflow?.workflow.id ?? null,
      },
      outcome: "ok",
      response: NextResponse.json({ workflow }, { status: 201 }),
      usageEvents: [
        {
          eventType: "workflow_definition_created",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_create_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to create workflow.",
        400,
      ),
    });
  }
}
