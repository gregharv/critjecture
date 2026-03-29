import "server-only";

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { users } from "@/lib/app-schema";
import {
  backfillLegacyOrganizationScope,
  ensureDefaultOrganization,
  getPrimaryMembershipForUser,
} from "@/lib/organizations";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { type UserRole } from "@/lib/roles";

export type AppUser = {
  email: string;
  id: string;
  name: string | null;
  passwordHash: string;
  role: UserRole;
};

export type AuthenticatedAppUser = {
  email: string;
  id: string;
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
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, input.email),
  });

  if (!existingUser) {
    await db.insert(users).values({
      id: randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    });

    return;
  }

  await db
    .update(users)
    .set({
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      updatedAt: now,
    })
    .where(eq(users.id, existingUser.id));
}

async function ensureSeedUsers() {
  const seedUsers = [
    getSeedUserInput("CRITJECTURE_OWNER", "owner"),
    getSeedUserInput("CRITJECTURE_INTERN", "intern"),
  ].filter((value): value is SeedUserInput => value !== null);

  for (const seedUser of seedUsers) {
    await upsertSeedUser(seedUser);
  }
}

export async function ensureSeedState() {
  if (!seedStatePromise) {
    seedStatePromise = (async () => {
      await ensureSeedUsers();
      const defaultOrganization = await ensureDefaultOrganization();
      await backfillLegacyOrganizationScope(defaultOrganization.id);
    })().catch((error) => {
      seedStatePromise = null;
      throw error;
    });
  }

  await seedStatePromise;
}

function mapUserRecord(record: typeof users.$inferSelect): AppUser {
  return {
    email: record.email,
    id: record.id,
    name: record.name,
    passwordHash: record.passwordHash,
    role: record.role,
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
  const membership = await getPrimaryMembershipForUser(user.id);

  if (!membership) {
    return null;
  }

  return {
    email: user.email,
    id: user.id,
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

  if (!user) {
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return getAuthenticatedUserForRecord(user);
}
