import "server-only";

import { asc } from "drizzle-orm";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { isHostedDeployment } from "@/lib/deployment-mode";
import { organizations } from "@/lib/legacy-app-schema";

export type HostedDeploymentValidation = {
  boundOrganizationId: string | null;
  boundOrganizationSlug: string | null;
  code:
    | "disabled"
    | "missing_binding"
    | "organization_missing"
    | "organization_mismatch"
    | "multiple_organizations"
    | "valid";
  detail: string;
  organizationCount: number;
  valid: boolean;
};

export function getHostedOrganizationSlug() {
  return (process.env.CRITJECTURE_HOSTED_ORGANIZATION_SLUG ?? "").trim().toLowerCase();
}

export async function getHostedDeploymentValidation(): Promise<HostedDeploymentValidation> {
  if (!isHostedDeployment()) {
    return {
      boundOrganizationId: null,
      boundOrganizationSlug: null,
      code: "disabled",
      detail: "Hosted deployment validation is disabled outside hosted mode.",
      organizationCount: 0,
      valid: true,
    };
  }

  const boundOrganizationSlug = getHostedOrganizationSlug();

  if (!boundOrganizationSlug) {
    return {
      boundOrganizationId: null,
      boundOrganizationSlug: null,
      code: "missing_binding",
      detail:
        "Hosted deployment is missing CRITJECTURE_HOSTED_ORGANIZATION_SLUG. Hosted mode requires one bound organization per deployment cell.",
      organizationCount: 0,
      valid: false,
    };
  }

  const db = await getAppDatabase();
  const existingOrganizations = await db
    .select({
      id: organizations.id,
      slug: organizations.slug,
    })
    .from(organizations)
    .orderBy(asc(organizations.createdAt));

  if (existingOrganizations.length === 0) {
    return {
      boundOrganizationId: null,
      boundOrganizationSlug,
      code: "organization_missing",
      detail: `Hosted deployment is bound to organization "${boundOrganizationSlug}", but that organization does not exist yet.`,
      organizationCount: 0,
      valid: false,
    };
  }

  if (existingOrganizations.length > 1) {
    return {
      boundOrganizationId: null,
      boundOrganizationSlug,
      code: "multiple_organizations",
      detail: `Hosted deployment is bound to organization "${boundOrganizationSlug}", but ${existingOrganizations.length} organizations exist in this deployment. Hosted mode permits exactly one organization per deployment cell.`,
      organizationCount: existingOrganizations.length,
      valid: false,
    };
  }

  const [existingOrganization] = existingOrganizations;

  if (existingOrganization.slug !== boundOrganizationSlug) {
    return {
      boundOrganizationId: existingOrganization.id,
      boundOrganizationSlug,
      code: "organization_mismatch",
      detail: `Hosted deployment is bound to organization "${boundOrganizationSlug}", but the only configured organization is "${existingOrganization.slug}".`,
      organizationCount: 1,
      valid: false,
    };
  }

  return {
    boundOrganizationId: existingOrganization.id,
    boundOrganizationSlug,
    code: "valid",
    detail: `Hosted deployment is bound to organization "${boundOrganizationSlug}".`,
    organizationCount: 1,
    valid: true,
  };
}

export async function assertHostedOrganizationAccess(organizationSlug: string) {
  const validation = await getHostedDeploymentValidation();

  if (!validation.valid) {
    throw new Error(validation.detail);
  }

  if (
    isHostedDeployment() &&
    validation.boundOrganizationSlug &&
    organizationSlug !== validation.boundOrganizationSlug
  ) {
    throw new Error(
      `Hosted deployment is bound to organization "${validation.boundOrganizationSlug}", but access was attempted for "${organizationSlug}".`,
    );
  }
}
