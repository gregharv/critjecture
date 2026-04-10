import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJsonRequest,
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-detail-route" })),
  enforceRateLimitPolicy: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getSessionUser: vi.fn(),
  getWorkflowDetail: vi.fn(),
  runOperationsMaintenance: vi.fn(),
  updateWorkflow: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/workflows", () => ({
  getWorkflowDetail: mocks.getWorkflowDetail,
  updateWorkflow: mocks.updateWorkflow,
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

import { GET, PATCH } from "@/app/api/workflows/[workflowId]/route";

describe("/api/workflows/[workflowId] route", () => {
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
    mocks.updateWorkflow.mockResolvedValue({ workflow: { id: "wf-1" } });
  });

  it("returns 404 when workflow detail is missing", async () => {
    mocks.getWorkflowDetail.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/workflows/wf-1"), context);

    expect(response.status).toBe(404);
  });

  it("returns 429 on GET when rate-limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await GET(new Request("http://localhost/api/workflows/wf-1"), context);

    expect(response.status).toBe(429);
  });

  it("returns 400 on PATCH when no changes are provided", async () => {
    const response = await PATCH(createJsonRequest("http://localhost/api/workflows/wf-1", {}), context);

    expect(response.status).toBe(400);
    expect(mocks.updateWorkflow).not.toHaveBeenCalled();
  });

  it("updates workflow on valid PATCH payload", async () => {
    const response = await PATCH(
      createJsonRequest("http://localhost/api/workflows/wf-1", {
        description: "Updated",
        status: "active",
      }),
      context,
    );
    const body = await readJson<{ workflow: { workflow: { id: string } } }>(response);

    expect(response.status).toBe(200);
    expect(body.workflow.workflow.id).toBe("wf-1");
    expect(mocks.updateWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          description: "Updated",
          status: "active",
        }),
      }),
    );
  });
});
