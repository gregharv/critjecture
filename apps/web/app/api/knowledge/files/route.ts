import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  listKnowledgeFiles,
  parseKnowledgeScopeFilter,
  parseKnowledgeStatusFilter,
  uploadKnowledgeFile,
} from "@/lib/knowledge-files";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { searchParams } = new URL(request.url);
  const scope = parseKnowledgeScopeFilter(searchParams.get("scope"));
  const status = parseKnowledgeStatusFilter(searchParams.get("status"));

  if (scope === null) {
    return jsonError("scope must be public or admin.", 400);
  }

  if (status === null) {
    return jsonError("status must be pending, ready, or failed.", 400);
  }

  try {
    const files = await listKnowledgeFiles(user, {
      scope: scope ?? undefined,
      status: status ?? undefined,
    });

    return NextResponse.json({ files });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load knowledge files.";

    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("Request body must be multipart form data.", 400);
  }

  const file = formData.get("file");
  const scope = formData.get("scope");

  if (!(file instanceof File)) {
    return jsonError("file must be provided as a multipart upload.", 400);
  }

  if (typeof scope !== "string" && user.role === "owner") {
    return jsonError("scope must be provided for owner uploads.", 400);
  }

  try {
    const uploadedFile = await uploadKnowledgeFile({
      file,
      requestedScope: typeof scope === "string" ? scope : "public",
      user,
    });

    return NextResponse.json({ file: uploadedFile });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Knowledge upload failed.";

    return jsonError(message, 400);
  }
}
