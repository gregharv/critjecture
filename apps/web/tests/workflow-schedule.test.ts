import { afterEach, describe, expect, it } from "vitest";

import {
  buildScheduledWindowKey,
  computeNextScheduledRunAt,
  getWorkflowSchedulerSettings,
} from "@/lib/workflow-schedule";

const originalSchedulerMaxWorkflows = process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK;
const originalSchedulerMaxWindows = process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW;
const originalSchedulerBackpressure = process.env.CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT;

afterEach(() => {
  if (originalSchedulerMaxWorkflows === undefined) {
    delete process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK;
  } else {
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK = originalSchedulerMaxWorkflows;
  }

  if (originalSchedulerMaxWindows === undefined) {
    delete process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW;
  } else {
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW = originalSchedulerMaxWindows;
  }

  if (originalSchedulerBackpressure === undefined) {
    delete process.env.CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT;
  } else {
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT = originalSchedulerBackpressure;
  }
});

describe("computeNextScheduledRunAt", () => {
  it("returns null for manual-only schedules", () => {
    const nextRunAt = computeNextScheduledRunAt(
      {
        kind: "manual_only",
        schema_version: 1,
      },
      Date.UTC(2026, 0, 4, 12, 0, 0),
    );

    expect(nextRunAt).toBeNull();
  });

  it("computes the next weekly run in UTC", () => {
    const schedule = {
      cadence: {
        day_of_week: 1,
        hour: 9,
        kind: "weekly",
        minute: 30,
      },
      catch_up_policy: "enqueue_missed_windows",
      kind: "recurring",
      schema_version: 1,
      timezone: "UTC",
    } as const;
    const afterAt = Date.UTC(2026, 0, 4, 12, 0, 0);
    const nextRunAt = computeNextScheduledRunAt(schedule, afterAt);

    expect(nextRunAt).toBe(Date.UTC(2026, 0, 5, 9, 30, 0));
  });

  it("treats exact schedule boundary as already passed", () => {
    const schedule = {
      cadence: {
        day_of_week: 1,
        hour: 9,
        kind: "weekly",
        minute: 30,
      },
      catch_up_policy: "enqueue_missed_windows",
      kind: "recurring",
      schema_version: 1,
      timezone: "UTC",
    } as const;
    const afterAt = Date.UTC(2026, 0, 5, 9, 30, 0);
    const nextRunAt = computeNextScheduledRunAt(schedule, afterAt);

    expect(nextRunAt).toBe(Date.UTC(2026, 0, 12, 9, 30, 0));
  });

  it("computes the next monthly run in UTC", () => {
    const schedule = {
      cadence: {
        day_of_month: 15,
        hour: 8,
        kind: "monthly",
        minute: 15,
      },
      catch_up_policy: "enqueue_missed_windows",
      kind: "recurring",
      schema_version: 1,
      timezone: "UTC",
    } as const;
    const beforeThisMonth = Date.UTC(2026, 0, 10, 0, 0, 0);
    const atBoundary = Date.UTC(2026, 0, 15, 8, 15, 0);

    expect(computeNextScheduledRunAt(schedule, beforeThisMonth)).toBe(
      Date.UTC(2026, 0, 15, 8, 15, 0),
    );
    expect(computeNextScheduledRunAt(schedule, atBoundary)).toBe(
      Date.UTC(2026, 1, 15, 8, 15, 0),
    );
  });
});

describe("workflow schedule helpers", () => {
  it("builds deterministic scheduled window keys", () => {
    expect(
      buildScheduledWindowKey({
        windowEndAt: 2000,
        windowStartAt: 1000,
        workflowId: "wf_1",
        workflowVersionId: "wf_v_2",
      }),
    ).toBe("scheduled:v1:wf_1:wf_v_2:1000:2000");
  });

  it("parses scheduler settings with sane defaults", () => {
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WORKFLOWS_PER_TICK = "";
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_MAX_WINDOWS_PER_WORKFLOW = "-3";
    process.env.CRITJECTURE_WORKFLOW_SCHEDULER_QUEUE_BACKPRESSURE_LIMIT = "40";

    const settings = getWorkflowSchedulerSettings();

    expect(settings.maxWorkflowsPerTick).toBe(25);
    expect(settings.maxWindowsPerWorkflow).toBe(24);
    expect(settings.queueBackpressureLimit).toBe(40);
  });
});
