import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { chatTurnBelongsToUser, createAssistantMessageLog } from "@/lib/audit-log";

export const runtime = "nodejs";

type CreateAssistantMessageBody = {
  messageText?: unknown;
  messageTitle?: unknown;
  turnId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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
  const messageTitle =
    typeof body.messageTitle === "string" ? body.messageTitle.trim() : "";
  const messageText =
    typeof body.messageText === "string" ? body.messageText.trim() : "";

  if (!turnId || !messageTitle || !messageText) {
    return jsonError(
      "turnId, messageTitle, and messageText must all be non-empty strings.",
      400,
    );
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
      messageText,
      messageTitle,
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
