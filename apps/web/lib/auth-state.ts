import "server-only";

import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import {
  buildAccessSnapshot,
  hasAccessCapability,
  isMembershipStatus,
  type AccessCapability,
  type AccessSnapshot,
  type MembershipStatus,
} from "@/lib/access-control";
import { isUserRole, type UserRole } from "@/lib/roles";
import { getAuthenticatedUserByEmail, getAuthenticatedUserById } from "@/lib/users";

export type SessionUser = {
  access: AccessSnapshot;
  email: string;
  id: string;
  membershipStatus: MembershipStatus;
  name: string | null;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
};

function getSafeSessionUser(session: Session | null): SessionUser | null {
  const user = session?.user;

  if (
    !user ||
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.organizationId !== "string" ||
    typeof user.organizationName !== "string" ||
    typeof user.organizationSlug !== "string"
  ) {
    return null;
  }

  if (!isUserRole(user.role) || !isMembershipStatus(user.membershipStatus)) {
    return null;
  }

  return {
    access: buildAccessSnapshot(user.role, user.membershipStatus),
    email: user.email,
    id: user.id,
    membershipStatus: user.membershipStatus,
    name: typeof user.name === "string" ? user.name : null,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    organizationSlug: user.organizationSlug,
    role: user.role,
  };
}

export async function getSessionUser() {
  const session = await auth();
  const user = getSafeSessionUser(session);

  if (!user) {
    return null;
  }

  return (
    (await getAuthenticatedUserById(user.id)) ??
    (await getAuthenticatedUserByEmail(user.email))
  );
}

export async function requirePageUser() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireOwnerPageUser() {
  const user = await requirePageUser();

  if (user.role !== "owner") {
    redirect("/causal");
  }

  return user;
}

export async function requirePageUserCapability(capability: AccessCapability) {
  const user = await requirePageUser();

  if (!hasAccessCapability(user.access, capability)) {
    redirect("/causal");
  }

  return user;
}
