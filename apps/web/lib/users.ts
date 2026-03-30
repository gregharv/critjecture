import "server-only";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { buildAccessSnapshot, type MembershipStatus } from "@/lib/access-control";
import { getAppDatabase } from "@/lib/app-db";
import { organizationMemberships, users } from "@/lib/app-schema";
import { isSingleOrgDeployment } from "@/lib/deployment-mode";
import {
  ensureDefaultOrganization,
  ensureOrganizationMembership,
  getPrimaryMembershipForUser,
} from "@/lib/organizations";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  toLegacyStoredUserRole,
  type LegacyStoredUserRole,
  type UserRole,
} from "@/lib/roles";

export const USER_STATUSES = ["active", "suspended"] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export type AppUser = {
  email: string;
  id: string;
  name: string | null;
  passwordHash: string;
  role: LegacyStoredUserRole;
  status: UserStatus;
};

export type AuthenticatedAppUser = {
  access: ReturnType<typeof buildAccessSnapshot>;
  email: string;
  id: string;
  membershipStatus: MembershipStatus;
  name: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
};

type SeedUserInput = {
  email: string;
  name: string | null;
  password: string;
  role: UserRole;
};

let seedStatePromise: Promise<void> | null = null;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getSeedUserInput(prefix: "CRITJECTURE_OWNER" | "CRITJECTURE_INTERN", role: UserRole) {
  const email = normalizeEmail(process.env[`${prefix}_EMAIL`] ?? "");
  const password = (process.env[`${prefix}_PASSWORD`] ?? "").trim();
  const name = (process.env[`${prefix}_NAME`] ?? "").trim() || null;

  if (!email && !password && !name) {
    return null;
  }

  if (!email || !password) {
    throw new Error(`${prefix}_EMAIL and ${prefix}_PASSWORD must both be configured.`);
  }

  return {
    email,
    name,
    password,
    role,
  } satisfies SeedUserInput;
}

async function upsertSeedUser(input: SeedUserInput) {
  const db = await getAppDatabase();
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });
  const defaultOrganization = await ensureDefaultOrganization();

  if (!existingUser) {
    const passwordHash = await hashPassword(input.password);
    const now = Date.now();
    const createdUserId = randomUUID();

    await db.insert(users).values({
      id: createdUserId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: toLegacyStoredUserRole(input.role),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ensureOrganizationMembership(createdUserId, defaultOrganization.id, input.role);

    return;
  }
  const existingMembership = await db.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, defaultOrganization.id),
      eq(organizationMemberships.userId, existingUser.id),
    ),
  });

  if (!existingMembership) {
    await ensureOrganizationMembership(existingUser.id, defaultOrganization.id, input.role);
  }
}

async function ensureSeedUsers() {
  if (!isSingleOrgDeployment()) {
    return;
  }

  const seedUsers = [
    getSeedUserInput("CRITJECTURE_OWNER", "owner"),
    getSeedUserInput("CRITJECTURE_INTERN", "member"),
  ].filter((value): value is SeedUserInput => value !== null);

  for (const seedUser of seedUsers) {
    await upsertSeedUser(seedUser);
  }
}

export async function ensureSeedState() {
  if (!seedStatePromise) {
    seedStatePromise = (async () => {
      if (isSingleOrgDeployment()) {
        await ensureSeedUsers();
        await ensureDefaultOrganization();
      }
    })().catch((error) => {
      seedStatePromise = null;
      throw error;
    });
  }

  await seedStatePromise;
}

export function resetUserSeedStateForTests() {
  seedStatePromise = null;
}

function mapUserRecord(record: typeof users.$inferSelect): AppUser {
  return {
    email: record.email,
    id: record.id,
    name: record.name,
    passwordHash: record.passwordHash,
    role: record.role,
    status: record.status,
  };
}

export async function getUserByEmail(email: string) {
  await ensureSeedState();

  const db = await getAppDatabase();
  const user = await db.query.users.findFirst({
    where: eq(users.email, normalizeEmail(email)),
  });

  return user ? mapUserRecord(user) : null;
}

export async function getUserById(id: string) {
  await ensureSeedState();

  const db = await getAppDatabase();
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  return user ? mapUserRecord(user) : null;
}

async function getAuthenticatedUserForRecord(user: AppUser): Promise<AuthenticatedAppUser | null> {
  if (user.status !== "active") {
    return null;
  }

  const membership = await getPrimaryMembershipForUser(user.id);

  if (!membership) {
    return null;
  }

  if (membership.status === "suspended") {
    return null;
  }

  return {
    access: buildAccessSnapshot(membership.role, membership.status),
    email: user.email,
    id: user.id,
    membershipStatus: membership.status,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    organizationSlug: membership.organizationSlug,
    role: membership.role,
  };
}

export async function getAuthenticatedUserById(id: string) {
  const user = await getUserById(id);

  if (!user) {
    return null;
  }

  return getAuthenticatedUserForRecord(user);
}

export async function getAuthenticatedUserByEmail(email: string) {
  const user = await getUserByEmail(email);

  if (!user) {
    return null;
  }

  return getAuthenticatedUserForRecord(user);
}

export async function authenticateUser(email: string, password: string) {
  const user = await getUserByEmail(email);

  if (!user || user.status !== "active") {
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return getAuthenticatedUserForRecord(user);
}

export async function getLoginFailureReason(email: string, password: string) {
  const user = await getUserByEmail(email);

  if (!user) {
    return "invalid" as const;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    return "invalid" as const;
  }

  if (user.status !== "active") {
    return "suspended" as const;
  }

  const membership = await getPrimaryMembershipForUser(user.id);

  if (!membership || membership.status === "suspended") {
    return "suspended" as const;
  }

  return "ok" as const;
}
