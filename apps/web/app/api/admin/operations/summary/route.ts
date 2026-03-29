import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getOperationsSummary } from "@/lib/operations";

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
    return jsonError("Only Owner can view operations.", 403);
  }

  try {
    const { searchParams } = new URL(request.url);
    const summary = await getOperationsSummary({
      organizationId: user.organizationId,
      windowParam: searchParams.get("window"),
    });

    return NextResponse.json(summary);
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load operations summary.";

    return jsonError(message, 500);
  }
}
