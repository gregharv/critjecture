import { NextResponse } from "next/server";

import { getHealthSummary } from "@/lib/operations";

export const runtime = "nodejs";

export async function GET() {
  const health = await getHealthSummary();

  return NextResponse.json(health, {
    status: health.status === "fail" ? 503 : 200,
  });
}
