import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { auditPromptBelongsToUser, createAuditTraceEventLog } from "@/lib/audit-log";
import {
  AUDIT_TRACE_EVENT_KINDS,
  type AuditTraceEventKind,
} from "@/lib/audit-types";

export const runtime = "nodejs";

type CreateAuditTraceEventBody = {
  content?: unknown;
  kind?: unknown;
  promptId?: unknown;
  title?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isAuditTraceEventKind(value: unknown): value is AuditTraceEventKind {
  return (
    typeof value === "string" &&
    AUDIT_TRACE_EVENT_KINDS.includes(value as AuditTraceEventKind)
  );
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: CreateAuditTraceEventBody;

  try {
    body = (await request.json()) as CreateAuditTraceEventBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const promptId = typeof body.promptId === "string" ? body.promptId.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!promptId || !title || !content) {
    return jsonError("promptId, title, and content must all be non-empty strings.", 400);
  }

  if (!isAuditTraceEventKind(body.kind)) {
    return jsonError("kind must be a supported audit trace event kind.", 400);
  }

  try {
    const promptBelongsToUser = await auditPromptBelongsToUser(promptId, user.id);

    if (!promptBelongsToUser) {
      return jsonError("Audit prompt not found.", 404);
    }

    await createAuditTraceEventLog({
      content,
      kind: body.kind,
      promptId,
      title,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to create audit trace event.";

    return jsonError(message, 500);
  }
}
