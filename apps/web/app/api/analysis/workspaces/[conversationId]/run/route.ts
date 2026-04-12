import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getUserConversation } from "@/lib/conversations";
import {
  createAnalysisNotebookRevision,
  ensureAnalysisWorkspace,
  updateAnalysisNotebookRevision,
  updateAnalysisWorkspaceState,
} from "@/lib/marimo-workspaces";
import { ensureAnalysisPreviewSession } from "@/lib/marimo-preview";
import { getMarimoHtmlExportPath, getMarimoNotebookFileName, buildMarimoSandboxDriverCode } from "@/lib/marimo-runtime";
import {
  preflightValidateMarimoNotebookSource,
  MarimoValidationError,
} from "@/lib/marimo-validation";
import type { RunMarimoAnalysisRequest, RunMarimoAnalysisResponse } from "@/lib/marimo-types";
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
} from "@/lib/python-sandbox";
import { parseInputFiles, truncateSandboxText } from "@/lib/sandbox-route";

export const runtime = "nodejs";

function normalizeNotebookResultStatus(
  status: Awaited<ReturnType<typeof executeSandboxedCommand>>["status"],
) {
  return status === "abandoned" ? "failed" : status;
}

function buildMarimoSummary(stdout: string, stderr: string) {
  const trimmedStdout = truncateSandboxText(stdout);
  const trimmedStderr = truncateSandboxText(stderr);

  if (trimmedStdout) {
    return `Marimo notebook execution completed successfully.\n${trimmedStdout}`;
  }

  if (trimmedStderr) {
    return `Marimo notebook execution completed successfully with stderr output.\n${trimmedStderr}`;
  }

  return "Marimo notebook execution completed successfully.";
}

function buildResponse(input: {
  conversationId: string;
  htmlExportRelativePath: string | null;
  notebookPath: string;
  previewUrl?: string | null;
  revisionId: string;
  result: Awaited<ReturnType<typeof executeSandboxedCommand>>;
  structuredResultRelativePath: string | null;
  summary: string;
  workspaceId: string;
}): RunMarimoAnalysisResponse {
  const htmlExportAsset = input.result.generatedAssets.find(
    (asset) => asset.relativePath === getMarimoHtmlExportPath(),
  );
  const structuredResultAsset = input.result.generatedAssets.find(
    (asset) => asset.relativePath !== getMarimoHtmlExportPath(),
  );

  return {
    htmlExportAsset:
      htmlExportAsset && input.htmlExportRelativePath
        ? {
            downloadUrl: htmlExportAsset.downloadUrl,
            path: input.htmlExportRelativePath,
          }
        : null,
    notebookAsset: {
      downloadUrl: null,
      path: input.notebookPath,
    },
    previewUrl:
      input.previewUrl ??
      `/api/analysis/workspaces/${encodeURIComponent(input.conversationId)}/preview`,
    revisionId: input.revisionId,
    sandboxRunId: input.result.sandboxRunId,
    stagedFiles: input.result.stagedFiles,
    status: normalizeNotebookResultStatus(input.result.status),
    stderr: truncateSandboxText(input.result.stderr),
    stdout: truncateSandboxText(input.result.stdout),
    structuredResultAsset:
      structuredResultAsset && input.structuredResultRelativePath
        ? {
            downloadUrl: structuredResultAsset.downloadUrl,
            mimeType: structuredResultAsset.mimeType,
            path: input.structuredResultRelativePath,
          }
        : null,
    summary: input.summary,
    workspaceId: input.workspaceId,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const user = await getSessionUser();
  const routeKey = "analysis.workspace.run";
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
        "This membership cannot run analysis tools.",
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

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_conversation_id",
      outcome: "error",
      response: buildObservedErrorResponse("conversationId must be a non-empty string.", 400),
    });
  }

  let body: RunMarimoAnalysisRequest;

  try {
    body = (await request.json()) as RunMarimoAnalysisRequest;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const notebookSource = typeof body.notebookSource === "string" ? body.notebookSource.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const turnId = typeof body.turnId === "string" && body.turnId.trim() ? body.turnId.trim() : null;
  const runtimeToolCallId =
    typeof body.runtimeToolCallId === "string" && body.runtimeToolCallId.trim()
      ? body.runtimeToolCallId.trim()
      : null;
  const inputFilesResult = parseInputFiles(body.inputFiles);

  if (!notebookSource) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_notebook_source",
      outcome: "error",
      response: buildObservedErrorResponse("notebookSource must be a non-empty string.", 400),
    });
  }

  if ("error" in inputFilesResult) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_input_files",
      outcome: "error",
      response: buildObservedErrorResponse(inputFilesResult.error, 400),
    });
  }

  const conversation = await getUserConversation({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    userId: user.id,
    userRole: user.role,
  });

  if (!conversation) {
    return finalizeObservedRequest(observed, {
      errorCode: "conversation_not_found",
      outcome: "error",
      response: buildObservedErrorResponse("Conversation not found.", 404),
    });
  }

  try {
    await preflightValidateMarimoNotebookSource({
      inputFiles: inputFilesResult.inputFiles,
      notebookSource,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
    });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Notebook validation failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "marimo_validation_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 400),
      turnId,
    });
  }

  const workspace = await ensureAnalysisWorkspace({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    title: title || conversation.title,
    userId: user.id,
  });

  const revision = await createAnalysisNotebookRevision({
    notebookSource,
    organizationSlug: user.organizationSlug,
    status: "running",
    turnId,
    workspaceId: workspace.id,
  });

  await updateAnalysisWorkspaceState({
    latestRevisionId: revision.id,
    status: "running",
    title: title || conversation.title,
    workspaceId: workspace.id,
  });

  try {
    const result = await executeSandboxedCommand({
      code: buildMarimoSandboxDriverCode(),
      inlineWorkspaceFiles: [
        {
          content: notebookSource,
          relativePath: getMarimoNotebookFileName(),
        },
      ],
      inputFiles: inputFilesResult.inputFiles,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      role: user.role,
      runtimeToolCallId: runtimeToolCallId ?? undefined,
      toolName: "run_marimo_analysis",
      turnId: turnId ?? undefined,
      userId: user.id,
    });

    const htmlExportAsset = result.generatedAssets.find(
      (asset) => asset.relativePath === getMarimoHtmlExportPath(),
    );
    const structuredResultAsset = result.generatedAssets.find(
      (asset) => asset.relativePath !== getMarimoHtmlExportPath(),
    );
    const summary = buildMarimoSummary(result.stdout, result.stderr);
    const normalizedResultStatus = normalizeNotebookResultStatus(result.status);

    await updateAnalysisNotebookRevision({
      htmlExportPath: htmlExportAsset?.relativePath ?? null,
      revisionId: revision.id,
      sandboxRunId: result.sandboxRunId,
      status: normalizedResultStatus,
      structuredResultPath: structuredResultAsset?.relativePath ?? null,
      summary,
    });
    await updateAnalysisWorkspaceState({
      latestRevisionId: revision.id,
      latestSandboxRunId: result.sandboxRunId,
      status: normalizedResultStatus === "completed" ? "completed" : "failed",
      title: title || conversation.title,
      workspaceId: workspace.id,
    });

    const previewBootstrap = await ensureAnalysisPreviewSession({
      conversationId: normalizedConversationId,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      userId: user.id,
    }).catch(() => null);

    const response = NextResponse.json(
      buildResponse({
        conversationId: normalizedConversationId,
        htmlExportRelativePath: htmlExportAsset?.relativePath ?? null,
        notebookPath: revision.notebookPath,
        previewUrl: previewBootstrap?.proxyUrl ?? null,
        revisionId: revision.id,
        result,
        structuredResultRelativePath: structuredResultAsset?.relativePath ?? null,
        summary,
        workspaceId: workspace.id,
      }),
    );

    return finalizeObservedRequest(observed, {
      metadata: {
        previewSessionId: previewBootstrap?.sessionId ?? null,
        revisionId: revision.id,
        stagedFileCount: result.stagedFiles.length,
        workspaceId: workspace.id,
      },
      outcome: "ok",
      response,
      runtimeToolCallId,
      sandboxRunId: result.sandboxRunId,
      toolName: "run_marimo_analysis",
      turnId,
      usageEvents: [
        {
          durationMs: result.limits.timeoutMs,
          eventType: "analysis_notebook_run",
          metadata: {
            previewSessionId: previewBootstrap?.sessionId ?? null,
            revisionId: revision.id,
            sandboxStatus: result.status,
            stagedFileCount: result.stagedFiles.length,
            workspaceId: workspace.id,
          },
          quantity: 1,
          status: normalizedResultStatus,
          subjectName: "analysis_notebook",
          usageClass: "analysis",
        },
      ],
    });
  } catch (caughtError) {
    const isExecutionFailure = caughtError instanceof SandboxExecutionError;
    const sandboxRunId =
      caughtError instanceof SandboxAdmissionError ||
      caughtError instanceof SandboxExecutionError ||
      caughtError instanceof SandboxUnavailableError ||
      caughtError instanceof SandboxValidationError
        ? caughtError.sandboxRunId ?? null
        : null;
    const status =
      caughtError instanceof SandboxExecutionError
        ? caughtError.status
        : caughtError instanceof SandboxAdmissionError
          ? "rejected"
          : caughtError instanceof SandboxUnavailableError
            ? "rejected"
            : caughtError instanceof SandboxValidationError
              ? "failed"
              : "failed";
    const message =
      caughtError instanceof Error ? caughtError.message : "Marimo notebook execution failed.";

    await updateAnalysisNotebookRevision({
      htmlExportPath: null,
      revisionId: revision.id,
      sandboxRunId,
      status,
      structuredResultPath: null,
      summary: message,
    });
    await updateAnalysisWorkspaceState({
      latestRevisionId: revision.id,
      latestSandboxRunId: sandboxRunId,
      status: "failed",
      title: title || conversation.title,
      workspaceId: workspace.id,
    });

    if (caughtError instanceof SandboxUnavailableError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_unavailable",
        metadata: {
          revisionId: revision.id,
          sandboxRunId,
          status,
          workspaceId: workspace.id,
        },
        outcome: "error",
        response: buildObservedErrorResponse(message, 503, {
          sandboxRunId: sandboxRunId ?? undefined,
          status,
        }),
        runtimeToolCallId,
        sandboxRunId,
        toolName: "run_marimo_analysis",
        turnId,
      });
    }

    if (caughtError instanceof SandboxAdmissionError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_admission_rejected",
        metadata: {
          revisionId: revision.id,
          sandboxRunId,
          status,
          workspaceId: workspace.id,
        },
        outcome: "rate_limited",
        response: buildObservedErrorResponse(message, 429, {
          sandboxRunId: sandboxRunId ?? undefined,
          status,
        }),
        runtimeToolCallId,
        sandboxRunId,
        toolName: "run_marimo_analysis",
        turnId,
      });
    }

    if (caughtError instanceof SandboxValidationError || caughtError instanceof MarimoValidationError) {
      return finalizeObservedRequest(observed, {
        errorCode: "sandbox_validation_failed",
        metadata: {
          revisionId: revision.id,
          sandboxRunId,
          status,
          workspaceId: workspace.id,
        },
        outcome: "error",
        response: buildObservedErrorResponse(message, 400, {
          sandboxRunId: sandboxRunId ?? undefined,
          status,
        }),
        runtimeToolCallId,
        sandboxRunId,
        toolName: "run_marimo_analysis",
        turnId,
      });
    }

    if (isExecutionFailure) {
      return finalizeObservedRequest(observed, {
        errorCode: status === "timed_out" ? "sandbox_timed_out" : "sandbox_execution_failed",
        metadata: {
          exitCode: caughtError.exitCode,
          revisionId: revision.id,
          sandboxRunId,
          status,
          workspaceId: workspace.id,
        },
        outcome: "error",
        response: buildObservedErrorResponse(message, 500, {
          exitCode: caughtError.exitCode,
          sandboxRunId: sandboxRunId ?? undefined,
          status,
          stderr: truncateSandboxText(caughtError.stderr),
          stdout: truncateSandboxText(caughtError.stdout),
        }),
        runtimeToolCallId,
        sandboxRunId,
        toolName: "run_marimo_analysis",
        turnId,
      });
    }

    return finalizeObservedRequest(observed, {
      errorCode: "sandbox_route_failed",
      metadata: {
        revisionId: revision.id,
        sandboxRunId,
        status,
        workspaceId: workspace.id,
      },
      outcome: "error",
      response: buildObservedErrorResponse(message, 500, {
        sandboxRunId: sandboxRunId ?? undefined,
        status,
      }),
      runtimeToolCallId,
      sandboxRunId,
      toolName: "run_marimo_analysis",
      turnId,
    });
  }
}
