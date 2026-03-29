import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { organizationMemberships, organizations, users } from "@/lib/app-schema";
import type { AdminMemberRecord, OrganizationAdminSummary } from "@/lib/admin-types";
import { ensureOrganizationMembership } from "@/lib/organizations";
import { hashPassword } from "@/lib/passwords";
import type { UserRole } from "@/lib/roles";
import type { UserStatus } from "@/lib/users";

function mapMemberRow(row: {
  createdAt: number;
  email: string;
  id: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  updatedAt: number;
}) {
  return {
    createdAt: row.createdAt,
    email: row.email,
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    updatedAt: row.updatedAt,
  } satisfies AdminMemberRecord;
}

async function getOrganizationSummary(organizationId: string) {
  const db = await getAppDatabase();
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!row) {
    throw new Error("Organization not found.");
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  } satisfies OrganizationAdminSummary;
}

async function getOrganizationMemberRow(input: {
  organizationId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      createdAt: users.createdAt,
      email: users.email,
      id: users.id,
      membershipRole: organizationMemberships.role,
      name: users.name,
      status: users.status,
      updatedAt: users.updatedAt,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, input.organizationId),
        eq(organizationMemberships.userId, input.userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function countActiveOwners(organizationId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, "owner"),
        eq(users.status, "active"),
      ),
    );

  return Number(rows[0]?.count ?? 0);
}

export function wouldRemoveLastActiveOwner(input: {
  activeOwnerCount: number;
  currentRole: UserRole;
  currentStatus: UserStatus;
  nextRole: UserRole;
  nextStatus: UserStatus;
}) {
  const currentlyActiveOwner =
    input.currentRole === "owner" && input.currentStatus === "active";
  const remainsActiveOwner = input.nextRole === "owner" && input.nextStatus === "active";

  return currentlyActiveOwner && !remainsActiveOwner && input.activeOwnerCount <= 1;
}

async function assertOrganizationKeepsOwner(input: {
  nextRole: UserRole;
  nextStatus: UserStatus;
  organizationId: string;
  userId: string;
}) {
  const existing = await getOrganizationMemberRow(input);

  if (!existing) {
    throw new Error("Organization member not found.");
  }

  if (
    !wouldRemoveLastActiveOwner({
      activeOwnerCount: await countActiveOwners(input.organizationId),
      currentRole: existing.membershipRole,
      currentStatus: existing.status,
      nextRole: input.nextRole,
      nextStatus: input.nextStatus,
    })
  ) {
    return;
  }

  throw new Error("The last active owner cannot be suspended or demoted.");
}

export async function listOrganizationMembers(organizationId: string) {
  const db = await getAppDatabase();
  const [organization, rows] = await Promise.all([
    getOrganizationSummary(organizationId),
    db
      .select({
        createdAt: users.createdAt,
        email: users.email,
        id: users.id,
        name: users.name,
        role: organizationMemberships.role,
        status: users.status,
        updatedAt: users.updatedAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(asc(users.createdAt), asc(users.email)),
  ]);

  return {
    members: rows.map(mapMemberRow),
    organization,
  };
}

export async function createOrganizationMember(input: {
  email: string;
  name: string | null;
  organizationId: string;
  password: string;
  role: UserRole;
}) {
  const db = await getAppDatabase();
  const normalizedEmail = input.email.trim().toLowerCase();
  const password = input.password.trim();
  const name = input.name?.trim() || null;

  if (!normalizedEmail || !password) {
    throw new Error("Email and password are required.");
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, normalizedEmail),
  });

  if (existing) {
    throw new Error("A user with that email already exists.");
  }

  const now = Date.now();
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();

  await db.insert(users).values({
    createdAt: now,
    email: normalizedEmail,
    id: userId,
    name,
    passwordHash,
    role: input.role,
    status: "active",
    updatedAt: now,
  });

  await ensureOrganizationMembership(userId, input.organizationId, input.role);

  return mapMemberRow({
    createdAt: now,
    email: normalizedEmail,
    id: userId,
    name,
    role: input.role,
    status: "active",
    updatedAt: now,
  });
}

export async function updateOrganizationMember(input: {
  name?: string | null;
  organizationId: string;
  role?: UserRole;
  status?: UserStatus;
  userId: string;
}) {
  const db = await getAppDatabase();
  const existing = await getOrganizationMemberRow(input);

  if (!existing) {
    throw new Error("Organization member not found.");
  }

  const nextRole = input.role ?? existing.membershipRole;
  const nextStatus = input.status ?? existing.status;

  await assertOrganizationKeepsOwner({
    nextRole,
    nextStatus,
    organizationId: input.organizationId,
    userId: input.userId,
  });

  const now = Date.now();
  const nextName = input.name === undefined ? existing.name : input.name?.trim() || null;

  await db
    .update(users)
    .set({
      name: nextName,
      role: nextRole,
      status: nextStatus,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  await ensureOrganizationMembership(input.userId, input.organizationId, nextRole);

  return mapMemberRow({
    createdAt: existing.createdAt,
    email: existing.email,
    id: existing.id,
    name: nextName,
    role: nextRole,
    status: nextStatus,
    updatedAt: now,
  });
}

export async function resetOrganizationMemberPassword(input: {
  organizationId: string;
  password: string;
  userId: string;
}) {
  const existing = await getOrganizationMemberRow(input);

  if (!existing) {
    throw new Error("Organization member not found.");
  }

  const nextPassword = input.password.trim();

  if (!nextPassword) {
    throw new Error("Password is required.");
  }

  const passwordHash = await hashPassword(nextPassword);
  const now = Date.now();
  const db = await getAppDatabase();

  await db
    .update(users)
    .set({
      passwordHash,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  return mapMemberRow({
    createdAt: existing.createdAt,
    email: existing.email,
    id: existing.id,
    name: existing.name,
    role: existing.membershipRole,
    status: existing.status,
    updatedAt: now,
  });
}
