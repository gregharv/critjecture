import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getUserConversation } from "@/lib/conversations";
import { ensureAnalysisPreviewSession } from "@/lib/marimo-preview";
import type { AnalysisPreviewBootstrapResponse } from "@/lib/marimo-types";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "sandbox",
    routeKey: "analysis.workspace.preview.restart",
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

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_conversation_id",
      outcome: "error",
      response: buildObservedErrorResponse("conversationId must be a non-empty string.", 400),
    });
  }

  const conversation = await getUserConversation({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    userId: user.id,
    userRole: user.role,
  });

  if (!conversation) {
    return finalizeObservedRequest(observed, {
      errorCode: "conversation_not_found",
      outcome: "error",
      response: buildObservedErrorResponse("Conversation not found.", 404),
    });
  }

  try {
    const preview = await ensureAnalysisPreviewSession({
      conversationId: normalizedConversationId,
      forceRestart: true,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      userId: user.id,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        previewSessionId: preview.sessionId,
        revisionId: preview.revisionId,
        workspaceId: preview.workspaceId,
      },
      outcome: "ok",
      response: NextResponse.json(preview satisfies AnalysisPreviewBootstrapResponse, {
        status: 200,
      }),
      usageEvents: [
        {
          eventType: "analysis_preview_restart",
          metadata: {
            previewSessionId: preview.sessionId,
            revisionId: preview.revisionId,
            workspaceId: preview.workspaceId,
          },
          quantity: 1,
          status: "ok",
          subjectName: "analysis_preview_session",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to restart analysis preview.";
    const status = /not found/i.test(message) ? 404 : 500;

    return finalizeObservedRequest(observed, {
      errorCode: "analysis_preview_restart_failed",
      metadata: {
        conversationId: normalizedConversationId,
      },
      outcome: "error",
      response: buildObservedErrorResponse(message, status),
    });
  }
}
