import { NextResponse } from "next/server";

import type { SessionData } from "@mariozechner/pi-web-ui";

import { getSessionUser } from "@/lib/auth-state";
import type { ConversationVisibility } from "@/lib/conversation-types";
import {
  ConversationError,
  deleteConversation,
  getUserConversation,
  updateConversation,
  upsertConversation,
} from "@/lib/conversations";

export const runtime = "nodejs";

type ConversationRouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type UpsertConversationBody = {
  sessionData?: SessionData;
};

type UpdateConversationBody = {
  pinned?: boolean;
  title?: string;
  visibility?: ConversationVisibility;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getConversationErrorStatus(error: unknown, fallbackStatus = 500) {
  return error instanceof ConversationError ? error.status : fallbackStatus;
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
    const result = await getUserConversation({
      conversationId: conversationId.trim(),
      organizationId: user.organizationId,
      userId: user.id,
      userRole: user.role,
    });

    if (!result) {
      return jsonError("Conversation not found.", 404);
    }

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to load conversation.";

    return jsonError(message, getConversationErrorStatus(caughtError));
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

    return jsonError(message, getConversationErrorStatus(caughtError));
  }
}

export async function PATCH(request: Request, context: ConversationRouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return jsonError("conversationId must be a non-empty string.", 400);
  }

  let body: UpdateConversationBody;

  try {
    body = (await request.json()) as UpdateConversationBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const patch: UpdateConversationBody = {};

  if (typeof body.pinned !== "undefined") {
    if (typeof body.pinned !== "boolean") {
      return jsonError("pinned must be a boolean.", 400);
    }

    patch.pinned = body.pinned;
  }

  if (typeof body.title !== "undefined") {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return jsonError("title must be a non-empty string.", 400);
    }

    patch.title = body.title.trim();
  }

  if (typeof body.visibility !== "undefined") {
    if (body.visibility !== "private" && body.visibility !== "organization") {
      return jsonError("visibility must be either 'private' or 'organization'.", 400);
    }

    patch.visibility = body.visibility;
  }

  if (Object.keys(patch).length === 0) {
    return jsonError("At least one supported field must be provided.", 400);
  }

  try {
    const result = await updateConversation({
      conversationId: normalizedConversationId,
      organizationId: user.organizationId,
      patch,
      userId: user.id,
      userRole: user.role,
    });

    if (!result) {
      return jsonError("Conversation not found.", 404);
    }

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to update conversation.";

    return jsonError(message, getConversationErrorStatus(caughtError));
  }
}

export async function DELETE(_request: Request, context: ConversationRouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return jsonError("conversationId must be a non-empty string.", 400);
  }

  try {
    const result = await deleteConversation({
      conversationId: normalizedConversationId,
      organizationId: user.organizationId,
      userId: user.id,
      userRole: user.role,
    });

    if (!result) {
      return jsonError("Conversation not found.", 404);
    }

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to delete conversation.";

    return jsonError(message, getConversationErrorStatus(caughtError));
  }
}
