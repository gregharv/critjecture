import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getDemoDataset } from "@/lib/demo-datasets";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ datasetId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canViewKnowledgeLibrary) {
    return jsonError("This membership cannot view the knowledge library.", 403);
  }

  const { datasetId } = await params;
  const dataset = getDemoDataset(datasetId);

  if (!dataset) {
    return jsonError("Unknown demo dataset.", 404);
  }

  try {
    const upstream = await fetch(dataset.sourceUrl, {
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      return jsonError("Failed to download the demo dataset.", 502);
    }

    const contentType =
      upstream.headers.get("content-type") ??
      (dataset.downloadMode === "zip-bundle" ? "application/zip" : "text/csv; charset=utf-8");

    return new NextResponse(upstream.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${dataset.filename}"`,
        "Content-Type": contentType,
      },
      status: 200,
    });
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to download the demo dataset.",
      502,
    );
  }
}
