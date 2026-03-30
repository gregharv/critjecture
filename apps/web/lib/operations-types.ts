import type {
  OperationsPoliciesSnapshot,
  OperationsRouteGroup,
} from "@/lib/operations-policy";
import type { SandboxExecutionBackend } from "@/lib/sandbox-policy";

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
  costUsd: number;
  eventType: string;
  outputTokens: number;
  quantity: number;
  requestCount: number;
  routeGroup: OperationsRouteGroup;
  totalTokens: number;
};

export type UsageActorSummary = {
  costUsd: number;
  name: string;
  outputTokens: number;
  quantity: number;
  requestCount: number;
  totalTokens: number;
  userId: string;
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
