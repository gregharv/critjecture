import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJsonRequest,
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-runs-route" })),
  createManualWorkflowRun: vi.fn(),
  enforceRateLimitPolicy: vi.fn(),
  ensureWorkflowRunWorkerRunning: vi.fn(),
  executeWorkflowRun: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getSessionUser: vi.fn(),
  getWorkflowDetail: vi.fn(),
  isWorkflowAsyncManualRunsEnabled: vi.fn(),
  listWorkflowRuns: vi.fn(),
  runOperationsMaintenance: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/workflow-runs", () => ({
  createManualWorkflowRun: mocks.createManualWorkflowRun,
  listWorkflowRuns: mocks.listWorkflowRuns,
}));

vi.mock("@/lib/workflows", () => ({
  getWorkflowDetail: mocks.getWorkflowDetail,
}));

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflowRun: mocks.executeWorkflowRun,
}));

vi.mock("@/lib/workflow-flags", () => ({
  isWorkflowAsyncManualRunsEnabled: mocks.isWorkflowAsyncManualRunsEnabled,
}));

vi.mock("@/lib/workflow-worker", () => ({
  ensureWorkflowRunWorkerRunning: mocks.ensureWorkflowRunWorkerRunning,
}));

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildObservedErrorResponse: (message: string, status: number) =>
      NextResponse.json({ error: message }, { status }),
    buildRateLimitedResponse: (decision: { errorCode: string }) =>
      NextResponse.json({ error: decision.errorCode }, { status: 429 }),
    enforceRateLimitPolicy: mocks.enforceRateLimitPolicy,
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { GET, POST } from "@/app/api/workflows/[workflowId]/runs/route";

describe("/api/workflows/[workflowId]/runs route", () => {
  const context = {
    params: Promise.resolve({
      workflowId: "wf-1",
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "owner" }));
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.getWorkflowDetail.mockResolvedValue({ workflow: { id: "wf-1" } });
    mocks.listWorkflowRuns.mockResolvedValue({
      runs: [
        {
          id: "run-1",
        },
      ],
    });
    mocks.createManualWorkflowRun.mockResolvedValue({
      id: "run-queued-1",
      status: "queued",
    });
    mocks.executeWorkflowRun.mockResolvedValue({
      completedStepCount: 0,
      run: {
        id: "run-queued-1",
        status: "completed",
      },
      status: "completed",
      totalStepCount: 0,
    });
    mocks.isWorkflowAsyncManualRunsEnabled.mockReturnValue(false);
  });

  it("returns 400 on GET when limit is invalid", async () => {
    const response = await GET(
      new Request("http://localhost/api/workflows/wf-1/runs?limit=0"),
      context,
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 on GET when workflow is missing", async () => {
    mocks.getWorkflowDetail.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/workflows/wf-1/runs"), context);

    expect(response.status).toBe(404);
  });

  it("returns runs on GET", async () => {
    const response = await GET(new Request("http://localhost/api/workflows/wf-1/runs"), context);
    const body = await readJson<{ runs: Array<{ id: string }> }>(response);

    expect(response.status).toBe(200);
    expect(body.runs[0]?.id).toBe("run-1");
    expect(mocks.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-1",
      }),
    );
  });

  it("returns 403 on POST for non-manager roles", async () => {
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "member" }));

    const response = await POST(createJsonRequest("http://localhost/api/workflows/wf-1/runs"), context);

    expect(response.status).toBe(403);
  });

  it("queues run and wakes worker on POST when async manual execution is enabled", async () => {
    mocks.isWorkflowAsyncManualRunsEnabled.mockReturnValue(true);

    const response = await POST(createJsonRequest("http://localhost/api/workflows/wf-1/runs"), context);
    const body = await readJson<{ run: { id: string }; status: string }>(response);

    expect(response.status).toBe(202);
    expect(body.run.id).toBe("run-queued-1");
    expect(body.status).toBe("queued");
    expect(mocks.ensureWorkflowRunWorkerRunning).toHaveBeenCalledTimes(1);
    expect(mocks.executeWorkflowRun).not.toHaveBeenCalled();
  });

  it("executes run synchronously on POST when async manual execution is disabled", async () => {
    mocks.isWorkflowAsyncManualRunsEnabled.mockReturnValue(false);

    const response = await POST(createJsonRequest("http://localhost/api/workflows/wf-1/runs"), context);
    const body = await readJson<{ run: { id: string }; status: string }>(response);

    expect(response.status).toBe(201);
    expect(body.run.id).toBe("run-queued-1");
    expect(body.status).toBe("completed");
    expect(mocks.executeWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-queued-1",
      }),
    );
  });

  it("returns 429 on POST when rate-limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await POST(createJsonRequest("http://localhost/api/workflows/wf-1/runs"), context);

    expect(response.status).toBe(429);
  });
});
