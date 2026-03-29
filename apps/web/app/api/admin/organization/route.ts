import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getOrganizationById, updateOrganizationDisplayName } from "@/lib/organizations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireOwnerUser() {
  const user = await getSessionUser();

  if (!user) {
    return { error: jsonError("Authentication required.", 401), user: null };
  }

  if (user.role !== "owner") {
    return { error: jsonError("Only Owner can manage organization settings.", 403), user: null };
  }

  return { error: null, user };
}

export async function GET() {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  const organization = await getOrganizationById(user.organizationId);

  if (!organization) {
    return jsonError("Organization not found.", 404);
  }

  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
  });
}

export async function PATCH(request: Request) {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  let body: { name?: string };

  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return jsonError("Organization name is required.", 400);
  }

  const organization = await updateOrganizationDisplayName({
    name: body.name,
    organizationId: user.organizationId,
  });

  if (!organization) {
    return jsonError("Organization not found.", 404);
  }

  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
  });
}
