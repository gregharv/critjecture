import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  ensureOrganizationCompanyDataRoot,
  getDefaultOrganizationName,
  getDefaultOrganizationSlug,
} from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import { isSingleOrgDeployment } from "@/lib/deployment-mode";
import {
  organizationMemberships,
  organizations,
} from "@/lib/app-schema";
import type { UserRole } from "@/lib/roles";

export type OrganizationMembershipContext = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
};

const SINGLE_ORGANIZATION_MODE_ERROR =
  "Step 10 runs in single-organization mode. Resolve the extra organization rows before continuing.";

export async function getExistingOrganizations() {
  const db = await getAppDatabase();

  return db
    .select()
    .from(organizations)
    .orderBy(asc(organizations.createdAt));
}

async function getSingleConfiguredOrganization() {
  if (!isSingleOrgDeployment()) {
    throw new Error("Default single-organization resolution is unavailable in hosted mode.");
  }

  const slug = getDefaultOrganizationSlug();
  const organizationsList = await getExistingOrganizations();

  if (organizationsList.length > 1) {
    throw new Error(SINGLE_ORGANIZATION_MODE_ERROR);
  }

  const existingOrganization = organizationsList[0] ?? null;

  if (!existingOrganization) {
    return {
      configuredSlug: slug,
      organization: null,
    };
  }

  if (existingOrganization.slug !== slug) {
    throw new Error(
      `Step 10 runs in single-organization mode. Existing organization slug "${existingOrganization.slug}" does not match configured slug "${slug}".`,
    );
  }

  return {
    configuredSlug: slug,
    organization: existingOrganization,
  };
}

export async function ensureDefaultOrganization() {
  if (!isSingleOrgDeployment()) {
    throw new Error("Default organization seeding is disabled in hosted mode.");
  }

  const db = await getAppDatabase();
  const name = getDefaultOrganizationName();
  const now = Date.now();
  const { configuredSlug, organization: existingOrganization } =
    await getSingleConfiguredOrganization();

  if (!existingOrganization) {
    const createdOrganization = {
      createdAt: now,
      id: randomUUID(),
      name,
      slug: configuredSlug,
      updatedAt: now,
    } satisfies typeof organizations.$inferInsert;

    await db.insert(organizations).values(createdOrganization);
    await ensureOrganizationCompanyDataRoot(configuredSlug);

    return createdOrganization;
  }

  await db
    .update(organizations)
    .set({
      name,
      updatedAt: now,
    })
    .where(eq(organizations.id, existingOrganization.id));

  await ensureOrganizationCompanyDataRoot(existingOrganization.slug);

  return {
    ...existingOrganization,
    name,
    updatedAt: now,
  };
}

export async function getOrganizationById(organizationId: string) {
  const db = await getAppDatabase();

  return db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });
}

export async function getOrganizationBySlug(organizationSlug: string) {
  const db = await getAppDatabase();

  return db.query.organizations.findFirst({
    where: eq(organizations.slug, organizationSlug),
  });
}

export async function createOrganization(input: {
  name: string;
  slug: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const createdOrganization = {
    createdAt: now,
    id: randomUUID(),
    name: input.name.trim(),
    slug: input.slug.trim(),
    updatedAt: now,
  } satisfies typeof organizations.$inferInsert;

  await db.insert(organizations).values(createdOrganization);
  await ensureOrganizationCompanyDataRoot(createdOrganization.slug);

  return createdOrganization;
}

export async function updateOrganizationDisplayName(input: {
  name: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const nextName = input.name.trim();

  await db
    .update(organizations)
    .set({
      name: nextName,
      updatedAt: now,
    })
    .where(eq(organizations.id, input.organizationId));

  return getOrganizationById(input.organizationId);
}

export async function ensureOrganizationMembership(
  userId: string,
  organizationId: string,
  role: UserRole,
) {
  const db = await getAppDatabase();
  const now = Date.now();
  const existingMembership = await db.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, userId),
    ),
  });

  if (!existingMembership) {
    await db.insert(organizationMemberships).values({
      createdAt: now,
      id: randomUUID(),
      organizationId,
      role,
      updatedAt: now,
      userId,
    });

    return;
  }

  await db
    .update(organizationMemberships)
    .set({
      role,
      updatedAt: now,
    })
    .where(eq(organizationMemberships.id, existingMembership.id));
}

export async function getPrimaryMembershipForUser(userId: string) {
  const db = await getAppDatabase();

  if (isSingleOrgDeployment()) {
    const { organization } = await getSingleConfiguredOrganization();

    if (!organization) {
      return null;
    }

    const rows = await db
      .select({
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, organization.id),
        ),
      )
      .orderBy(asc(organizationMemberships.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  const rows = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1);

  return rows[0] ?? null;
}
