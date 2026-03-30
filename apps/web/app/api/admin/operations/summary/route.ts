import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
  getOperationsSummary,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "admin",
    routeKey: "admin.operations.summary",
    user,
  });

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  if (!user.access.canViewOperations) {
    return finalizeObservedRequest(observed, {
      errorCode: "admin_forbidden",
      outcome: "error",
      response: buildObservedErrorResponse("This membership cannot view operations.", 403),
    });
  }

  try {
    const { searchParams } = new URL(request.url);
    const summary = await getOperationsSummary({
      organizationId: user.organizationId,
      windowParam: searchParams.get("window"),
    });

    return finalizeObservedRequest(observed, {
      outcome: "ok",
      response: NextResponse.json(summary),
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load operations summary.";

    return finalizeObservedRequest(observed, {
      errorCode: "operations_summary_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
