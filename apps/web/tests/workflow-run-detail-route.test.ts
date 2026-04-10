import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-run-detail-route" })),
  enforceRateLimitPolicy: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getPreviousWorkflowRun: vi.fn(),
  getSessionUser: vi.fn(),
  getWorkflowRunById: vi.fn(),
  listWorkflowRunDeliveries: vi.fn(),
  listWorkflowRunInputChecks: vi.fn(),
  listWorkflowRunInputRequests: vi.fn(),
  listWorkflowRunSteps: vi.fn(),
  runOperationsMaintenance: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/workflow-runs", () => ({
  getPreviousWorkflowRun: mocks.getPreviousWorkflowRun,
  getWorkflowRunById: mocks.getWorkflowRunById,
  listWorkflowRunDeliveries: mocks.listWorkflowRunDeliveries,
  listWorkflowRunInputChecks: mocks.listWorkflowRunInputChecks,
  listWorkflowRunInputRequests: mocks.listWorkflowRunInputRequests,
  listWorkflowRunSteps: mocks.listWorkflowRunSteps,
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

import { GET } from "@/app/api/workflow-runs/[runId]/route";

describe("/api/workflow-runs/[runId] route", () => {
  const context = {
    params: Promise.resolve({
      runId: "run-1",
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "owner" }));
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.getWorkflowRunById.mockResolvedValue({
      completedAt: Date.now(),
      createdAt: Date.now() - 1000,
      failureReason: null,
      id: "run-1",
      metadata: {},
      organizationId: "org-1",
      requestId: "req-1",
      runAsRole: "owner",
      runAsUserId: "user-1",
      startedAt: Date.now() - 900,
      status: "completed",
      triggerKind: "manual",
      triggerWindowKey: null,
      updatedAt: Date.now(),
      workflowId: "wf-1",
      workflowVersionId: "wf-v1",
      workflowVersionNumber: 1,
    });
    mocks.listWorkflowRunInputChecks.mockResolvedValue({ checks: [] });
    mocks.listWorkflowRunInputRequests.mockResolvedValue({ requests: [] });
    mocks.listWorkflowRunSteps.mockResolvedValue({ steps: [] });
    mocks.listWorkflowRunDeliveries.mockResolvedValue({ deliveries: [] });
    mocks.getPreviousWorkflowRun.mockResolvedValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/workflow-runs/run-1"), context);

    expect(response.status).toBe(401);
  });

  it("returns 429 when rate-limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await GET(new Request("http://localhost/api/workflow-runs/run-1"), context);

    expect(response.status).toBe(429);
  });

  it("returns 404 when run is missing", async () => {
    mocks.getWorkflowRunById.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/workflow-runs/run-1"), context);

    expect(response.status).toBe(404);
  });

  it("returns expanded run detail payload", async () => {
    mocks.getPreviousWorkflowRun.mockResolvedValue({
      completedAt: Date.now() - 5000,
      createdAt: Date.now() - 8000,
      failureReason: null,
      id: "run-0",
      metadata: {},
      organizationId: "org-1",
      requestId: "req-0",
      runAsRole: "owner",
      runAsUserId: "user-1",
      startedAt: Date.now() - 7000,
      status: "completed",
      triggerKind: "manual",
      triggerWindowKey: null,
      updatedAt: Date.now() - 4000,
      workflowId: "wf-1",
      workflowVersionId: "wf-v1",
      workflowVersionNumber: 1,
    });

    const response = await GET(new Request("http://localhost/api/workflow-runs/run-1"), context);
    const body = await readJson<{
      alerts: unknown[];
      changeSummary: { comparedToRunId: string | null };
      deliveries: unknown[];
      inputChecks: unknown[];
      inputRequests: unknown[];
      previousRun: { id: string } | null;
      run: { id: string };
      steps: unknown[];
    }>(response);

    expect(response.status).toBe(200);
    expect(body.run.id).toBe("run-1");
    expect(body.previousRun?.id).toBe("run-0");
    expect(body.changeSummary.comparedToRunId).toBe("run-0");
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(Array.isArray(body.inputChecks)).toBe(true);
    expect(Array.isArray(body.inputRequests)).toBe(true);
    expect(Array.isArray(body.steps)).toBe(true);
    expect(Array.isArray(body.deliveries)).toBe(true);
  });
});
