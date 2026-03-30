import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import { getSessionUser } from "@/lib/auth-state";
import {
  assertValidSandboxRunId,
  normalizeGeneratedAssetRelativePath,
  resolvePersistedGeneratedAssetPath,
} from "@/lib/python-sandbox";
import {
  cleanupExpiredSandboxArtifacts,
  getSandboxGeneratedAsset,
  getSandboxRunByRunId,
} from "@/lib/sandbox-runs";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    assetPath?: string[];
    runId?: string;
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

  const { assetPath = [], runId = "" } = await context.params;
  const relativePath = assetPath.join("/");

  if (!runId || !relativePath) {
    return jsonError("Generated file path is incomplete.", 400);
  }

  try {
    assertValidSandboxRunId(runId);
    const normalizedRelativePath = normalizeGeneratedAssetRelativePath(relativePath);
    await cleanupExpiredSandboxArtifacts({
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
    });
    const sandboxRun = await getSandboxRunByRunId(runId);

    if (
      !sandboxRun ||
      sandboxRun.organizationId !== user.organizationId
    ) {
      return jsonError("Generated asset not found.", 404);
    }

    if (
      sandboxRun.userId !== user.id &&
      !user.access.canDownloadGeneratedAssetsCreatedByOthers
    ) {
      return jsonError("Generated asset not found.", 404);
    }

    const assetIsOwned = sandboxRun.generatedAssets.some(
      (generatedAsset) =>
        typeof generatedAsset === "object" &&
        generatedAsset !== null &&
        "relativePath" in generatedAsset &&
        generatedAsset.relativePath === normalizedRelativePath,
    );

    if (!assetIsOwned) {
      return jsonError("Generated asset not found.", 404);
    }

    const asset = await getSandboxGeneratedAsset(runId, normalizedRelativePath);

    if (!asset || asset.expiresAt < Date.now()) {
      return jsonError("Generated asset not found.", 404);
    }

    const organizationRoot = await resolveOrganizationStorageRoot(user.organizationSlug);
    const absolutePath = await resolvePersistedGeneratedAssetPath(
      organizationRoot,
      asset.storagePath,
    );
    const content = await readFile(absolutePath);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": asset.mimeType,
    });

    if (asset.mimeType === "application/pdf") {
      headers.set(
        "Content-Disposition",
        `attachment; filename="${asset.fileName}"`,
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
