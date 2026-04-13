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

  it("runs direct plotting code against staged CSV input files", async () => {
    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      code: "import polars as pl\nprint('ok')",
      inputFiles: ["admin/contractors_2026.csv"],
      turnId: "turn-1",
    }));
    const body = await readJson<{ generatedAsset: { relativePath: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.generatedAsset.relativePath).toBe("outputs/chart.png");
    expect(mocks.executeSandboxedCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        code: expect.stringContaining('matplotlib.use("Agg")'),
        inputFiles: ["admin/contractors_2026.csv"],
        inlineWorkspaceFiles: [],
        toolName: "generate_visual_graph",
      }),
    );
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
    const sandboxCall = mocks.executeSandboxedCommand.mock.calls[0]?.[0];

    expect(sandboxCall).toEqual(
      expect.objectContaining({
        code: expect.stringContaining('Path("chart_payload.json").read_text'),
        inputFiles: [],
        toolName: "generate_visual_graph",
      }),
    );
    expect(sandboxCall?.inlineWorkspaceFiles).toEqual([
      {
        content: JSON.stringify({
          chartType: "line",
          title: "Updated title",
          xLabel: "Contractor",
          yLabel: "Payout",
          x: ["Acme"],
          y: [1200],
        }),
        relativePath: "chart_payload.json",
      },
    ]);
  });

  it("renders a stored multi-series chart from an inline workspace payload file", async () => {
    mocks.getStoredAnalysisResult.mockResolvedValue({
      chart: {
        chartType: "line",
        title: "Weekly volume by queue",
        xLabel: "Datetime",
        yLabel: "Volume",
        series: [
          {
            name: "Queue A",
            x: ["2026-04-06 07:00", "2026-04-06 07:15"],
            y: [10, 12],
          },
          {
            name: "Queue B",
            x: ["2026-04-06 07:00", "2026-04-06 07:15"],
            y: [7, 9],
          },
        ],
      },
      id: "analysis-1",
    });

    const response = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-1",
      turnId: "turn-1",
    }));
    const body = await readJson<{ generatedAsset: { relativePath: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.generatedAsset.relativePath).toBe("outputs/chart.png");
    const sandboxCall = mocks.executeSandboxedCommand.mock.calls[0]?.[0];

    expect(sandboxCall).toEqual(
      expect.objectContaining({
        code: expect.stringContaining('if "series" in payload:'),
        inputFiles: [],
        toolName: "generate_visual_graph",
      }),
    );
    expect(sandboxCall?.inlineWorkspaceFiles).toEqual([
      {
        content: JSON.stringify({
          chartType: "line",
          title: "Weekly volume by queue",
          xLabel: "Datetime",
          yLabel: "Volume",
          series: [
            {
              name: "Queue A",
              x: ["2026-04-06 07:00", "2026-04-06 07:15"],
              y: [10, 12],
            },
            {
              name: "Queue B",
              x: ["2026-04-06 07:00", "2026-04-06 07:15"],
              y: [7, 9],
            },
          ],
        }),
        relativePath: "chart_payload.json",
      },
    ]);
  });

  it("keeps a follow-up contractor spend chart grounded in the 2026 file instead of reusing stale 2025 chart data", async () => {
    const firstPrompt = "can you chart our spend for the contractors in 2025";
    const followUpPrompt = "can you chart spend for 2026 next to it in a different color";
    const initialChartCode = [
      "import polars as pl",
      "import matplotlib.pyplot as plt",
      'frame = pl.scan_csv("inputs/admin/contractors.csv", encoding="utf8-lossy").collect()',
      'plt.figure(figsize=(8, 5))',
      'plt.bar(frame["contractor_name"].to_list(), frame["payout"].to_list(), color="#4C78A8")',
      'plt.xticks(rotation=45, ha="right")',
      'plt.tight_layout()',
      'plt.savefig("outputs/chart.png", dpi=200)',
      `print(${JSON.stringify(firstPrompt)})`,
    ].join("\n");

    const initialResponse = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      code: initialChartCode,
      inputFiles: ["admin/contractors.csv"],
      turnId: "turn-1",
    }));
    const initialBody = await readJson<{ generatedAsset: { relativePath: string } }>(initialResponse);

    expect(initialResponse.status).toBe(200);
    expect(initialBody.generatedAsset.relativePath).toBe("outputs/chart.png");

    mocks.getStoredAnalysisResult.mockResolvedValue({
      chart: {
        chartType: "bar",
        title: "Contractor spend in 2025",
        x: [
          "Ace Plumbing",
          "Northside Electric",
          "Sunrise Landscaping",
          "ProClean Services",
        ],
        xLabel: "Contractor",
        y: [980, 1325, 1840, 1110],
        yLabel: "Spend",
      },
      id: "analysis-2025",
    });

    const followUpChartCode = [
      "import polars as pl",
      "import matplotlib.pyplot as plt",
      "from pathlib import Path",
      'frame_2025 = pl.scan_csv("inputs/admin/contractors.csv", encoding="utf8-lossy").collect()',
      'frame_2026 = pl.scan_csv("inputs/admin/contractors_new.csv", encoding="utf8-lossy").collect()',
      'labels = frame_2025["contractor_name"].to_list()',
      'values_2025 = frame_2025["payout"].to_list()',
      'values_2026 = frame_2026["payout"].to_list()',
      'positions = list(range(len(labels)))',
      'width = 0.35',
      'plt.figure(figsize=(10, 6))',
      'plt.bar([position - width / 2 for position in positions], values_2025, width=width, color="#4C78A8", label="2025")',
      'plt.bar([position + width / 2 for position in positions], values_2026, width=width, color="#F58518", label="2026")',
      'plt.xticks(positions, labels, rotation=45, ha="right")',
      'plt.legend()',
      'plt.tight_layout()',
      'plt.savefig("outputs/chart.png", dpi=200)',
      `print(${JSON.stringify(followUpPrompt)})`,
    ].join("\n");

    const followUpResponse = await POST(createJsonRequest("http://localhost/api/visual-graph/run", {
      analysisResultId: "analysis-2025",
      code: followUpChartCode,
      inputFiles: ["admin/contractors.csv", "admin/contractors_new.csv"],
      turnId: "turn-1",
    }));
    const followUpBody = await readJson<{ generatedAsset: { relativePath: string } }>(followUpResponse);

    expect(followUpResponse.status).toBe(200);
    expect(followUpBody.generatedAsset.relativePath).toBe("outputs/chart.png");

    const followUpSandboxCall = mocks.executeSandboxedCommand.mock.calls[1]?.[0];

    expect(followUpSandboxCall).toEqual(
      expect.objectContaining({
        code: expect.stringContaining('pl.scan_csv("inputs/admin/contractors_new.csv", encoding="utf8-lossy")'),
        inputFiles: ["admin/contractors.csv", "admin/contractors_new.csv"],
        inlineWorkspaceFiles: [],
        toolName: "generate_visual_graph",
      }),
    );
    expect(followUpSandboxCall?.code).toContain('label="2026"');
    expect(followUpSandboxCall?.code).toContain('color="#F58518"');
  });
});
