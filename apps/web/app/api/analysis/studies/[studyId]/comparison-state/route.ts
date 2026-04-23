import { NextResponse } from "next/server";

import {
  clearRecentComparisons,
  deleteComparisonSnapshot,
  deleteRecentComparison,
  recordRecentComparison,
  renameComparisonSnapshot,
  saveComparisonSnapshot,
  togglePinComparisonSnapshot,
} from "@/lib/analysis-comparisons";
import { getSessionUser } from "@/lib/auth-state";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getStringField(body: unknown, key: string) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>)[key] === "string"
  ) {
    return String((body as Record<string, unknown>)[key]).trim();
  }

  return "";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { studyId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const action = getStringField(body, "action");

  try {
    let comparisonState:
      | Awaited<ReturnType<typeof saveComparisonSnapshot>>
      | Awaited<ReturnType<typeof renameComparisonSnapshot>>
      | Awaited<ReturnType<typeof togglePinComparisonSnapshot>>
      | Awaited<ReturnType<typeof deleteComparisonSnapshot>>
      | Awaited<ReturnType<typeof recordRecentComparison>>
      | Awaited<ReturnType<typeof deleteRecentComparison>>
      | Awaited<ReturnType<typeof clearRecentComparisons>>;

    if (action === "save_snapshot") {
      comparisonState = await saveComparisonSnapshot({
        baseRunId: getStringField(body, "baseRunId"),
        name: getStringField(body, "name"),
        organizationId: user.organizationId,
        studyId,
        targetRunId: getStringField(body, "targetRunId"),
        userId: user.id,
      });
    } else if (action === "rename_snapshot") {
      comparisonState = await renameComparisonSnapshot({
        name: getStringField(body, "name"),
        organizationId: user.organizationId,
        snapshotId: getStringField(body, "snapshotId"),
        studyId,
        userId: user.id,
      });
    } else if (action === "toggle_pin_snapshot") {
      comparisonState = await togglePinComparisonSnapshot({
        organizationId: user.organizationId,
        snapshotId: getStringField(body, "snapshotId"),
        studyId,
        userId: user.id,
      });
    } else if (action === "delete_snapshot") {
      comparisonState = await deleteComparisonSnapshot({
        organizationId: user.organizationId,
        snapshotId: getStringField(body, "snapshotId"),
        studyId,
        userId: user.id,
      });
    } else if (action === "track_recent") {
      comparisonState = await recordRecentComparison({
        baseRunId: getStringField(body, "baseRunId"),
        organizationId: user.organizationId,
        studyId,
        targetRunId: getStringField(body, "targetRunId"),
        userId: user.id,
      });
    } else if (action === "delete_recent") {
      comparisonState = await deleteRecentComparison({
        organizationId: user.organizationId,
        recentComparisonId: getStringField(body, "recentComparisonId"),
        studyId,
        userId: user.id,
      });
    } else if (action === "clear_recent") {
      comparisonState = await clearRecentComparisons({
        organizationId: user.organizationId,
        studyId,
        userId: user.id,
      });
    } else {
      return jsonError("Unsupported comparison-state action.", 400);
    }

    return NextResponse.json({ comparisonState });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update comparison state.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
