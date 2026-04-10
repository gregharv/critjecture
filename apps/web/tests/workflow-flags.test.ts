import { afterEach, describe, expect, it } from "vitest";

import {
  getWorkflowSchedulerGateStatus,
  isWorkflowAsyncManualRunsEnabled,
} from "@/lib/workflow-flags";

const originalDeploymentMode = process.env.CRITJECTURE_DEPLOYMENT_MODE;
const originalEnableAsyncManual = process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS;
const originalEnableScheduler = process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;
const originalEnableHostedScheduled = process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS;

afterEach(() => {
  if (originalDeploymentMode === undefined) {
    delete process.env.CRITJECTURE_DEPLOYMENT_MODE;
  } else {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = originalDeploymentMode;
  }

  if (originalEnableAsyncManual === undefined) {
    delete process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS;
  } else {
    process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS = originalEnableAsyncManual;
  }

  if (originalEnableScheduler === undefined) {
    delete process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;
  } else {
    process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = originalEnableScheduler;
  }

  if (originalEnableHostedScheduled === undefined) {
    delete process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS;
  } else {
    process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS = originalEnableHostedScheduled;
  }
});

describe("workflow flags", () => {
  it("parses async manual workflow execution flag", () => {
    delete process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS;
    expect(isWorkflowAsyncManualRunsEnabled()).toBe(false);

    process.env.CRITJECTURE_ENABLE_WORKFLOW_ASYNC_MANUAL_RUNS = "true";
    expect(isWorkflowAsyncManualRunsEnabled()).toBe(true);
  });

  it("keeps scheduler disabled until enabled", () => {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = "single_org";
    delete process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER;

    expect(getWorkflowSchedulerGateStatus()).toMatchObject({
      enabled: false,
      reason: "scheduler_disabled",
    });
  });

  it("requires explicit hosted override when hosted mode is active", () => {
    process.env.CRITJECTURE_DEPLOYMENT_MODE = "hosted";
    process.env.CRITJECTURE_ENABLE_WORKFLOW_SCHEDULER = "true";
    delete process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS;

    expect(getWorkflowSchedulerGateStatus()).toMatchObject({
      enabled: false,
      reason: "hosted_scheduler_disabled",
    });

    process.env.CRITJECTURE_ENABLE_HOSTED_SCHEDULED_WORKFLOWS = "true";

    expect(getWorkflowSchedulerGateStatus()).toMatchObject({
      enabled: true,
      reason: null,
    });
  });
});
