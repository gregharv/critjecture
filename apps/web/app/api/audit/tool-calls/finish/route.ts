import { NextResponse } from "next/server";

import { finishAuditToolCallLog } from "@/lib/audit-log";
import {
  AUDIT_TOOL_CALL_STATUSES,
  type AuditToolCallStatus,
} from "@/lib/audit-types";

export const runtime = "nodejs";

type FinishAuditToolCallBody = {
  errorMessage?: unknown;
  promptId?: unknown;
  resultSummary?: unknown;
  status?: unknown;
  toolCallId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isAuditToolCallStatus(value: unknown): value is AuditToolCallStatus {
  return (
    typeof value === "string" &&
    AUDIT_TOOL_CALL_STATUSES.includes(value as AuditToolCallStatus)
  );
}

export async function POST(request: Request) {
  let body: FinishAuditToolCallBody;

  try {
    body = (await request.json()) as FinishAuditToolCallBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const promptId = typeof body.promptId === "string" ? body.promptId.trim() : "";
  const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId.trim() : "";
  const resultSummary =
    typeof body.resultSummary === "string" ? body.resultSummary.trim() : null;
  const errorMessage =
    typeof body.errorMessage === "string" ? body.errorMessage.trim() : null;

  if (!promptId || !toolCallId) {
    return jsonError("promptId and toolCallId must both be non-empty strings.", 400);
  }

  if (!isAuditToolCallStatus(body.status) || body.status === "started") {
    return jsonError('status must be either "completed" or "error".', 400);
  }

  try {
    await finishAuditToolCallLog({
      errorMessage,
      promptId,
      resultSummary,
      status: body.status,
      toolCallId,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to finish audit tool call log.";

    return jsonError(message, 500);
  }
}
