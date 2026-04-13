import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { executeWorkflowRun } from "@/lib/workflow-engine";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import { isWorkflowAsyncManualRunsEnabled } from "@/lib/workflow-flags";
import { createManualWorkflowRun, listWorkflowRuns } from "@/lib/workflow-runs";
import { ensureWorkflowRunWorkerRunning } from "@/lib/workflow-worker";
import { getWorkflowDetail } from "@/lib/workflows";

export const runtime = "nodejs";

type WorkflowRunsRouteContext = {
  params: Promise<{
    workflowId: string;
  }>;
};

function parseLimit(request: Request) {
  const requestUrl = new URL(request.url);
  const rawLimit = requestUrl.searchParams.get("limit");

  if (!rawLimit) {
    return 50;
  }

  const parsed = Number.parseInt(rawLimit, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("limit must be a positive integer.");
  }

  return Math.min(parsed, 200);
}

export async function GET(request: Request, context: WorkflowRunsRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "workflow",
    routeKey: "workflow.runs.list",
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
      response: buildObservedErrorResponse("This membership cannot view workflow runs.", 403),
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

  let limit: number;

  try {
    limit = parseLimit(request);
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Invalid limit query value.",
        400,
      ),
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

    const payload = await listWorkflowRuns({
      limit,
      organizationId: user.organizationId,
      workflowId: normalizedWorkflowId,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        runCount: payload.runs.length,
        workflowId: normalizedWorkflowId,
      },
      outcome: "ok",
      response: NextResponse.json(payload),
      usageEvents: [
        {
          eventType: "workflow_runs_listed",
          quantity: payload.runs.length,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_runs_list_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to list workflow runs.",
        500,
      ),
    });
  }
}

export async function POST(_request: Request, context: WorkflowRunsRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "workflow",
    routeKey: "workflow.runs.create",
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
      response: buildObservedErrorResponse("Only admin and owner can trigger workflow runs.", 403),
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

  const runAsRole = user.role;

  if (runAsRole !== "admin" && runAsRole !== "owner") {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse("Only admin and owner can trigger workflow runs.", 403),
    });
  }

  try {
    const queuedRun = await createManualWorkflowRun({
      organizationId: user.organizationId,
      requestId: observed.requestId,
      runAsRole,
      runAsUserId: user.id,
      workflowId: normalizedWorkflowId,
    });

    if (isWorkflowAsyncManualRunsEnabled()) {
      ensureWorkflowRunWorkerRunning();

      return finalizeObservedRequest(observed, {
        metadata: {
          runId: queuedRun.id,
          status: queuedRun.status,
          workflowId: normalizedWorkflowId,
        },
        outcome: "ok",
        response: NextResponse.json(
          {
            completedStepCount: 0,
            run: queuedRun,
            status: "queued",
            totalStepCount: 0,
          },
          { status: 202 },
        ),
        usageEvents: [
          {
            eventType: "workflow_run_queued",
            quantity: 1,
            status: "ok",
            usageClass: "system",
          },
        ],
      });
    }

    const execution = await executeWorkflowRun({
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      runId: queuedRun.id,
    });

    const responseStatusCode =
      execution.status === "completed"
        ? 201
        : execution.status === "waiting_for_input"
          ? 202
          : 200;

    return finalizeObservedRequest(observed, {
      metadata: {
        completedStepCount: execution.completedStepCount,
        runId: execution.run.id,
        status: execution.status,
        totalStepCount: execution.totalStepCount,
        workflowId: normalizedWorkflowId,
      },
      outcome: execution.status === "failed" ? "error" : "ok",
      response: NextResponse.json(
        {
          completedStepCount: execution.completedStepCount,
          run: execution.run,
          status: execution.status,
          totalStepCount: execution.totalStepCount,
        },
        { status: responseStatusCode },
      ),
      usageEvents: [
        {
          eventType:
            execution.status === "completed"
              ? "workflow_run_completed"
              : execution.status === "skipped"
                ? "workflow_run_skipped"
                : execution.status === "waiting_for_input"
                  ? "workflow_run_waiting_for_input"
                  : execution.status === "blocked_validation"
                    ? "workflow_run_blocked_validation"
                    : "workflow_run_failed",
          quantity: 1,
          status: execution.status,
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_run_create_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to queue workflow run.",
        400,
      ),
    });
  }
}
