import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  previewKnowledgeImportConflictsFromArchive,
  previewKnowledgeImportConflictsFromFiles,
} from "@/lib/knowledge-imports";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getStringFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canWriteKnowledge) {
    return jsonError("This membership cannot upload or import knowledge files.", 403);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError("Request body must be multipart form data.", 400);
  }

  const scope = getStringFormValue(formData, "scope") || "public";
  const mode = getStringFormValue(formData, "mode") || "directory";
  const archive = formData.get("archive");

  try {
    if (archive instanceof File) {
      const conflicts = await previewKnowledgeImportConflictsFromArchive({
        archive,
        requestedScope: scope,
        user,
      });

      return NextResponse.json({ conflicts });
    }

    const directFile = formData.get("file");
    const fileEntries =
      directFile instanceof File && formData.getAll("files").length === 0
        ? [directFile]
        : formData.getAll("files");
    const pathEntries = formData.getAll("paths");
    const files = fileEntries
      .map((entry, index) => {
        if (!(entry instanceof File)) {
          return null;
        }

        const relativePath =
          typeof pathEntries[index] === "string" && String(pathEntries[index]).trim()
            ? String(pathEntries[index]).trim()
            : entry.name;

        return {
          file: entry,
          relativePath,
        };
      })
      .filter((entry): entry is { file: File; relativePath: string } => entry !== null);

    const conflicts = await previewKnowledgeImportConflictsFromFiles({
      files,
      requestedScope: scope,
      sourceKind: mode === "single_file" ? "single_file" : "directory",
      user,
    });

    return NextResponse.json({ conflicts });
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to preview knowledge import conflicts.",
      400,
    );
  }
}
