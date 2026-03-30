import { NextResponse } from "next/server";

import {
  beginObservedRequest,
  finalizeObservedRequest,
  getHealthSummary,
} from "@/lib/operations";

export const runtime = "nodejs";

export async function GET() {
  const health = await getHealthSummary();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "health",
    routeKey: "health.summary",
    user: null,
  });
  return finalizeObservedRequest(observed, {
    outcome: health.status === "fail" ? "error" : "ok",
    response: NextResponse.json(health, {
      status: health.status === "fail" ? 503 : 200,
    }),
  });
}
