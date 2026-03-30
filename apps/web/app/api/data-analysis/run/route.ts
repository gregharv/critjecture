import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  AnalysisResultValidationError,
  buildCsvSchemas,
  parseChartAnalysisStdout,
  storeAnalysisResult,
} from "@/lib/analysis-results";
import {
  SandboxAdmissionError,
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxUnavailableError,
  SandboxValidationError,
} from "@/lib/python-sandbox";
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
  buildSandboxSummary,
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
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "sandbox",
    routeKey: "data-analysis.run",
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

  const budgetDecision = await enforceBudgetPolicy({
    routeGroup: "sandbox",
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

  let body: SandboxRequestBody;

  try {
    body = (await request.json()) as SandboxRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const parsedRequest = parseSandboxRequest(body);

  if ("error" in parsedRequest) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_sandbox_request",
      outcome: "error",
      response: buildObservedErrorResponse(parsedRequest.error, 400),
    });
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
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
    });
    const chartPayload =
      parsedRequest.turnId && csvSchemas.length > 0
        ? parseChartAnalysisStdout(result.stdout)
        : null;
    const analysisResult =
      chartPayload && parsedRequest.turnId
        ? await storeAnalysisResult({
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

    const response = NextResponse.json({
      analysisResultId: analysisResult?.id,
      chartReady: Boolean(analysisResult),
      csvSchemas,
      ...result,
      summary: summaryLines.join("\n"),
    });
    return finalizeObservedRequest(observed, {
      metadata: {
        chartReady: Boolean(analysisResult),
        csvSchemaCount: csvSchemas.length,
        stagedFileCount: result.stagedFiles.length,
      },
      outcome: "ok",
      response,
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
      sandboxRunId: result.sandboxRunId,
      toolName: "run_data_analysis",
      turnId: parsedRequest.turnId ?? null,
      usageEvents: [
        {
          durationMs: result.limits.timeoutMs,
          eventType: "sandbox_run",
          metadata: {
            sandboxStatus: result.status,
            stagedFileCount: result.stagedFiles.length,
          },
          quantity: 1,
          status: result.status,
          subjectName: "run_data_analysis",
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
        toolName: "run_data_analysis",
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
        toolName: "run_data_analysis",
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
                  subjectName: "run_data_analysis",
                },
              ]
            : [],
      });
    }

    if (caughtError instanceof AnalysisResultValidationError) {
      return finalizeObservedRequest(observed, {
        errorCode: caughtError.code,
        metadata: {
          status: "failed",
        },
        outcome: "error",
        response: buildObservedErrorResponse(caughtError.message, 400, {
          status: "failed",
        }),
        runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
        toolName: "run_data_analysis",
        turnId: parsedRequest.turnId ?? null,
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
        toolName: "run_data_analysis",
        turnId: parsedRequest.turnId ?? null,
        usageEvents: [
          {
            eventType: "sandbox_run",
            metadata: {
              sandboxStatus: caughtError.status,
            },
            quantity: 1,
            status: caughtError.status,
            subjectName: "run_data_analysis",
          },
        ],
      });
    }

    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Sandbox execution failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "sandbox_route_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
      runtimeToolCallId: parsedRequest.runtimeToolCallId ?? null,
      turnId: parsedRequest.turnId ?? null,
    });
  }
}
