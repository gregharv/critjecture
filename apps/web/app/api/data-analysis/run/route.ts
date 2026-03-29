import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  buildCsvSchemas,
  parseChartAnalysisStdout,
  storeAnalysisResult,
} from "@/lib/analysis-results";
import {
  SandboxAdmissionError,
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
} from "@/lib/python-sandbox";
import {
  buildSandboxSummary,
  jsonError,
  parseSandboxRequest,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

function buildSchemaSummary(csvSchemas: { columns: string[]; file: string }[]) {
  if (csvSchemas.length === 0) {
    return null;
  }

  return csvSchemas.map((schema) => `${schema.file}: ${schema.columns.join(", ")}`).join(" | ");
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: SandboxRequestBody;

  try {
    body = (await request.json()) as SandboxRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsedRequest = parseSandboxRequest(body);

  if ("error" in parsedRequest) {
    return jsonError(parsedRequest.error, 400);
  }

  try {
    const result = await executeSandboxedCommand({
      code: parsedRequest.code,
      inputFiles: parsedRequest.inputFiles,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? undefined,
      toolName: "run_data_analysis",
      turnId: parsedRequest.turnId ?? undefined,
      userId: user.id,
    });
    const csvSchemas = await buildCsvSchemas({
      inputFiles: parsedRequest.inputFiles,
      organizationSlug: user.organizationSlug,
      role: user.role,
    });
    const chartPayload =
      parsedRequest.turnId && csvSchemas.length > 0
        ? parseChartAnalysisStdout(result.stdout)
        : null;
    const analysisResult =
      chartPayload && parsedRequest.turnId
        ? storeAnalysisResult({
            chart: chartPayload,
            csvSchemas,
            inputFiles: parsedRequest.inputFiles,
            organizationId: user.organizationId,
            turnId: parsedRequest.turnId,
            userId: user.id,
          })
        : null;
    const summaryLines = [buildSandboxSummary(result.stdout, result.stderr)];
    const schemaSummary = buildSchemaSummary(csvSchemas);

    if (schemaSummary) {
      summaryLines.push(`CSV schemas: ${schemaSummary}.`);
    }

    if (analysisResult) {
      summaryLines.push(
        `Recorded chart-ready analysis as analysisResultId ${analysisResult.id}. Use generate_visual_graph with this analysisResultId instead of rescanning CSV files.`,
      );
    }

    return NextResponse.json({
      analysisResultId: analysisResult?.id,
      chartReady: Boolean(analysisResult),
      csvSchemas,
      ...result,
      summary: summaryLines.join("\n"),
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
        : "Sandbox execution failed.";

    return jsonError(message, 500);
  }
}
