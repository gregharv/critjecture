import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { resolveGeneratedSandboxAsset } from "@/lib/python-sandbox";

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
  const { assetPath = [], workspaceId = "" } = await context.params;
  const relativePath = assetPath.join("/");

  if (!workspaceId || !relativePath) {
    return jsonError("Generated file path is incomplete.", 400);
  }

  try {
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
