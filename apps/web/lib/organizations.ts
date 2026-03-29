import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  ensureOrganizationCompanyDataRoot,
  getDefaultOrganizationName,
  getDefaultOrganizationSlug,
} from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import {
  chatTurns,
  organizationMemberships,
  organizations,
  sandboxRuns,
  users,
} from "@/lib/app-schema";
import type { UserRole } from "@/lib/roles";

export type OrganizationMembershipContext = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
};

export async function ensureDefaultOrganization() {
  const db = await getAppDatabase();
  const slug = getDefaultOrganizationSlug();
  const name = getDefaultOrganizationName();
  const now = Date.now();
  const existingOrganization = await db.query.organizations.findFirst({
    where: eq(organizations.slug, slug),
  });

  if (!existingOrganization) {
    const createdOrganization = {
      createdAt: now,
      id: randomUUID(),
      name,
      slug,
      updatedAt: now,
    } satisfies typeof organizations.$inferInsert;

    await db.insert(organizations).values(createdOrganization);
    await ensureOrganizationCompanyDataRoot(slug);

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

export async function backfillLegacyOrganizationScope(defaultOrganizationId: string) {
  const db = await getAppDatabase();
  const existingUsers = await db
    .select({
      id: users.id,
      role: users.role,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  for (const existingUser of existingUsers) {
    await ensureOrganizationMembership(
      existingUser.id,
      defaultOrganizationId,
      existingUser.role,
    );
  }

  await db
    .update(chatTurns)
    .set({ organizationId: defaultOrganizationId })
    .where(isNull(chatTurns.organizationId));

  await db
    .update(sandboxRuns)
    .set({ organizationId: defaultOrganizationId })
    .where(isNull(sandboxRuns.organizationId));
}

export async function getPrimaryMembershipForUser(userId: string) {
  const db = await getAppDatabase();
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
    .orderBy(asc(organizations.createdAt), asc(organizationMemberships.createdAt))
    .limit(1);

  return rows[0] ?? null;
}
