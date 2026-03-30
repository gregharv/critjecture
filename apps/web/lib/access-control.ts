import type { KnowledgeAccessScope } from "@/lib/knowledge-types";
import type { UserRole } from "@/lib/roles";

export const MEMBERSHIP_STATUSES = ["active", "restricted", "suspended"] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type AccessCapability =
  | "workspace_access"
  | "chat"
  | "search"
  | "sandbox"
  | "knowledge_view"
  | "knowledge_write"
  | "member_management"
  | "audit_logs_view"
  | "operations_view"
  | "admin_settings"
  | "organization_settings"
  | "governance_view"
  | "governance_manage"
  | "governance_download"
  | "customer_review_docs"
  | "generated_asset_override";

export type AccessSnapshot = {
  capabilities: AccessCapability[];
  canAccessAdminSettings: boolean;
  canAccessWorkspace: boolean;
  canDownloadGeneratedAssetsCreatedByOthers: boolean;
  canManageGovernance: boolean;
  canManageMembers: boolean;
  canManageOrganizationSettings: boolean;
  canUseAnswerTools: boolean;
  canViewAuditLogs: boolean;
  canViewCustomerReviewDocs: boolean;
  canViewGovernance: boolean;
  canViewKnowledgeLibrary: boolean;
  canViewOperations: boolean;
  canWriteKnowledge: boolean;
  membershipStatus: MembershipStatus;
  role: UserRole;
  visibleKnowledgeScopes: KnowledgeAccessScope[];
};

function dedupeCapabilities(capabilities: AccessCapability[]) {
  return [...new Set(capabilities)];
}

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return (
    typeof value === "string" &&
    MEMBERSHIP_STATUSES.includes(value as MembershipStatus)
  );
}

export function canRoleAccessKnowledgeScope(
  role: UserRole,
  scope: KnowledgeAccessScope,
) {
  return role === "owner" || role === "admin" || scope === "public";
}

export function getVisibleKnowledgeScopes(
  role: UserRole,
  membershipStatus: MembershipStatus,
): KnowledgeAccessScope[] {
  if (membershipStatus !== "active") {
    return [];
  }

  return canRoleAccessKnowledgeScope(role, "admin") ? ["public", "admin"] : ["public"];
}

export function buildAccessSnapshot(
  role: UserRole,
  membershipStatus: MembershipStatus,
): AccessSnapshot {
  const visibleKnowledgeScopes = getVisibleKnowledgeScopes(role, membershipStatus);
  const active = membershipStatus === "active";
  const capabilitiesInput: AccessCapability[] = [
    "workspace_access",
    ...(active ? (["knowledge_view"] as AccessCapability[]) : []),
    ...(active && (role === "member" || role === "admin" || role === "owner")
      ? (["chat", "search", "sandbox"] as AccessCapability[])
      : []),
    ...(active && (role === "admin" || role === "owner")
      ? ([
          "admin_settings",
          "member_management",
          "audit_logs_view",
          "operations_view",
          "governance_view",
          "customer_review_docs",
          "knowledge_write",
        ] as AccessCapability[])
      : []),
    ...(active && role === "owner"
      ? ([
          "organization_settings",
          "governance_manage",
          "governance_download",
          "generated_asset_override",
        ] as AccessCapability[])
      : []),
  ];

  const capabilities = dedupeCapabilities(capabilitiesInput);

  return {
    capabilities,
    canAccessAdminSettings: capabilities.includes("admin_settings"),
    canAccessWorkspace: capabilities.includes("workspace_access"),
    canDownloadGeneratedAssetsCreatedByOthers: capabilities.includes(
      "generated_asset_override",
    ),
    canManageGovernance: capabilities.includes("governance_manage"),
    canManageMembers: capabilities.includes("member_management"),
    canManageOrganizationSettings: capabilities.includes("organization_settings"),
    canUseAnswerTools:
      capabilities.includes("chat") &&
      capabilities.includes("search") &&
      capabilities.includes("sandbox"),
    canViewAuditLogs: capabilities.includes("audit_logs_view"),
    canViewCustomerReviewDocs: capabilities.includes("customer_review_docs"),
    canViewGovernance: capabilities.includes("governance_view"),
    canViewKnowledgeLibrary: capabilities.includes("knowledge_view"),
    canViewOperations: capabilities.includes("operations_view"),
    canWriteKnowledge: capabilities.includes("knowledge_write"),
    membershipStatus,
    role,
    visibleKnowledgeScopes,
  };
}

export function hasAccessCapability(
  access: Pick<AccessSnapshot, "capabilities">,
  capability: AccessCapability,
) {
  return access.capabilities.includes(capability);
}

export function getRestrictedWorkspaceMessage(membershipStatus: MembershipStatus) {
  if (membershipStatus === "restricted") {
    return "This membership is restricted. Chat, search, uploads, and admin actions are disabled.";
  }

  return "Workspace access is unavailable for this membership.";
}
