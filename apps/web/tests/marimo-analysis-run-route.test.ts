import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBudgetDecision,
  createJsonRequest,
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => {
  class MockMarimoValidationError extends Error {}

  class MockSandboxAdmissionError extends Error {
    sandboxRunId: string;

    constructor(message: string, sandboxRunId: string) {
      super(message);
      this.sandboxRunId = sandboxRunId;
    }
  }

  class MockSandboxExecutionError extends Error {
    exitCode: number;
    sandboxRunId: string;
    status: "failed" | "timed_out";
    stderr: string;
    stdout: string;

    constructor(
      message: string,
      options: {
        exitCode: number;
        sandboxRunId: string;
        status: "failed" | "timed_out";
        stderr: string;
        stdout: string;
      },
    ) {
      super(message);
      this.exitCode = options.exitCode;
      this.sandboxRunId = options.sandboxRunId;
      this.status = options.status;
      this.stderr = options.stderr;
      this.stdout = options.stdout;
    }
  }

  class MockSandboxValidationError extends Error {
    sandboxRunId: string | null;

    constructor(message: string, sandboxRunId: string | null = null) {
      super(message);
      this.sandboxRunId = sandboxRunId;
    }
  }

  class MockSandboxUnavailableError extends Error {
    sandboxRunId: string | null;

    constructor(message: string, sandboxRunId: string | null = null) {
      super(message);
      this.sandboxRunId = sandboxRunId;
    }
  }

  return {
    MarimoValidationError: MockMarimoValidationError,
    SandboxAdmissionError: MockSandboxAdmissionError,
    SandboxExecutionError: MockSandboxExecutionError,
    SandboxUnavailableError: MockSandboxUnavailableError,
    SandboxValidationError: MockSandboxValidationError,
    beginObservedRequest: vi.fn(() => ({ requestId: "obs-1" })),
    createAnalysisNotebookRevision: vi.fn(),
    ensureAnalysisWorkspace: vi.fn(),
    enforceBudgetPolicy: vi.fn(),
    enforceRateLimitPolicy: vi.fn(),
    ensureAnalysisPreviewSession: vi.fn(),
    executeSandboxedCommand: vi.fn(),
    finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
    getSessionUser: vi.fn(),
    getUserConversation: vi.fn(),
    preflightValidateMarimoNotebookSource: vi.fn(),
    runOperationsMaintenance: vi.fn(),
    updateAnalysisNotebookRevision: vi.fn(),
    updateAnalysisWorkspaceState: vi.fn(),
  };
});

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/conversations", () => ({
  getUserConversation: mocks.getUserConversation,
}));

vi.mock("@/lib/marimo-validation", () => ({
  MarimoValidationError: mocks.MarimoValidationError,
  preflightValidateMarimoNotebookSource: mocks.preflightValidateMarimoNotebookSource,
}));

vi.mock("@/lib/marimo-workspaces", () => ({
  createAnalysisNotebookRevision: mocks.createAnalysisNotebookRevision,
  ensureAnalysisWorkspace: mocks.ensureAnalysisWorkspace,
  updateAnalysisNotebookRevision: mocks.updateAnalysisNotebookRevision,
  updateAnalysisWorkspaceState: mocks.updateAnalysisWorkspaceState,
}));

vi.mock("@/lib/marimo-preview", () => ({
  ensureAnalysisPreviewSession: mocks.ensureAnalysisPreviewSession,
}));

vi.mock("@/lib/python-sandbox", async () => {
  const actual = await vi.importActual<typeof import("@/lib/python-sandbox")>("@/lib/python-sandbox");

  return {
    ...actual,
    SandboxAdmissionError: mocks.SandboxAdmissionError,
    SandboxExecutionError: mocks.SandboxExecutionError,
    SandboxUnavailableError: mocks.SandboxUnavailableError,
    SandboxValidationError: mocks.SandboxValidationError,
    executeSandboxedCommand: mocks.executeSandboxedCommand,
  };
});

vi.mock("@/lib/operations", async () => {
  const { NextResponse } = await import("next/server");

  return {
    beginObservedRequest: mocks.beginObservedRequest,
    buildBudgetExceededResponse: (decision: { errorCode: string }) =>
      NextResponse.json({ error: decision.errorCode }, { status: 429 }),
    buildObservedErrorResponse: (
      message: string,
      status: number,
      details?: Record<string, unknown>,
    ) => NextResponse.json({ error: message, ...details }, { status }),
    buildRateLimitedResponse: (decision: { errorCode: string }) =>
      NextResponse.json({ error: decision.errorCode }, { status: 429 }),
    enforceBudgetPolicy: mocks.enforceBudgetPolicy,
    enforceRateLimitPolicy: mocks.enforceRateLimitPolicy,
    finalizeObservedRequest: mocks.finalizeObservedRequest,
    runOperationsMaintenance: mocks.runOperationsMaintenance,
  };
});

import { POST } from "@/app/api/analysis/workspaces/[conversationId]/run/route";

describe("POST /api/analysis/workspaces/[conversationId]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.getUserConversation.mockResolvedValue({ id: "conv-1", title: "Quarterly analysis" });
    mocks.enforceBudgetPolicy.mockResolvedValue(null);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.preflightValidateMarimoNotebookSource.mockResolvedValue(undefined);
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.ensureAnalysisPreviewSession.mockResolvedValue({
      proxyUrl: "/api/analysis/workspaces/conv-1/preview/proxy/?token=preview-token",
    });
    mocks.ensureAnalysisWorkspace.mockResolvedValue({ id: "workspace-1" });
    mocks.createAnalysisNotebookRevision.mockResolvedValue({
      id: "revision-1",
      notebookPath: "analysis_workspaces/workspace-1/revisions/1/notebook.py",
    });
    mocks.updateAnalysisNotebookRevision.mockResolvedValue(undefined);
    mocks.updateAnalysisWorkspaceState.mockResolvedValue(undefined);
    mocks.executeSandboxedCommand.mockResolvedValue({
      exitCode: 0,
      generatedAssets: [
        {
          byteSize: 2048,
          downloadUrl: "/api/generated-files/run-1/outputs/notebook.html",
          expiresAt: 123,
          fileName: "notebook.html",
          mimeType: "text/html",
          relativePath: "outputs/notebook.html",
          runId: "run-1",
        },
        {
          byteSize: 512,
          downloadUrl: "/api/generated-files/run-1/outputs/result.csv",
          expiresAt: 123,
          fileName: "result.csv",
          mimeType: "text/csv",
          relativePath: "outputs/result.csv",
          runId: "run-1",
        },
      ],
      limits: {
        artifactMaxBytes: 1024,
        artifactTtlMs: 3_600_000,
        cpuLimitSeconds: 10,
        maxProcesses: 16,
        memoryLimitBytes: 512_000_000,
        stdoutMaxBytes: 1024,
        timeoutMs: 10_000,
      },
      runner: "python",
      sandboxRunId: "run-1",
      stagedFiles: [{ sourcePath: "admin/contractors_2026.csv", stagedPath: "inputs/admin/contractors_2026.csv" }],
      status: "completed",
      stderr: "",
      stdout: "Exported outputs/notebook.html",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "import marimo",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when the conversation is not accessible", async () => {
    mocks.getUserConversation.mockResolvedValue(null);

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "import marimo",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 429 when blocked by budget policy", async () => {
    mocks.enforceBudgetPolicy.mockResolvedValue(createBudgetDecision());

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "import marimo",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(429);
  });

  it("returns 400 for invalid notebook input", async () => {
    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "notebookSource must be a non-empty string.",
    });
  });

  it("returns 400 for marimo preflight validation failures", async () => {
    mocks.preflightValidateMarimoNotebookSource.mockRejectedValue(
      new mocks.MarimoValidationError("Notebook must import marimo."),
    );

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "print('bad')",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Notebook must import marimo.",
    });
  });

  it("runs marimo analysis and persists workspace state", async () => {
    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        inputFiles: ["admin/contractors_2026.csv"],
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    return (pl,)",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
        title: "Quarterly analysis",
        turnId: "turn-1",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      htmlExportAsset: {
        downloadUrl: "/api/generated-files/run-1/outputs/notebook.html",
        path: "outputs/notebook.html",
      },
      notebookAsset: {
        downloadUrl: null,
        path: "analysis_workspaces/workspace-1/revisions/1/notebook.py",
      },
      previewUrl: "/api/analysis/workspaces/conv-1/preview/proxy/?token=preview-token",
      revisionId: "revision-1",
      sandboxRunId: "run-1",
      status: "completed",
      structuredResultAsset: {
        downloadUrl: "/api/generated-files/run-1/outputs/result.csv",
        mimeType: "text/csv",
        path: "outputs/result.csv",
      },
      workspaceId: "workspace-1",
    });

    expect(mocks.ensureAnalysisWorkspace).toHaveBeenCalledWith({
      conversationId: "conv-1",
      organizationId: "org-1",
      title: "Quarterly analysis",
      userId: "user-1",
    });
    expect(mocks.createAnalysisNotebookRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "running",
        turnId: "turn-1",
        workspaceId: "workspace-1",
      }),
    );
    expect(mocks.executeSandboxedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        inputFiles: ["admin/contractors_2026.csv"],
        toolName: "run_marimo_analysis",
      }),
    );
    expect(mocks.updateAnalysisNotebookRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlExportPath: "outputs/notebook.html",
        revisionId: "revision-1",
        sandboxRunId: "run-1",
        status: "completed",
        structuredResultPath: "outputs/result.csv",
      }),
    );
  });

  it("returns sandbox execution failures as 500", async () => {
    mocks.executeSandboxedCommand.mockRejectedValue(
      new mocks.SandboxExecutionError("Execution failed.", {
        exitCode: 1,
        sandboxRunId: "run-2",
        status: "failed",
        stderr: "Traceback",
        stdout: "",
      }),
    );

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: [
          "import marimo",
          'app = marimo.App(width="medium")',
          "",
          "@app.cell",
          "def _():",
          "    import polars as pl",
          "    return (pl,)",
          "",
          'if __name__ == "__main__":',
          "    app.run()",
        ].join("\n"),
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(500);
    await expect(readJson<{ error: string; sandboxRunId: string }>(response)).resolves.toMatchObject({
      error: "Execution failed.",
      sandboxRunId: "run-2",
    });
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await POST(
      createJsonRequest("http://localhost/api/analysis/workspaces/conv-1/run", {
        notebookSource: "import marimo",
      }),
      { params: Promise.resolve({ conversationId: "conv-1" }) },
    );

    expect(response.status).toBe(429);
  });
});
