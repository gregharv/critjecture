import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { createAuditPromptLog } from "@/lib/audit-log";

export const runtime = "nodejs";

type CreateAuditPromptBody = {
  chatSessionId?: unknown;
  promptText?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: CreateAuditPromptBody;

  try {
    body = (await request.json()) as CreateAuditPromptBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
  const chatSessionId =
    typeof body.chatSessionId === "string" ? body.chatSessionId.trim() : "";

  if (!promptText) {
    return jsonError("promptText must be a non-empty string.", 400);
  }

  if (!chatSessionId) {
    return jsonError("chatSessionId must be a non-empty string.", 400);
  }

  try {
    const result = await createAuditPromptLog({
      chatSessionId,
      promptText,
      role: user.role,
      userId: user.id,
    });

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to create audit prompt log.";

    return jsonError(message, 500);
  }
}
