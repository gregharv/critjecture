import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { createCausalDagVersion } from "@/lib/causal-dags";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ dagId: string }> },
) {
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("A DAG draft payload is required.", 400);
  }

  const { dagId } = await context.params;

  try {
    const result = await createCausalDagVersion({
      createdByUserId: user.id,
      dagId,
      draft: body as Parameters<typeof createCausalDagVersion>[0]["draft"],
      organizationId: user.organizationId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create DAG version.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
