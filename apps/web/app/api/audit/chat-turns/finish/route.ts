import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { chatTurnBelongsToUser, finishChatTurnLog } from "@/lib/audit-log";
import { TURN_STATUSES, type TurnStatus } from "@/lib/audit-types";

export const runtime = "nodejs";

type FinishChatTurnBody = {
  status?: unknown;
  turnId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isTurnStatus(value: unknown): value is TurnStatus {
  return typeof value === "string" && TURN_STATUSES.includes(value as TurnStatus);
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: FinishChatTurnBody;

  try {
    body = (await request.json()) as FinishChatTurnBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const turnId = typeof body.turnId === "string" ? body.turnId.trim() : "";

  if (!turnId) {
    return jsonError("turnId must be a non-empty string.", 400);
  }

  if (!isTurnStatus(body.status) || body.status === "started") {
    return jsonError('status must be either "completed" or "failed".', 400);
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

    await finishChatTurnLog({
      status: body.status,
      turnId,
    });

    return NextResponse.json({ ok: true });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to finish chat turn log.";

    return jsonError(message, 500);
  }
}
