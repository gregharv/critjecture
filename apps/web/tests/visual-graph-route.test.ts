import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBudgetDecision,
  createJsonRequest,
  createRateLimitDecision,
  createSessionUser,
  readJson,
} from "@/tests/helpers/route-test-utils";

const mocks = vi.hoisted(() => {
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
    SandboxAdmissionError: MockSandboxAdmissionError,
    SandboxExecutionError: MockSandboxExecutionError,
    SandboxUnavailableError: MockSandboxUnavailableError,
    SandboxValidationError: MockSandboxValidationError,
    beginObservedRequest: vi.fn(() => ({ requestId: "obs-1" })),
    enforceBudgetPolicy: vi.fn(),
    enforceRateLimitPolicy: vi.fn(),
    executeSandboxedCommand: vi.fn(),
    finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
    getSessionUser: vi.fn(),
    getStoredAnalysisResult: vi.fn(),
    runOperationsMaintenance: vi.fn(),
  };
});

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/analysis-results", () => ({
  getStoredAnalysisResult: mocks.getStoredAnalysisResult,
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

import { POST } from "@/app/api/visual-graph/run/route";

describe("POST /api/visual-graph/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.enforceBudgetPolicy.mockResolvedValue(null);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.getStoredAnalysisResult.mockResolvedValue(null);
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.executeSandboxedCommand.mockResolvedValue({
      exitCode: 0,
      generatedAssets: [
        {
          byteSize: 2048,
          downloadUrl: "/api/generated-files/run-1/outputs/chart.png",
          expiresAt: Date.now() + 3_600_000,
          fileName: "chart.png",
          mimeType: "image/png",
          relativePath: "outputs/chart.png",
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
      stagedFiles: [],
      status: "completed",
      stderr: "",
      stdout: "Created chart.png with 1 plotted values.",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-1",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(401);
  });

  it("returns 429 when blocked by budget policy", async () => {
    mocks.enforceBudgetPolicy.mockResolvedValue(createBudgetDecision());

    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-1",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(429);
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-1",
      turnId: "turn-1",
    }));

    expect(response.status).toBe(429);
  });

  it("returns 400 when a CSV-backed chart skips analysisResultId", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      code: "print('ok')",
      inputFiles: ["admin/contractors_2026.csv"],
      turnId: "turn-1",
    }));
    const body = await readJson<{ error: string }>(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("CSV-backed charts must use run_data_analysis first");
  });

  it("returns 400 when analysisResultId is unknown for the turn", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-missing",
      turnId: "turn-1",
    }));
    const body = await readJson<{ error: string; status?: string }>(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error:
        'Unknown analysisResultId "analysis-missing" for this turn. Run run_data_analysis first and use the returned analysisResultId.',
      status: "failed",
    });
  });

  it("renders a stored chart from an inline workspace payload file", async () => {
    mocks.getStoredAnalysisResult.mockResolvedValue({
      chart: {
        chartType: "bar",
        title: "Original title",
        x: ["Acme"],
        xLabel: "Original X",
        y: [1200],
        yLabel: "Original Y",
      },
      id: "analysis-1",
    });

    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-1",
      chartType: "line",
      title: "Updated title",
      turnId: "turn-1",
      xLabel: "Contractor",
      yLabel: "Payout",
    }));
    const body = await readJson<{ generatedAsset: { relativePath: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.generatedAsset.relativePath).toBe("outputs/chart.png");
    expect(mocks.executeSandboxedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.stringContaining('Path("chart_payload.json").read_text'),
        inlineWorkspaceFiles: [
          {
            content: JSON.stringify({
              chartType: "line",
              title: "Updated title",
              x: ["Acme"],
              xLabel: "Contractor",
              y: [1200],
              yLabel: "Payout",
            }),
            relativePath: "chart_payload.json",
          },
        ],
        inputFiles: [],
        toolName: "generate_visual_graph",
      }),
    );
  });
});
