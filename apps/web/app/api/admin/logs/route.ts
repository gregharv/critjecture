import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { listRecentChatTurnLogs } from "@/lib/audit-log";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "admin",
    routeKey: "admin.logs.list",
    user,
  });

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  if (!user.access.canViewAuditLogs) {
    return finalizeObservedRequest(observed, {
      errorCode: "admin_forbidden",
      outcome: "error",
      response: buildObservedErrorResponse("This membership cannot view audit logs.", 403),
    });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");

  const limit = limitParam ? Number(limitParam) : 50;

  try {
    const turns = await listRecentChatTurnLogs(user.organizationId, limit);

    return finalizeObservedRequest(observed, {
      outcome: "ok",
      response: NextResponse.json({ turns }),
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load audit logs.";

    return finalizeObservedRequest(observed, {
      errorCode: "admin_logs_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
