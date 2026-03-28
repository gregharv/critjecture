import { NextResponse } from "next/server";

import { startAuditToolCallLog } from "@/lib/audit-log";

export const runtime = "nodejs";

type StartAuditToolCallBody = {
  parametersJson?: unknown;
  promptId?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: StartAuditToolCallBody;

  try {
    body = (await request.json()) as StartAuditToolCallBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parametersJson =
    typeof body.parametersJson === "string" ? body.parametersJson.trim() : "";
  const promptId = typeof body.promptId === "string" ? body.promptId.trim() : "";
  const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId.trim() : "";
  const toolName = typeof body.toolName === "string" ? body.toolName.trim() : "";

  if (!promptId || !toolCallId || !toolName || !parametersJson) {
    return jsonError(
      "promptId, toolCallId, toolName, and parametersJson must all be non-empty strings.",
      400,
    );
  }

  try {
    await startAuditToolCallLog({
      parametersJson,
      promptId,
      toolCallId,
      toolName,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to create audit tool call log.";

    return jsonError(message, 500);
  }
}
