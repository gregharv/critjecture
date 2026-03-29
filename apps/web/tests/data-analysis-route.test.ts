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
    buildCsvSchemas: vi.fn(),
    enforceBudgetPolicy: vi.fn(),
    enforceRateLimitPolicy: vi.fn(),
    executeSandboxedCommand: vi.fn(),
    finalizeObservedRequest: vi.fn((_, payload: { response: Response }) => payload.response),
    getSessionUser: vi.fn(),
    parseChartAnalysisStdout: vi.fn(),
    runOperationsMaintenance: vi.fn(),
    storeAnalysisResult: vi.fn(),
  };
});

vi.mock("@/lib/auth-state", () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock("@/lib/analysis-results", () => ({
  buildCsvSchemas: mocks.buildCsvSchemas,
  parseChartAnalysisStdout: mocks.parseChartAnalysisStdout,
  storeAnalysisResult: mocks.storeAnalysisResult,
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

import { POST } from "@/app/api/data-analysis/run/route";

describe("POST /api/data-analysis/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(createSessionUser());
    mocks.enforceBudgetPolicy.mockResolvedValue(null);
    mocks.enforceRateLimitPolicy.mockResolvedValue(null);
    mocks.runOperationsMaintenance.mockResolvedValue(undefined);
    mocks.buildCsvSchemas.mockResolvedValue([]);
    mocks.parseChartAnalysisStdout.mockReturnValue(null);
    mocks.storeAnalysisResult.mockReturnValue(null);
    mocks.executeSandboxedCommand.mockResolvedValue({
      exitCode: 0,
      generatedAssets: [],
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
      stdout: "{\"chart\":{\"type\":\"bar\",\"x\":[\"Acme\"],\"y\":[1200]}}",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
    }));

    expect(response.status).toBe(401);
  });

  it("returns 429 when blocked by budget policy", async () => {
    mocks.enforceBudgetPolicy.mockResolvedValue(createBudgetDecision());

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
    }));

    expect(response.status).toBe(429);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "budget_exceeded",
    });
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimitPolicy.mockResolvedValue(createRateLimitDecision());

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
    }));

    expect(response.status).toBe(429);
  });

  it("returns 400 for invalid request bodies", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      inputFiles: [],
    }));

    expect(response.status).toBe(400);
    await expect(readJson<{ error: string }>(response)).resolves.toEqual({
      error: "Sandbox code must be a non-empty string.",
    });
  });

  it("returns sandbox validation failures as 400", async () => {
    mocks.executeSandboxedCommand.mockRejectedValue(
      new mocks.SandboxValidationError("Unknown CSV column.", "run-2"),
    );

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
      inputFiles: ["admin/contractors_2026.csv"],
    }));
    const body = await readJson<{ error: string; sandboxRunId?: string; status?: string }>(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "Unknown CSV column.",
      sandboxRunId: "run-2",
      status: "failed",
    });
  });

  it("returns sandbox unavailable failures as 503", async () => {
    mocks.executeSandboxedCommand.mockRejectedValue(
      new mocks.SandboxUnavailableError("Sandbox backend is unavailable.", "run-unavailable"),
    );

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
    }));
    const body = await readJson<{ error: string; sandboxRunId?: string; status?: string }>(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "Sandbox backend is unavailable.",
      sandboxRunId: "run-unavailable",
      status: "rejected",
    });
  });

  it("returns sandbox execution failures as 500", async () => {
    mocks.executeSandboxedCommand.mockRejectedValue(
      new mocks.SandboxExecutionError("Sandbox failed.", {
        exitCode: 1,
        sandboxRunId: "run-3",
        status: "failed",
        stderr: "traceback",
        stdout: "",
      }),
    );

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
    }));
    const body = await readJson<{ error: string; sandboxRunId?: string }>(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe("traceback");
    expect(body.sandboxRunId).toBe("run-3");
  });

  it("returns successful analysis payloads with csv schemas and analysisResultId", async () => {
    mocks.buildCsvSchemas.mockResolvedValue([
      {
        columns: ["ledger_year", "contractor", "payout"],
        file: "admin/contractors_2026.csv",
      },
    ]);
    mocks.parseChartAnalysisStdout.mockReturnValue({
      chartType: "bar",
      title: "Contractor payouts",
      x: ["Acme"],
      xLabel: "Contractor",
      y: [1200],
      yLabel: "Payout",
    });
    mocks.storeAnalysisResult.mockReturnValue({ id: "analysis-1" });

    const response = await POST(createJsonRequest("http://localhost/api/data-analysis/run", {
      code: "print('ok')",
      inputFiles: ["admin/contractors_2026.csv"],
      turnId: "turn-1",
    }));
    const body = await readJson<{
      analysisResultId?: string;
      chartReady: boolean;
      csvSchemas: Array<{ columns: string[]; file: string }>;
      summary: string;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.chartReady).toBe(true);
    expect(body.analysisResultId).toBe("analysis-1");
    expect(body.csvSchemas).toEqual([
      {
        columns: ["ledger_year", "contractor", "payout"],
        file: "admin/contractors_2026.csv",
      },
    ]);
    expect(body.summary).toContain("analysisResultId analysis-1");
  });
});
