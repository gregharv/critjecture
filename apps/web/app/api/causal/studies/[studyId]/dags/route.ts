import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { ensureStudyDag } from "@/lib/causal-dags";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const payload = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { description?: string; title?: string })
    : {};

  const { studyId } = await context.params;

  try {
    const dag = await ensureStudyDag({
      createdByUserId: user.id,
      description: typeof payload.description === "string" ? payload.description : null,
      organizationId: user.organizationId,
      studyId,
      title: typeof payload.title === "string" ? payload.title : null,
    });

    return NextResponse.json({ dag }, { status: 201 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Failed to create DAG.", 400);
  }
}
