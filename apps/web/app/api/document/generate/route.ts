import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
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
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import {
  buildGeneratedAssetSummary,
  parseSandboxRequest,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

function expectSinglePdfAsset(generatedAssets: GeneratedSandboxAsset[]) {
  if (
    generatedAssets.length !== 1 ||
    generatedAssets[0]?.mimeType !== "application/pdf"
  ) {
    throw new SandboxValidationError(
      "generate_document must save exactly one PDF file inside outputs/.",
    );
  }

  return generatedAssets[0];
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "sandbox",
    routeKey: "document.generate",
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
      toolName: "generate_document",
      turnId: parsedRequest.turnId ?? undefined,
      userId: user.id,
    });
    const generatedAsset = expectSinglePdfAsset(result.generatedAssets);

    const response = NextResponse.json({
      ...result,
      generatedAsset,
      summary: buildGeneratedAssetSummary(
        result.stdout,
        "document",
        generatedAsset.relativePath,
      ),
    });
    return finalizeObservedRequest(observed, {
      metadata: {
        generatedAssetBytes: generatedAsset.byteSize,
        generatedAssetPath: generatedAsset.relativePath,
      },
      outcome: "ok",
      response,
      sandboxRunId: result.sandboxRunId,
      toolName: "generate_document",
      usageEvents: [
        {
          eventType: "sandbox_run",
          metadata: {
            generatedAssetPath: generatedAsset.relativePath,
            sandboxStatus: result.status,
          },
          quantity: 1,
          status: result.status,
          subjectName: "generate_document",
        },
      ],
    });
  } catch (caughtError) {
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
        sandboxRunId: caughtError.sandboxRunId ?? null,
        toolName: "generate_document",
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
                  subjectName: "generate_document",
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
        sandboxRunId: caughtError.sandboxRunId,
        toolName: "generate_document",
        usageEvents: [
          {
            eventType: "sandbox_run",
            metadata: {
              sandboxStatus: caughtError.status,
            },
            quantity: 1,
            status: caughtError.status,
            subjectName: "generate_document",
          },
        ],
      });
    }

    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Document generation failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "document_generation_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
