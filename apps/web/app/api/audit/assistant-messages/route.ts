import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { chatTurnBelongsToUser, createAssistantMessageLog } from "@/lib/audit-log";
import {
  ASSISTANT_MESSAGE_TYPES,
  type AssistantMessageType,
} from "@/lib/audit-types";

export const runtime = "nodejs";

type CreateAssistantMessageBody = {
  messageIndex?: unknown;
  messageText?: unknown;
  messageType?: unknown;
  modelName?: unknown;
  turnId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isAssistantMessageType(value: unknown): value is AssistantMessageType {
  return (
    typeof value === "string" &&
    ASSISTANT_MESSAGE_TYPES.includes(value as AssistantMessageType)
  );
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: CreateAssistantMessageBody;

  try {
    body = (await request.json()) as CreateAssistantMessageBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
  const messageText =
    typeof body.messageText === "string" ? body.messageText.trim() : "";
  const modelName = typeof body.modelName === "string" ? body.modelName.trim() : "";
  const messageIndex =
    typeof body.messageIndex === "number" && Number.isInteger(body.messageIndex)
      ? body.messageIndex
      : Number.NaN;

  if (!turnId || !messageText || !modelName || !Number.isInteger(messageIndex) || messageIndex < 0) {
    return jsonError(
      "turnId, messageText, modelName, and a non-negative integer messageIndex are required.",
      400,
    );
  }

  if (!isAssistantMessageType(body.messageType)) {
    return jsonError('messageType must be "final-response" or "planner-selection".', 400);
  }

  try {
    const turnBelongsToUser = await chatTurnBelongsToUser(
      turnId,
      user.id,
      user.organizationId,
    );

    if (!turnBelongsToUser) {
      return jsonError("Chat turn not found.", 404);
    }

    await createAssistantMessageLog({
      messageIndex,
      messageText,
      messageType: body.messageType,
      modelName,
      turnId,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to create assistant message log.";

    return jsonError(message, 500);
  }
}
