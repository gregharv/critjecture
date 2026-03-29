import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getStoredAnalysisResult, type ChartAnalysisPayload } from "@/lib/analysis-results";
import {
  SandboxAdmissionError,
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import {
  buildGeneratedAssetSummary,
  jsonError,
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

function buildChartCodeFromAnalysis(
  chart: ChartAnalysisPayload,
  overrides: {
    chartType: "bar" | "line" | "scatter" | null;
    title: string | null;
    xLabel: string | null;
    yLabel: string | null;
  },
) {
  const payload = {
    chartType: overrides.chartType ?? chart.chartType,
    title: overrides.title ?? chart.title,
    x: chart.x,
    xLabel: overrides.xLabel ?? chart.xLabel,
    y: chart.y,
    yLabel: overrides.yLabel ?? chart.yLabel,
  };

  return buildVisualGraphCode(`
import json
import matplotlib.pyplot as plt

payload = json.loads(${JSON.stringify(JSON.stringify(payload))})
x_values = payload["x"]
y_values = payload["y"]
positions = list(range(len(x_values)))

plt.figure(figsize=(10, 6))

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
print(f"Created chart.png with {len(x_values)} plotted values.")
`);
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: VisualGraphRequestBody;

  try {
    body = (await request.json()) as VisualGraphRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsedRequest = parseVisualGraphRequest(body);

  if ("error" in parsedRequest) {
    return jsonError(parsedRequest.error, 400);
  }

  if (
    parsedRequest.inputFiles.some((filePath) => filePath.toLowerCase().endsWith(".csv")) &&
    !parsedRequest.analysisResultId
  ) {
    return jsonError(
      "CSV-backed charts must use run_data_analysis first. Produce chart-ready JSON there, then call generate_visual_graph with analysisResultId instead of rescanning CSV files.",
      400,
      {
        status: "failed",
      },
    );
  }

  const storedAnalysisResult =
    parsedRequest.analysisResultId && parsedRequest.turnId
      ? getStoredAnalysisResult({
          analysisResultId: parsedRequest.analysisResultId,
          organizationId: user.organizationId,
          turnId: parsedRequest.turnId,
          userId: user.id,
        })
      : null;

  if (parsedRequest.analysisResultId && !storedAnalysisResult) {
    return jsonError(
      `Unknown analysisResultId "${parsedRequest.analysisResultId}" for this turn. Run run_data_analysis first and use the returned analysisResultId.`,
      400,
      {
        status: "failed",
      },
    );
  }

  try {
    const result = await executeSandboxedCommand({
      code: storedAnalysisResult
        ? buildChartCodeFromAnalysis(storedAnalysisResult.chart, {
            chartType: parsedRequest.chartType,
            title: parsedRequest.title,
            xLabel: parsedRequest.xLabel,
            yLabel: parsedRequest.yLabel,
          })
        : buildVisualGraphCode(parsedRequest.code ?? ""),
      inputFiles: [],
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? undefined,
      toolName: "generate_visual_graph",
      turnId: parsedRequest.turnId ?? undefined,
      userId: user.id,
    });
    const generatedAsset = expectSinglePngAsset(result.generatedAssets);

    return NextResponse.json({
      ...result,
      generatedAsset,
      summary: buildGeneratedAssetSummary(
        result.stdout,
        "chart",
        generatedAsset.relativePath,
      ),
    });
  } catch (caughtError) {
    if (caughtError instanceof SandboxAdmissionError) {
      return jsonError(caughtError.message, 429, {
        sandboxRunId: caughtError.sandboxRunId,
        status: "rejected",
      });
    }

    if (caughtError instanceof SandboxValidationError) {
      return jsonError(caughtError.message, 400, {
        sandboxRunId: caughtError.sandboxRunId ?? undefined,
        status: "failed",
      });
    }

    if (caughtError instanceof SandboxExecutionError) {
      const combinedOutput = [caughtError.stderr.trim(), caughtError.stdout.trim()]
        .filter(Boolean)
        .join("\n");

      return jsonError(
        combinedOutput || caughtError.message,
        500,
        {
          exitCode: caughtError.exitCode,
          sandboxRunId: caughtError.sandboxRunId,
          status: caughtError.status,
          stderr: caughtError.stderr,
          stdout: caughtError.stdout,
        },
      );
    }

    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Graph generation failed.";

    return jsonError(message, 500);
  }
}
