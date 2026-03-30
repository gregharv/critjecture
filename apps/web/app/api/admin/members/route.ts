import { NextResponse } from "next/server";

import { createOrganizationMember, listOrganizationMembers } from "@/lib/admin-users";
import { getSessionUser } from "@/lib/auth-state";
import { isUserRole } from "@/lib/roles";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireOwnerUser() {
  const user = await getSessionUser();

  if (!user) {
    return { error: jsonError("Authentication required.", 401), user: null };
  }

  if (!user.access.canManageMembers) {
    return { error: jsonError("This membership cannot manage members.", 403), user: null };
  }

  return { error: null, user };
}

export async function GET() {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  return NextResponse.json(await listOrganizationMembers(user.organizationId));
}

export async function POST(request: Request) {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  let body: {
    email?: string;
    name?: string | null;
    password?: string;
    role?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (!isUserRole(body.role)) {
    return jsonError("Role must be member, admin, or owner.", 400);
  }

  try {
    const member = await createOrganizationMember({
      email: typeof body.email === "string" ? body.email : "",
      name: typeof body.name === "string" ? body.name : null,
      organizationId: user.organizationId,
      password: typeof body.password === "string" ? body.password : "",
      role: body.role,
    });

    return NextResponse.json({ member }, { status: 201 });
  } catch (caughtError) {
    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to create member.",
      400,
    );
  }
}
