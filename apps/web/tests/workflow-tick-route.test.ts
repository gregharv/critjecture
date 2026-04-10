import { beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonRequest, readJson } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-tick" })),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getWorkflowSchedulerGateStatus: vi.fn(),
  runOperationsMaintenance: vi.fn(),
  tickDueWorkflowSchedules: vi.fn(),
}));

vi.mock("@/lib/workflow-flags", () => ({
  getWorkflowSchedulerGateStatus: mocks.getWorkflowSchedulerGateStatus,
}));

vi.mock("@/lib/workflow-scheduler", () => ({
  tickDueWorkflowSchedules: mocks.tickDueWorkflowSchedules,
}));

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildObservedErrorResponse: (message: string, status: number) =>
      NextResponse.json({ error: message }, { status }),
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { POST } from "@/app/api/internal/workflows/tick/route";

describe("POST /api/internal/workflows/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.getWorkflowSchedulerGateStatus.mockReturnValue({
      enabled: true,
      reason: null,
    });
    mocks.tickDueWorkflowSchedules.mockResolvedValue({
      backpressureApplied: false,
      claimedWorkflowCount: 1,
      duplicateWindowCount: 0,
      failedWindowCount: 0,
      identityBlockedWindowCount: 0,
      initializedNextRunCount: 0,
      limit: 10,
      nextRunAdvanceCount: 1,
      queuedRunCount: 1,
      scannedWorkflowCount: 1,
      skippedDisabled: false,
      skippedReason: null,
      wakeRequested: true,
      windowCount: 1,
    });
    process.env.CRITJECTURE_WORKFLOW_TICK_SECRET = "secret-token";
  });

  it("returns 503 when internal tick secret is missing", async () => {
    delete process.env.CRITJECTURE_WORKFLOW_TICK_SECRET;

    const response = await POST(createJsonRequest("http://localhost/api/internal/workflows/tick", {}));
    const body = await readJson<{ error: string }>(response);

    expect(response.status).toBe(503);
    expect(body.error).toContain("not configured");
  });

  it("returns 401 when authorization token is invalid", async () => {
    const response = await POST(
      createJsonRequest("http://localhost/api/internal/workflows/tick", {}, {
        headers: {
          authorization: "Bearer wrong-token",
        },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns scheduler-disabled metadata when gate is off", async () => {
    mocks.getWorkflowSchedulerGateStatus.mockReturnValue({
      enabled: false,
      reason: "scheduler_disabled",
    });

    const response = await POST(
      createJsonRequest(
        "http://localhost/api/internal/workflows/tick",
        {},
        {
          headers: {
            authorization: "Bearer secret-token",
          },
        },
      ),
    );
    const body = await readJson<{ schedulerEnabled: boolean; skippedReason: string }>(response);

    expect(response.status).toBe(202);
    expect(body).toEqual({
      schedulerEnabled: false,
      skippedReason: "scheduler_disabled",
    });
    expect(mocks.tickDueWorkflowSchedules).not.toHaveBeenCalled();
  });

  it("runs scheduler tick when authorized", async () => {
    const response = await POST(
      createJsonRequest(
        "http://localhost/api/internal/workflows/tick",
        {
          limit: 5,
          organizationId: "org-1",
        },
        {
          headers: {
            authorization: "Bearer secret-token",
          },
        },
      ),
    );
    const body = await readJson<{ claimedWorkflowCount: number; queuedRunCount: number }>(response);

    expect(response.status).toBe(202);
    expect(body.claimedWorkflowCount).toBe(1);
    expect(body.queuedRunCount).toBe(1);
    expect(mocks.tickDueWorkflowSchedules).toHaveBeenCalledWith({
      limit: 5,
      organizationId: "org-1",
      requestId: "obs-workflow-tick",
    });
  });
});
