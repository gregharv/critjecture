export const USER_ROLES = ["member", "admin", "owner"] as const;
export const LEGACY_STORED_USER_ROLES = ["intern", "owner"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type LegacyStoredUserRole = (typeof LEGACY_STORED_USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function getRoleLabel(role: UserRole) {
  if (role === "owner") {
    return "Owner";
  }

  if (role === "admin") {
    return "Admin";
  }

  return "Member";
}

export function isLegacyStoredUserRole(value: unknown): value is LegacyStoredUserRole {
  return (
    typeof value === "string" &&
    LEGACY_STORED_USER_ROLES.includes(value as LegacyStoredUserRole)
  );
}

export function toLegacyStoredUserRole(role: UserRole): LegacyStoredUserRole {
  return role === "owner" ? "owner" : "intern";
}

export function fromLegacyStoredUserRole(role: LegacyStoredUserRole): UserRole {
  return role === "owner" ? "owner" : "member";
}
