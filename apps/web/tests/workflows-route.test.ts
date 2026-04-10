import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createJsonRequest,
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-route" })),
  createWorkflow: vi.fn(),
  enforceRateLimitPolicy: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getSessionUser: vi.fn(),
  listWorkflowsForOrganization: vi.fn(),
  runOperationsMaintenance: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/workflows", () => ({
  createWorkflow: mocks.createWorkflow,
  listWorkflowsForOrganization: mocks.listWorkflowsForOrganization,
}));

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildObservedErrorResponse: (
      message: string,
      status: number,
      details?: Record<string, unknown>,
    ) => NextResponse.json({ error: message, ...details }, { status }),
    buildRateLimitedResponse: (decision: { errorCode: string }) =>
      NextResponse.json({ error: decision.errorCode }, { status: 429 }),
    enforceRateLimitPolicy: mocks.enforceRateLimitPolicy,
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { GET, POST } from "@/app/api/workflows/route";

describe("/api/workflows route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "owner" }));
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.listWorkflowsForOrganization.mockResolvedValue({ workflows: [] });
    mocks.createWorkflow.mockResolvedValue({
      currentVersion: null,
      versions: [],
      workflow: {
        id: "wf-1",
      },
    });
  });

  it("returns 401 on GET when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns workflow list on GET", async () => {
    const response = await GET();
    const body = await readJson<{ workflows: unknown[] }>(response);

    expect(response.status).toBe(200);
    expect(body.workflows).toEqual([]);
    expect(mocks.listWorkflowsForOrganization).toHaveBeenCalled();
  });

  it("returns 429 on GET when rate-limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await GET();

    expect(response.status).toBe(429);
  });

  it("returns 403 on POST for non-manager roles", async () => {
    mocks.getSessionUser.mockResolvedValue(createSessionUser({ role: "member" }));

    const response = await POST(
      createJsonRequest("http://localhost/api/workflows", {
        name: "Test Workflow",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("returns 400 on POST for invalid status", async () => {
    const response = await POST(
      createJsonRequest("http://localhost/api/workflows", {
        name: "Test Workflow",
        status: "invalid",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createWorkflow).not.toHaveBeenCalled();
  });

  it("creates workflow on valid POST", async () => {
    const response = await POST(
      createJsonRequest("http://localhost/api/workflows", {
        description: "desc",
        name: "Test Workflow",
        status: "draft",
        visibility: "organization",
      }),
    );
    const body = await readJson<{ workflow: { workflow: { id: string } } }>(response);

    expect(response.status).toBe(201);
    expect(body.workflow.workflow.id).toBe("wf-1");
    expect(mocks.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Test Workflow",
        status: "draft",
        visibility: "organization",
      }),
    );
  });
});
