import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { approveCausalDagVersion } from "@/lib/causal-dags";

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
    return jsonError("dagVersionId is required.", 400);
  }

  const payload = body as {
    approvalKind?: "user_signoff" | "admin_signoff" | "compliance_signoff";
    approvalText?: string;
    dagVersionId?: string;
  };

  if (typeof payload.dagVersionId !== "string" || !payload.dagVersionId.trim()) {
    return jsonError("dagVersionId is required.", 400);
  }

  const { dagId } = await context.params;

  try {
    const result = await approveCausalDagVersion({
      approvalKind: payload.approvalKind,
      approvalText: payload.approvalText,
      approvedByUserId: user.id,
      dagId,
      dagVersionId: payload.dagVersionId.trim(),
      organizationId: user.organizationId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve DAG version.";
    const status = /not found/i.test(message) ? 404 : 400;

    return jsonError(message, status);
  }
}
