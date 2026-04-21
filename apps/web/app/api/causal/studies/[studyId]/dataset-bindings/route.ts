import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { upsertStudyDatasetBinding } from "@/lib/study-dataset-bindings";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseRequestBody(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const body = input as Record<string, unknown>;
  const datasetId = typeof body.datasetId === "string" ? body.datasetId.trim() : "";
  const bindingRole = typeof body.bindingRole === "string" ? body.bindingRole.trim() : "primary";
  const datasetVersionId =
    typeof body.datasetVersionId === "string" && body.datasetVersionId.trim()
      ? body.datasetVersionId.trim()
      : null;
  const bindingNote =
    typeof body.bindingNote === "string" && body.bindingNote.trim()
      ? body.bindingNote.trim()
      : null;
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;

  if (!datasetId) {
    return null;
  }

  if (
    bindingRole !== "primary" &&
    bindingRole !== "auxiliary" &&
    bindingRole !== "candidate" &&
    bindingRole !== "external_requirement"
  ) {
    return null;
  }

  return {
    bindingNote,
    bindingRole: bindingRole as "primary" | "auxiliary" | "candidate" | "external_requirement",
    datasetId,
    datasetVersionId,
    isActive,
  };
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

  const parsed = parseRequestBody(body);

  if (!parsed) {
    return jsonError("datasetId and a valid bindingRole are required.", 400);
  }

  try {
    const detail = await upsertStudyDatasetBinding({
      bindingNote: parsed.bindingNote,
      bindingRole: parsed.bindingRole,
      createdByUserId: user.id,
      datasetId: parsed.datasetId,
      datasetVersionId: parsed.datasetVersionId,
      isActive: parsed.isActive,
      organizationId: user.organizationId,
      studyId,
    });

    return NextResponse.json({ datasetBinding: detail }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update dataset binding.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
