import "server-only";

import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { isUserRole, type UserRole } from "@/lib/roles";

export type SessionUser = {
  email: string;
  id: string;
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

  if (!isUserRole(user.role)) {
    return null;
  }

  return {
    email: user.email,
    id: user.id,
    name: typeof user.name === "string" ? user.name : null,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    organizationSlug: user.organizationSlug,
    role: user.role,
  };
}

export async function getSessionUser() {
  const session = await auth();

  return getSafeSessionUser(session);
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
    redirect("/chat");
  }

  return user;
}
