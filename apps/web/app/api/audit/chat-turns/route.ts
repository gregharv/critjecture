import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { createChatTurnLog } from "@/lib/audit-log";

export const runtime = "nodejs";

type CreateChatTurnBody = {
  chatSessionId?: unknown;
  userPromptText?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: CreateChatTurnBody;

  try {
    body = (await request.json()) as CreateChatTurnBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const userPromptText =
    typeof body.userPromptText === "string" ? body.userPromptText.trim() : "";
  const chatSessionId =
    typeof body.chatSessionId === "string" ? body.chatSessionId.trim() : "";

  if (!userPromptText) {
    return jsonError("userPromptText must be a non-empty string.", 400);
  }

  if (!chatSessionId) {
    return jsonError("chatSessionId must be a non-empty string.", 400);
  }

  try {
    const result = await createChatTurnLog({
      chatSessionId,
      organizationId: user.organizationId,
      userPromptText,
      userRole: user.role,
      userId: user.id,
    });

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to create chat turn log.";

    return jsonError(message, 500);
  }
}
