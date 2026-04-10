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
  buildWorkflowDraftFromChatTurn,
  WorkflowBuilderError,
} from "@/lib/workflow-builder";

export const runtime = "nodejs";

type BuildWorkflowFromChatTurnRequestBody = {
  conversationId?: string;
  turnId?: string;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "workflow",
    routeKey: "workflow.from_chat_turn",
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
      response: buildObservedErrorResponse("Only admin and owner can save workflows from chat.", 403),
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

  let body: BuildWorkflowFromChatTurnRequestBody;

  try {
    body = (await request.json()) as BuildWorkflowFromChatTurnRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const normalizedConversationId =
    typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  const normalizedTurnId = typeof body.turnId === "string" ? body.turnId.trim() : "";

  if (!normalizedConversationId && !normalizedTurnId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("Provide conversationId or turnId.", 400),
    });
  }

  try {
    const response = await buildWorkflowDraftFromChatTurn({
      conversationId: normalizedConversationId || undefined,
      organizationId: user.organizationId,
      turnId: normalizedTurnId || undefined,
      userId: user.id,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        hasChartStep: response.draft.sourceSummary.chartToolCallCount > 0,
        hasDocumentStep: response.draft.sourceSummary.documentToolCallCount > 0,
        stepCount: response.draft.version.recipe.steps.length,
      },
      outcome: "ok",
      response: NextResponse.json(response),
      usageEvents: [
        {
          eventType: "workflow_draft_compiled_from_chat",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    if (caughtError instanceof WorkflowBuilderError) {
      const statusCode =
        caughtError.code === "turn_not_found"
          ? 404
          : caughtError.code === "turn_not_completed"
            ? 409
            : caughtError.code === "analysis_step_missing"
              ? 409
              : 400;

      return finalizeObservedRequest(observed, {
        errorCode: caughtError.code,
        outcome: "error",
        response: buildObservedErrorResponse(caughtError.message, statusCode),
      });
    }

    return finalizeObservedRequest(observed, {
      errorCode: "workflow_draft_compile_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to build workflow draft from chat turn.",
        500,
      ),
    });
  }
}
