import { NextResponse } from "next/server";

import { resetOrganizationMemberPassword } from "@/lib/admin-users";
import { getSessionUser } from "@/lib/auth-state";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (user.role !== "owner") {
    return jsonError("Only Owner can reset passwords.", 403);
  }

  const { memberId } = await context.params;
  let body: { password?: string };

  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  try {
    const member = await resetOrganizationMemberPassword({
      organizationId: user.organizationId,
      password: typeof body.password === "string" ? body.password : "",
      userId: memberId,
    });

    return NextResponse.json({ member });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to reset password.";

    return jsonError(message, message.includes("not found") ? 404 : 400);
  }
}
