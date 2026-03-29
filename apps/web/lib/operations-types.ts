import type {
  OperationsPoliciesSnapshot,
  OperationsRouteGroup,
} from "@/lib/operations-policy";

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
  outcome: string;
  requestId: string;
  routeGroup: OperationsRouteGroup;
  routeKey: string;
  statusCode: number;
  toolName: string | null;
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
