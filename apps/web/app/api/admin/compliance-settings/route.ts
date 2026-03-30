import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  getOrganizationComplianceSettings,
  saveOrganizationComplianceSettings,
} from "@/lib/governance";
import { getOrganizationById } from "@/lib/organizations";

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
    return jsonError("This membership cannot view compliance settings.", 403);
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
    settings: await getOrganizationComplianceSettings(user.organizationId),
  });
}

export async function PUT(request: Request) {
  const { error, user } = await requireOwnerUser();

  if (error || !user) {
    return error;
  }

  if (!user.access.canManageOrganizationSettings) {
    return jsonError("Only Owner can change compliance settings.", 403);
  }

  let body: Record<string, number | null | undefined>;

  try {
    body = (await request.json()) as Record<string, number | null | undefined>;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const organization = await getOrganizationById(user.organizationId);

  if (!organization) {
    return jsonError("Organization not found.", 404);
  }

  const settings = await saveOrganizationComplianceSettings({
    organizationId: user.organizationId,
    settings: {
      alertRetentionDays: typeof body.alertRetentionDays === "number" ? body.alertRetentionDays : null,
      chatHistoryRetentionDays:
        typeof body.chatHistoryRetentionDays === "number" ? body.chatHistoryRetentionDays : null,
      exportArtifactRetentionDays:
        typeof body.exportArtifactRetentionDays === "number"
          ? body.exportArtifactRetentionDays
          : undefined,
      knowledgeImportRetentionDays:
        typeof body.knowledgeImportRetentionDays === "number"
          ? body.knowledgeImportRetentionDays
          : null,
      requestLogRetentionDays:
        typeof body.requestLogRetentionDays === "number" ? body.requestLogRetentionDays : null,
      usageRetentionDays:
        typeof body.usageRetentionDays === "number" ? body.usageRetentionDays : null,
    },
    updatedByUserId: user.id,
  });

  return NextResponse.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    settings,
  });
}
