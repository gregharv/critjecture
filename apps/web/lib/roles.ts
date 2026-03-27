export const USER_ROLES = ["intern", "owner"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function getRoleLabel(role: UserRole) {
  return role === "owner" ? "Owner" : "Intern";
}
