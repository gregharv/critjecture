import { NextResponse } from "next/server";

import type { SessionData } from "@mariozechner/pi-web-ui";

import { getSessionUser } from "@/lib/auth-state";
import { getUserConversation, upsertConversation } from "@/lib/conversations";

export const runtime = "nodejs";

type ConversationRouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type UpsertConversationBody = {
  sessionData?: SessionData;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: ConversationRouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { conversationId } = await context.params;

  if (!conversationId.trim()) {
    return jsonError("conversationId must be a non-empty string.", 400);
  }

  try {
    const conversation = await getUserConversation({
      conversationId: conversationId.trim(),
      organizationId: user.organizationId,
      userId: user.id,
      userRole: user.role,
    });

    if (!conversation) {
      return jsonError("Conversation not found.", 404);
    }

    return NextResponse.json({ conversation });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to load conversation.";

    return jsonError(message, 500);
  }
}

export async function PUT(request: Request, context: ConversationRouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return jsonError("conversationId must be a non-empty string.", 400);
  }

  let body: UpsertConversationBody;

  try {
    body = (await request.json()) as UpsertConversationBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (!body.sessionData || typeof body.sessionData !== "object") {
    return jsonError("sessionData is required.", 400);
  }

  if (
    typeof body.sessionData.id !== "string" ||
    body.sessionData.id.trim() !== normalizedConversationId
  ) {
    return jsonError("sessionData.id must match the route conversationId.", 400);
  }

  try {
    const result = await upsertConversation({
      conversationId: normalizedConversationId,
      organizationId: user.organizationId,
      sessionData: body.sessionData,
      userId: user.id,
      userRole: user.role,
    });

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to save conversation.";

    return jsonError(message, 500);
  }
}
