import "server-only";

import { getAppDatabase } from "@/lib/app-db";
import {
  organizationMemberships,
  organizations,
  users,
} from "@/lib/app-schema";
import type { AuthenticatedAppUser } from "@/lib/users";

export async function ensureCausalFoundationForUser(user: AuthenticatedAppUser) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .insert(users)
    .values({
      id: user.id,
      email: user.email,
      name: user.name,
      status: "active",
      passwordHash: "legacy-auth-managed",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: user.email,
        name: user.name,
        status: "active",
        updatedAt: now,
      },
    });

  await db
    .insert(organizations)
    .values({
      id: user.organizationId,
      name: user.organizationName,
      slug: user.organizationSlug,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: {
        name: user.organizationName,
        slug: user.organizationSlug,
        status: "active",
        updatedAt: now,
      },
    });

  await db
    .insert(organizationMemberships)
    .values({
      id: `${user.organizationId}:${user.id}`,
      organizationId: user.organizationId,
      userId: user.id,
      role: user.role,
      status: user.membershipStatus,
      monthlyCreditCap: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [organizationMemberships.organizationId, organizationMemberships.userId],
      set: {
        role: user.role,
        status: user.membershipStatus,
        updatedAt: now,
      },
    });
}
