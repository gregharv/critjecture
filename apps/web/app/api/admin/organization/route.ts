import { NextResponse } from "next/server";

import type { GetOrganizationAdminResponse } from "@/lib/admin-types";
import { getSessionUser } from "@/lib/auth-state";
import { getOrganizationById, updateOrganizationDisplayName } from "@/lib/organizations";
import {
  getWorkspaceCommercialUsageSnapshot,
  getWorkspacePlanSummary,
} from "@/lib/workspace-plans";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireOwnerUser() {
  const user = await getSessionUser();

  if (!user) {
    return { error: jsonError("Authentication required.", 401), user: null };
  }

  return { error: null, user };
}

export async function GET() {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  if (!user.access.canAccessAdminSettings) {
    return jsonError("This membership cannot view organization settings.", 403);
  }

  const organization = await getOrganizationById(user.organizationId);

  if (!organization) {
    return jsonError("Organization not found.", 404);
  }

  const [workspacePlan, workspaceUsage] = await Promise.all([
    getWorkspacePlanSummary(user.organizationId),
    getWorkspaceCommercialUsageSnapshot({
      organizationId: user.organizationId,
    }),
  ]);

  const response: GetOrganizationAdminResponse = {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    workspacePlan: {
      ...workspacePlan,
      exhausted: workspaceUsage.exhausted,
      remainingCredits: workspaceUsage.remainingCredits,
      resetAt: workspaceUsage.resetAt,
      usedCredits: workspaceUsage.usedCredits,
    },
  };

  return NextResponse.json(response);
}

export async function PATCH(request: Request) {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  if (!user.access.canManageOrganizationSettings) {
    return jsonError("Only Owner can change organization settings.", 403);
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
