import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getKnowledgeFilePreview } from "@/lib/knowledge-files";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    fileId: string;
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

  if (!user.access.canViewKnowledgeLibrary) {
    return jsonError("This membership cannot view the knowledge library.", 403);
  }

  const { fileId } = await context.params;
  const normalizedFileId = fileId.trim();

  if (!normalizedFileId) {
    return jsonError("fileId must be a non-empty string.", 400);
  }

  try {
    const preview = await getKnowledgeFilePreview({
      fileId: normalizedFileId,
      user,
    });

    return NextResponse.json({ preview });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load file preview.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
