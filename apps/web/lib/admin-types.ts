import type { MembershipStatus } from "@/lib/access-control";
import type { UserRole } from "@/lib/roles";
import type { WorkspacePlanSummary, WorkspacePlanUsageSnapshot } from "@/lib/workspace-plans";

export const GOVERNANCE_JOB_TYPES = [
  "organization_export",
  "knowledge_delete",
  "history_purge",
  "import_metadata_purge",
] as const;
export const GOVERNANCE_JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;
export const GOVERNANCE_TRIGGER_KINDS = ["manual", "automatic"] as const;

export type GovernanceJobType = (typeof GOVERNANCE_JOB_TYPES)[number];
export type GovernanceJobStatus = (typeof GOVERNANCE_JOB_STATUSES)[number];
export type GovernanceTriggerKind = (typeof GOVERNANCE_TRIGGER_KINDS)[number];

export type OrganizationAdminSummary = {
  id: string;
  name: string;
  slug: string;
};

export type OrganizationWorkspacePlanSummary = WorkspacePlanSummary &
  Pick<WorkspacePlanUsageSnapshot, "exhausted" | "remainingCredits" | "resetAt" | "usedCredits">;

export type AdminMemberRecord = {
  capabilitySummary: string[];
  createdAt: number;
  email: string;
  id: string;
  monthlyCreditCap: number | null;
  name: string | null;
  role: UserRole;
  status: MembershipStatus;
  updatedAt: number;
};

export type OrganizationComplianceSettings = {
  alertRetentionDays: number | null;
  chatHistoryRetentionDays: number | null;
  exportArtifactRetentionDays: number;
  knowledgeImportRetentionDays: number | null;
  requestLogRetentionDays: number | null;
  updatedAt: number | null;
  updatedByUserEmail: string | null;
  usageRetentionDays: number | null;
};

export type GovernanceJobArtifact = {
  byteSize: number | null;
  fileName: string | null;
  hasArtifact: boolean;
};

export type GovernanceJobRecord = {
  artifact: GovernanceJobArtifact;
  completedAt: number | null;
  createdAt: number;
  cutoffTimestamp: number | null;
  errorMessage: string | null;
  id: string;
  jobType: GovernanceJobType;
  metadata: Record<string, unknown>;
  requestedByUserEmail: string | null;
  result: Record<string, unknown>;
  startedAt: number | null;
  status: GovernanceJobStatus;
  targetLabel: string;
  triggerRequestId: string | null;
  triggerKind: GovernanceTriggerKind;
  updatedAt: number;
};

export type ListOrganizationMembersResponse = {
  members: AdminMemberRecord[];
  organization: OrganizationAdminSummary;
};

export type GetOrganizationAdminResponse = {
  organization: OrganizationAdminSummary;
  workspacePlan: OrganizationWorkspacePlanSummary;
};

export type SaveComplianceSettingsResponse = {
  organization: OrganizationAdminSummary;
  settings: OrganizationComplianceSettings;
};

export type GetComplianceSettingsResponse = SaveComplianceSettingsResponse;

export type ListGovernanceJobsResponse = {
  jobs: GovernanceJobRecord[];
};

export type GetGovernanceJobResponse = {
  job: GovernanceJobRecord;
};
