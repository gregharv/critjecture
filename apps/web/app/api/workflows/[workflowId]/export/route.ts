import { getSessionUser } from "@/lib/auth-state";
import { exportWorkflowZip, WorkflowExportError } from "@/lib/workflow-export";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type WorkflowExportRouteContext = {
  params: Promise<{
    workflowId: string;
  }>;
};

export async function GET(_request: Request, context: WorkflowExportRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "workflow",
    routeKey: "workflow.export",
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
      response: buildObservedErrorResponse("Only admin and owner can export workflows.", 403),
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
    const archive = await exportWorkflowZip({
      organizationId: user.organizationId,
      workflowId: normalizedWorkflowId,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        byteSize: archive.buffer.byteLength,
        workflowId: normalizedWorkflowId,
      },
      outcome: "ok",
      response: new Response(archive.buffer, {
        headers: {
          "Content-Disposition": `attachment; filename="${archive.archiveFileName}"`,
          "Content-Length": String(archive.buffer.byteLength),
          "Content-Type": "application/zip",
          "Cache-Control": "no-store",
        },
        status: 200,
      }),
      usageEvents: [
        {
          eventType: "workflow_definition_exported",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    if (caughtError instanceof WorkflowExportError) {
      const statusCode =
        caughtError.code === "workflow_not_found"
          ? 404
          : caughtError.code === "workflow_version_missing"
            ? 409
            : 400;

      return finalizeObservedRequest(observed, {
        errorCode: caughtError.code,
        outcome: "error",
        response: buildObservedErrorResponse(caughtError.message, statusCode),
      });
    }

    return finalizeObservedRequest(observed, {
      errorCode: "workflow_export_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to export workflow.",
        500,
      ),
    });
  }
}
