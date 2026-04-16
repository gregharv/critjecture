import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRateLimitDecision, createSessionUser } from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => ({
  beginObservedRequest: vi.fn(() => ({ requestId: "obs-workflow-export-route" })),
  enforceRateLimitPolicy: vi.fn(),
  exportWorkflowZip: vi.fn(),
  finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
  getSessionUser: vi.fn(),
  runOperationsMaintenance: vi.fn(),
}));

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/workflow-export", () => ({
  WorkflowExportError: class WorkflowExportError extends Error {
    readonly code: string;

    constructor(message: string, code = "workflow_export_error") {
      super(message);
      this.code = code;
      this.name = "WorkflowExportError";
    }
  },
  exportWorkflowZip: mocks.exportWorkflowZip,
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

import { GET } from "@/app/api/workflows/[workflowId]/export/route";

describe("/api/workflows/[workflowId]/export route", () => {
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
    mocks.exportWorkflowZip.mockResolvedValue({
      archiveFileName: "workflow-v1.zip",
      buffer: Buffer.from("zip-data", "utf8"),
    });
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await GET(new Request("http://localhost/api/workflows/wf-1/export"), context);

    expect(response.status).toBe(429);
  });

  it("returns a zip download for authorized users", async () => {
    const response = await GET(new Request("http://localhost/api/workflows/wf-1/export"), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="workflow-v1.zip"',
    );
    expect(mocks.exportWorkflowZip).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-1",
      }),
    );
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("zip-data");
  });
});
