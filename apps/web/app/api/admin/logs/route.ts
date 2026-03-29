import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { listRecentChatTurnLogs } from "@/lib/audit-log";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (user.role !== "owner") {
    return jsonError("Only Owner can view audit logs.", 403);
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");

  const limit = limitParam ? Number(limitParam) : 50;

  try {
    const turns = await listRecentChatTurnLogs(user.organizationId, limit);

    return NextResponse.json({ turns });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load audit logs.";

    return jsonError(message, 500);
  }
}
