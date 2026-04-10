import "server-only";

import { isHostedDeployment } from "@/lib/deployment-mode";

type SchedulerGateReason = "scheduler_disabled" | "hosted_scheduler_disabled";

function parseBooleanEnv(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isWorkflowAsyncManualRunsEnabled() {
  return parseBooleanEnv(process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS);
}

export function getWorkflowSchedulerGateStatus() {
  if (!parseBooleanEnv(process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER)) {
    return {
      enabled: false,
      reason: "scheduler_disabled" as SchedulerGateReason,
    } as const;
  }

  if (isHostedDeployment() && !parseBooleanEnv(process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS)) {
    return {
      enabled: false,
      reason: "hosted_scheduler_disabled" as SchedulerGateReason,
    } as const;
  }

  return {
    enabled: true,
    reason: null,
  } as const;
}
