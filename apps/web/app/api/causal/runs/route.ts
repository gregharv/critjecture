import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { createAndExecuteCausalRun } from "@/lib/causal-runs";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const studyId =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { studyId?: unknown }).studyId === "string"
      ? (body as { studyId: string }).studyId.trim()
      : "";

  if (!studyId) {
    return jsonError("studyId is required.", 400);
  }

  try {
    const result = await createAndExecuteCausalRun({
      runUser: {
        id: user.id,
        organizationId: user.organizationId,
        organizationSlug: user.organizationSlug,
      },
      studyId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create causal run.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
