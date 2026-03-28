import { NextResponse } from "next/server";

import { listRecentAuditPromptLogs } from "@/lib/audit-log";
import { isUserRole } from "@/lib/roles";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const limitParam = searchParams.get("limit");

  if (!isUserRole(role)) {
    return jsonError('role must be either "intern" or "owner".', 400);
  }

  if (role !== "owner") {
    return jsonError("Only Owner can view audit logs.", 403);
  }

  const limit = limitParam ? Number(limitParam) : 50;

  try {
    const prompts = await listRecentAuditPromptLogs(limit);

    return NextResponse.json({ prompts });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load audit logs.";

    return jsonError(message, 500);
  }
}
