import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getSessionUser } from "@/lib/auth-state";
import { getAnalysisArtifactDetail } from "@/lib/analysis-runs";
import { resolvePersistedGeneratedAssetPath } from "@/lib/python-sandbox";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string; runId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { artifactId, runId } = await context.params;

  try {
    const artifact = await getAnalysisArtifactDetail({
      artifactId,
      organizationId: user.organizationId,
      runId,
    });

    const organizationRoot = await resolveOrganizationStorageRoot(user.organizationSlug);
    const absolutePath = await resolvePersistedGeneratedAssetPath(organizationRoot, artifact.storagePath);
    const content = await readFile(absolutePath);

    return new NextResponse(content, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Content-Type": artifact.mimeType,
      },
      status: 200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download analysis artifact.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
