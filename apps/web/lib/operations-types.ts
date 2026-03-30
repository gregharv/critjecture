import type {
  OperationsPoliciesSnapshot,
  OperationsRouteGroup,
} from "@/lib/operations-policy";
import type { MembershipStatus } from "@/lib/access-control";
import type { SandboxExecutionBackend } from "@/lib/sandbox-policy";
import type { CommercialUsageClass, WorkspacePlanSummary } from "@/lib/workspace-plans";

export type OperationalAlertSeverity = "warning" | "critical";
export type OperationalAlertStatus = "open" | "resolved";

export type HealthCheckStatus = "ok" | "degraded" | "fail";

export type HealthCheckResult = {
  detail: string;
  name: string;
  status: Exclude<HealthCheckStatus, "fail"> | "fail";
};

export type HealthSummary = {
  checks: HealthCheckResult[];
  sandbox: {
    abandonedRuns: number;
    activeRuns: number;
    available: boolean;
    backend: SandboxExecutionBackend;
    detail: string;
    lastHeartbeatAt: number | null;
    lastReconciledAt: number | null;
    queuedRuns: number;
    rejectedRuns: number;
    staleRuns: number;
  };
  status: HealthCheckStatus;
  timestamp: string;
};

export type RouteMetricSummary = {
  avgDurationMs: number;
  errorCount: number;
  rateLimitedCount: number;
  requestCount: number;
  routeGroup: OperationsRouteGroup;
  successCount: number;
};

export type UsageMetricSummary = {
  commercialCredits: number;
  costUsd: number;
  eventType: string;
  outputTokens: number;
  quantity: number;
  requestCount: number;
  routeGroup: OperationsRouteGroup;
  totalTokens: number;
};

export type UsageActorSummary = {
  creditCap: number | null;
  creditsUsed: number;
  costUsd: number;
  name: string;
  outputTokens: number;
  quantity: number;
  remainingCreditCap: number | null;
  requestCount: number;
  status: MembershipStatus;
  totalTokens: number;
  userId: string;
};

export type WorkspaceCommercialSummary = WorkspacePlanSummary & {
  exhausted: boolean;
  pendingCredits: number;
  remainingCredits: number;
  resetAt: number;
  usedCredits: number;
};

export type CommercialBlockSummary = {
  planName: string;
  remainingUserCredits: number | null;
  remainingWorkspaceCredits: number;
  requiredCredits: number;
  resetAt: number;
  scope: "user" | "workspace";
  status: "credit_exhausted";
  usageClass: CommercialUsageClass;
};

export type RecentFailureSummary = {
  completedAt: number;
  errorCode: string | null;
  governanceJobId: string | null;
  knowledgeImportJobId: string | null;
  outcome: string;
  requestId: string;
  runtimeToolCallId: string | null;
  routeGroup: OperationsRouteGroup;
  routeKey: string;
  sandboxRunId: string | null;
  statusCode: number;
  toolName: string | null;
  turnId: string | null;
  userEmail: string | null;
};

export type OperationsAlertSummary = {
  alertType: string;
  id: string;
  lastSeenAt: number;
  message: string;
  occurrenceCount: number;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  title: string;
};

export type OperationsSummaryResponse = {
  alerts: OperationsAlertSummary[];
  health: HealthSummary;
  policies: OperationsPoliciesSnapshot;
  workspace: WorkspaceCommercialSummary;
  rateLimitActivity: Array<{
    count: number;
    routeGroup: OperationsRouteGroup;
  }>;
  recentFailures: RecentFailureSummary[];
  routeMetrics: RouteMetricSummary[];
  usageSummary: {
    byEventType: UsageMetricSummary[];
    byRouteGroup: UsageMetricSummary[];
    byUser: UsageActorSummary[];
    window: "24h" | "7d";
  };
};
