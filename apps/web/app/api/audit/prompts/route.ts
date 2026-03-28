import { NextResponse } from "next/server";

import { createAuditPromptLog } from "@/lib/audit-log";
import { isUserRole } from "@/lib/roles";

export const runtime = "nodejs";

type CreateAuditPromptBody = {
  promptText?: unknown;
  role?: unknown;
  sessionId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: CreateAuditPromptBody;

  try {
    body = (await request.json()) as CreateAuditPromptBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!promptText) {
    return jsonError("promptText must be a non-empty string.", 400);
  }

  if (!sessionId) {
    return jsonError("sessionId must be a non-empty string.", 400);
  }

  if (!isUserRole(body.role)) {
    return jsonError('Role must be either "intern" or "owner".', 400);
  }

  try {
    const result = await createAuditPromptLog({
      promptText,
      role: body.role,
      sessionId,
    });

    return NextResponse.json(result);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to create audit prompt log.";

    return jsonError(message, 500);
  }
}
