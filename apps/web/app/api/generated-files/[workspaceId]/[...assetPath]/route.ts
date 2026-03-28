import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { resolveGeneratedSandboxAsset } from "@/lib/python-sandbox";
import { getSandboxRunByWorkspaceId } from "@/lib/sandbox-runs";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetPath?: string[];
    workspaceId?: string;
  }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { assetPath = [], workspaceId = "" } = await context.params;
  const relativePath = assetPath.join("/");

  if (!workspaceId || !relativePath) {
    return jsonError("Generated file path is incomplete.", 400);
  }

  try {
    const sandboxRun = await getSandboxRunByWorkspaceId(workspaceId);

    if (!sandboxRun || sandboxRun.userId !== user.id) {
      return jsonError("Generated asset not found.", 404);
    }

    const assetIsOwned = sandboxRun.generatedAssets.some(
      (generatedAsset) =>
        typeof generatedAsset === "object" &&
        generatedAsset !== null &&
        "relativePath" in generatedAsset &&
        generatedAsset.relativePath === relativePath,
    );

    if (!assetIsOwned) {
      return jsonError("Generated asset not found.", 404);
    }

    const asset = await resolveGeneratedSandboxAsset(workspaceId, relativePath);
    const content = await readFile(asset.absolutePath);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": asset.metadata.mimeType,
    });

    if (asset.metadata.mimeType === "application/pdf") {
      headers.set(
        "Content-Disposition",
        `attachment; filename="${asset.metadata.fileName}"`,
      );
    } else {
      headers.set("Content-Disposition", "inline");
    }

    return new NextResponse(content, {
      headers,
      status: 200,
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Unable to load generated file.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
