import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { chatTurnBelongsToUser, finishToolCallLog } from "@/lib/audit-log";
import { TOOL_CALL_STATUSES, type ToolCallStatus } from "@/lib/audit-types";

export const runtime = "nodejs";

type FinishAuditToolCallBody = {
  accessedFiles?: unknown;
  errorMessage?: unknown;
  resultSummary?: unknown;
  sandboxRunId?: unknown;
  runtimeToolCallId?: unknown;
  status?: unknown;
  turnId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
  return (
    typeof value === "string" &&
    TOOL_CALL_STATUSES.includes(value as ToolCallStatus)
  );
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: FinishAuditToolCallBody;

  try {
    body = (await request.json()) as FinishAuditToolCallBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";
  const runtimeToolCallId =
    typeof body.runtimeToolCallId === "string" ? body.runtimeToolCallId.trim() : "";
  const resultSummary =
    typeof body.resultSummary === "string" ? body.resultSummary.trim() : null;
  const errorMessage =
    typeof body.errorMessage === "string" ? body.errorMessage.trim() : null;
  const sandboxRunId =
    typeof body.sandboxRunId === "string" && body.sandboxRunId.trim()
      ? body.sandboxRunId.trim()
      : null;
  const accessedFiles = Array.isArray(body.accessedFiles)
    ? body.accessedFiles
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

  if (!turnId || !runtimeToolCallId) {
    return jsonError("turnId and runtimeToolCallId must both be non-empty strings.", 400);
  }

  if (!isToolCallStatus(body.status) || body.status === "started") {
    return jsonError('status must be either "completed" or "error".', 400);
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

    await finishToolCallLog({
      accessedFiles,
      errorMessage,
      resultSummary,
      sandboxRunId,
      status: body.status,
      runtimeToolCallId,
      turnId,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to finish tool call log.";

    return jsonError(message, 500);
  }
}
