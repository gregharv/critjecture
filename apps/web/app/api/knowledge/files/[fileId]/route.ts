import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { deleteKnowledgeFile } from "@/lib/knowledge-files";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canWriteKnowledge) {
    return jsonError("This membership cannot delete knowledge files.", 403);
  }

  const { fileId } = await context.params;
  const normalizedFileId = fileId.trim();

  if (!normalizedFileId) {
    return jsonError("fileId must be a non-empty string.", 400);
  }

  try {
    const result = await deleteKnowledgeFile({
      fileId: normalizedFileId,
      user,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to delete knowledge file.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
