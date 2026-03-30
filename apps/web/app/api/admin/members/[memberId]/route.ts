import { NextResponse } from "next/server";

import { isMembershipStatus, MEMBERSHIP_STATUSES } from "@/lib/access-control";
import { updateOrganizationMember } from "@/lib/admin-users";
import { getSessionUser } from "@/lib/auth-state";
import { isUserRole } from "@/lib/roles";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canManageMembers) {
    return jsonError("This membership cannot manage members.", 403);
  }

  const { memberId } = await context.params;
  let body: {
    monthlyCreditCap?: number | null;
    name?: string | null;
    role?: string;
    status?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (body.role !== undefined && !isUserRole(body.role)) {
    return jsonError("Role must be member, admin, or owner.", 400);
  }

  if (body.status !== undefined && !isMembershipStatus(body.status)) {
    return jsonError(
      `Status must be ${MEMBERSHIP_STATUSES.join(", ")}.`,
      400,
    );
  }

  if (
    body.monthlyCreditCap !== undefined &&
    body.monthlyCreditCap !== null &&
    (typeof body.monthlyCreditCap !== "number" || !Number.isFinite(body.monthlyCreditCap) || body.monthlyCreditCap < 0)
  ) {
    return jsonError("monthlyCreditCap must be a non-negative number or null.", 400);
  }

  try {
    const member = await updateOrganizationMember({
      monthlyCreditCap:
        typeof body.monthlyCreditCap === "number" || body.monthlyCreditCap === null
          ? body.monthlyCreditCap
          : undefined,
      name:
        typeof body.name === "string" || body.name === null ? body.name : undefined,
      organizationId: user.organizationId,
      role: body.role,
      status: body.status,
      userId: memberId,
    });

    return NextResponse.json({ member });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to update member.";

    return jsonError(message, message.includes("not found") ? 404 : 400);
  }
}
