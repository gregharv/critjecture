import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getStoredAnalysisResult, type ChartAnalysisPayload } from "@/lib/analysis-results";
import {
  beginObservedRequest,
  buildBudgetExceededResponse,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceBudgetPolicy,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import {
  SandboxAdmissionError,
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxUnavailableError,
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import {
  buildGeneratedAssetSummary,
  parseInputFiles,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

type VisualGraphRequestBody = SandboxRequestBody & {
  analysisResultId?: unknown;
  chartType?: unknown;
  title?: unknown;
  xLabel?: unknown;
  yLabel?: unknown;
};

function buildVisualGraphCode(code: string) {
  return [
    "import matplotlib",
    'matplotlib.use("Agg")',
    code,
  ].join("\n\n");
}

function expectSinglePngAsset(generatedAssets: GeneratedSandboxAsset[]) {
  if (generatedAssets.length !== 1 || generatedAssets[0]?.mimeType !== "image/png") {
    throw new SandboxValidationError(
      "generate_visual_graph must save exactly one PNG file inside outputs/.",
    );
  }

  return generatedAssets[0];
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeChartType(value: unknown) {
  return value === "line" || value === "scatter" ? value : value === "bar" ? "bar" : null;
}

function parseVisualGraphRequest(body: VisualGraphRequestBody):
  | {
      analysisResultId: string | null;
      chartType: "bar" | "line" | "scatter" | null;
      code: string | null;
      inputFiles: string[];
      runtimeToolCallId: string | null;
      title: string | null;
      turnId: string | null;
      xLabel: string | null;
      yLabel: string | null;
    }
  | { error: string } {
  const inputFilesResult = parseInputFiles(body.inputFiles);

  if ("error" in inputFilesResult) {
    return inputFilesResult;
  }

  const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
  const analysisResultId = normalizeOptionalString(body.analysisResultId);

  if (!analysisResultId && !code) {
    return {
      error:
        "generate_visual_graph requires either analysisResultId for chart-ready data or a non-empty code string.",
    };
  }

  return {
    analysisResultId,
    chartType: normalizeChartType(body.chartType),
    code,
    inputFiles: inputFilesResult.inputFiles,
    runtimeToolCallId: normalizeOptionalString(body.runtimeToolCallId),
    title: normalizeOptionalString(body.title),
    turnId: normalizeOptionalString(body.turnId),
    xLabel: normalizeOptionalString(body.xLabel),
    yLabel: normalizeOptionalString(body.yLabel),
  };
}

function buildStoredChartPayload(
  chart: ChartAnalysisPayload,
  overrides: {
    chartType: "bar" | "line" | "scatter" | null;
    title: string | null;
    xLabel: string | null;
    yLabel: string | null;
  },
) {
  return {
    chartType: overrides.chartType ?? chart.chartType,
    title: overrides.title ?? chart.title,
    xLabel: overrides.xLabel ?? chart.xLabel,
    yLabel: overrides.yLabel ?? chart.yLabel,
    ...("series" in chart
      ? {
          series: chart.series,
        }
      : {
          x: chart.x,
          y: chart.y,
        }),
  };
}

function buildStoredChartRenderCode() {
  return buildVisualGraphCode(`
import json
from pathlib import Path
import matplotlib.pyplot as plt

payload = json.loads(Path("chart_payload.json").read_text(encoding="utf-8"))
plt.figure(figsize=(10, 6))
plotted_value_count = 0

if "series" in payload:
    axis_labels = []
    axis_positions = {}

    for series in payload["series"]:
        for value in series["x"]:
            label = str(value)
            if label not in axis_positions:
                axis_positions[label] = len(axis_labels)
                axis_labels.append(label)

    positions = list(range(len(axis_labels)))
    series_count = max(len(payload["series"]), 1)

    if payload["chartType"] == "bar":
        width = min(0.8 / series_count, 0.35)
        offset_origin = ((series_count - 1) / 2) * width

        for index, series in enumerate(payload["series"]):
            series_positions = [axis_positions[str(value)] - offset_origin + index * width for value in series["x"]]
            label = series.get("name") or f"Series {index + 1}"
            plt.bar(series_positions, series["y"], width=width, label=label)
            plotted_value_count += len(series["x"])
    else:
        for index, series in enumerate(payload["series"]):
            series_positions = [axis_positions[str(value)] for value in series["x"]]
            label = series.get("name") or f"Series {index + 1}"
            plotted_value_count += len(series["x"])

            if payload["chartType"] == "scatter":
                plt.scatter(series_positions, series["y"], label=label)
            else:
                plt.plot(series_positions, series["y"], marker="o", label=label)

    plt.xticks(positions, axis_labels, rotation=45, ha="right")
    if len(payload["series"]) > 1:
        plt.legend()
else:
    x_values = payload["x"]
    y_values = payload["y"]
    positions = list(range(len(x_values)))
    plotted_value_count = len(x_values)

    if payload["chartType"] == "line":
        plt.plot(positions, y_values, marker="o", color="#4C78A8")
    elif payload["chartType"] == "scatter":
        plt.scatter(positions, y_values, color="#4C78A8")
    else:
        plt.bar(positions, y_values, color="#4C78A8")

    plt.xticks(positions, [str(value) for value in x_values], rotation=45, ha="right")

if payload.get("title"):
    plt.title(payload["title"])

if payload.get("xLabel"):
    plt.xlabel(payload["xLabel"])

if payload.get("yLabel"):
    plt.ylabel(payload["yLabel"])

plt.tight_layout()
plt.savefig("outputs/chart.png", dpi=200)
print(f"Created chart.png with {plotted_value_count} plotted values.")
`);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const routeKey = "visual-graph.run";
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "sandbox",
    routeKey,
    user,
  });
  await runOperationsMaintenance();

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  if (!user.access.canUseAnswerTools) {
    return finalizeObservedRequest(observed, {
      errorCode: "sandbox_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse(
        "This membership cannot generate charts.",
        403,
      ),
    });
  }

  const budgetDecision = await enforceBudgetPolicy({
    requestId: observed.requestId,
    routeGroup: "sandbox",
    routeKey,
    user,
  });

  if (budgetDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: budgetDecision.errorCode,
      metadata: budgetDecision.metadata,
      outcome: "blocked",
      response: buildBudgetExceededResponse(budgetDecision),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "sandbox",
    user,
  });

  if (rateLimitDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: rateLimitDecision.errorCode,
      metadata: {
        limit: rateLimitDecision.limit,
        scope: rateLimitDecision.scope,
        windowMs: rateLimitDecision.windowMs,
      },
      outcome: "rate_limited",
      response: buildRateLimitedResponse(rateLimitDecision),
    });
  }

  let body: VisualGraphRequestBody;

  try {
    body = (await request.json()) as VisualGraphRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const parsedRequest = parseVisualGraphRequest(body);

  if ("error" in parsedRequest) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_visual_graph_request",
      outcome: "error",
      response: buildObservedErrorResponse(parsedRequest.error, 400),
    });
  }

  const hasFreshPlotRequest =
    parsedRequest.inputFiles.length > 0 || parsedRequest.code !== null;
  const storedAnalysisResult =
    parsedRequest.analysisResultId && parsedRequest.turnId && !hasFreshPlotRequest
      ? await getStoredAnalysisResult({
          analysisResultId: parsedRequest.analysisResultId,
          organizationId: user.organizationId,
          turnId: parsedRequest.turnId,
          userId: user.id,
        })
      : null;

  if (parsedRequest.analysisResultId && !storedAnalysisResult && !hasFreshPlotRequest) {
    return finalizeObservedRequest(observed, {
      errorCode: "unknown_analysis_result",
      outcome: "error",
      response: buildObservedErrorResponse(
        `Unknown analysisResultId "${parsedRequest.analysisResultId}" for this turn. Run run_data_analysis first and use the returned analysisResultId.`,
        400,
        {
          status: "failed",
        },
      ),
    });
  }

  try {
    const storedChartPayload = storedAnalysisResult
      ? buildStoredChartPayload(storedAnalysisResult.chart, {
          chartType: parsedRequest.chartType,
          title: parsedRequest.title,
          xLabel: parsedRequest.xLabel,
          yLabel: parsedRequest.yLabel,
        })
      : null;
    const result = await executeSandboxedCommand({
      code: storedChartPayload
        ? buildStoredChartRenderCode()
        : buildVisualGraphCode(parsedRequest.code ?? ""),
      inputFiles: storedChartPayload ? [] : parsedRequest.inputFiles,
      inlineWorkspaceFiles: storedChartPayload
        ? [
            {
              content: JSON.stringify(storedChartPayload),
              relativePath: "chart_payload.json",
            },
          ]
        : [],
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? undefined,
      toolName: "generate_visual_graph",
      turnId: parsedRequest.turnId ?? undefined,
      userId: user.id,
    });
    const generatedAsset = expectSinglePngAsset(result.generatedAssets);

    const response = NextResponse.json({
      ...result,
      generatedAsset,
      summary: buildGeneratedAssetSummary(
        result.stdout,
        "chart",
        generatedAsset.relativePath,
      ),
    });
    return finalizeObservedRequest(observed, {
      metadata: {
        generatedAssetBytes: generatedAsset.byteSize,
        generatedAssetPath: generatedAsset.relativePath,
        usedStoredAnalysisResult: Boolean(storedAnalysisResult),
      },
      outcome: "ok",
      response,
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
      sandboxRunId: result.sandboxRunId,
      toolName: "generate_visual_graph",
      turnId: parsedRequest.turnId ?? null,
      usageEvents: [
        {
          eventType: "sandbox_run",
          metadata: {
            generatedAssetPath: generatedAsset.relativePath,
            sandboxStatus: result.status,
            usedStoredAnalysisResult: Boolean(storedAnalysisResult),
          },
          quantity: 1,
          status: result.status,
          subjectName: "generate_visual_graph",
        },
      ],
    });
  } catch (caughtError) {
    if (caughtError instanceof SandboxUnavailableError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_unavailable",
        metadata: {
          sandboxRunId: caughtError.sandboxRunId ?? null,
          status: "rejected",
        },
        outcome: "error",
        response: buildObservedErrorResponse(caughtError.message, 503, {
          sandboxRunId: caughtError.sandboxRunId ?? undefined,
          status: "rejected",
        }),
        runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
        sandboxRunId: caughtError.sandboxRunId ?? null,
        toolName: "generate_visual_graph",
        turnId: parsedRequest.turnId ?? null,
      });
    }

    if (caughtError instanceof SandboxAdmissionError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_admission_rejected",
        metadata: {
          sandboxRunId: caughtError.sandboxRunId,
          status: "rejected",
        },
        outcome: "rate_limited",
        response: buildObservedErrorResponse(caughtError.message, 429, {
          sandboxRunId: caughtError.sandboxRunId,
          status: "rejected",
        }),
        runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
        turnId: parsedRequest.turnId ?? null,
      });
    }

    if (caughtError instanceof SandboxValidationError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_validation_failed",
        metadata: {
          sandboxRunId: caughtError.sandboxRunId ?? null,
          status: "failed",
        },
        outcome: "error",
        response: buildObservedErrorResponse(caughtError.message, 400, {
          sandboxRunId: caughtError.sandboxRunId ?? undefined,
          status: "failed",
        }),
        runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
        sandboxRunId: caughtError.sandboxRunId ?? null,
        toolName: "generate_visual_graph",
        turnId: parsedRequest.turnId ?? null,
        usageEvents:
          caughtError.sandboxRunId
            ? [
                {
                  eventType: "sandbox_run",
                  metadata: {
                    sandboxStatus: "failed",
                  },
                  quantity: 1,
                  status: "failed",
                  subjectName: "generate_visual_graph",
                },
              ]
            : [],
      });
    }

    if (caughtError instanceof SandboxExecutionError) {
      const combinedOutput = [caughtError.stderr.trim(), caughtError.stdout.trim()]
        .filter(Boolean)
        .join("\n");
      return finalizeObservedRequest(observed, {
        errorCode:
          caughtError.status === "timed_out" ? "sandbox_timed_out" : "sandbox_execution_failed",
        metadata: {
          exitCode: caughtError.exitCode,
          status: caughtError.status,
        },
        outcome: "error",
        response: buildObservedErrorResponse(
          combinedOutput || caughtError.message,
          500,
          {
            exitCode: caughtError.exitCode,
            sandboxRunId: caughtError.sandboxRunId,
            status: caughtError.status,
            stderr: caughtError.stderr,
            stdout: caughtError.stdout,
          },
        ),
        runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
        sandboxRunId: caughtError.sandboxRunId,
        toolName: "generate_visual_graph",
        turnId: parsedRequest.turnId ?? null,
        usageEvents: [
          {
            eventType: "sandbox_run",
            metadata: {
              sandboxStatus: caughtError.status,
            },
            quantity: 1,
            status: caughtError.status,
            subjectName: "generate_visual_graph",
          },
        ],
      });
    }

    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Graph generation failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "visual_graph_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
      turnId: parsedRequest.turnId ?? null,
    });
  }
}
