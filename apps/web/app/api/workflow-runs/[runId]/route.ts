import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import {
  getPreviousWorkflowRun,
  getWorkflowRunById,
  listWorkflowRunDeliveries,
  listWorkflowRunInputChecks,
  listWorkflowRunInputRequests,
  listWorkflowRunSteps,
  type WorkflowRunRecord,
} from "@/lib/workflow-runs";

export const runtime = "nodejs";

type WorkflowRunRouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

type WorkflowRunAlert = {
  message: string;
  severity: "info" | "warning" | "critical";
  source: "input_request" | "input_validation" | "run_failure" | "run_state";
};

type WorkflowRunChangeSummary = {
  artifactCountDelta: number | null;
  comparedToRunId: string | null;
  inputKeysAdded: string[];
  inputKeysChanged: string[];
  inputKeysRemoved: string[];
  inputKeysUnchanged: string[];
  statusChanged: boolean;
  workflowVersionChanged: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function extractResolvedInputHashes(metadata: Record<string, unknown>) {
  const hashesByInputKey = new Map<string, string[]>();
  const resolvedInputs = metadata.resolved_inputs;

  if (!Array.isArray(resolvedInputs)) {
    return hashesByInputKey;
  }

  for (const entry of resolvedInputs) {
    if (!isRecord(entry)) {
      continue;
    }

    const inputKey = normalizeText(entry.input_key);

    if (!inputKey) {
      continue;
    }

    const documents = entry.documents;

    if (!Array.isArray(documents)) {
      hashesByInputKey.set(inputKey, []);
      continue;
    }

    const hashes = normalizeUniqueStrings(
      documents.flatMap((documentEntry) => {
        if (!isRecord(documentEntry)) {
          return [];
        }

        const hash = normalizeText(documentEntry.content_sha256);
        return hash ? [hash] : [];
      }),
    );

    hashesByInputKey.set(inputKey, hashes);
  }

  return hashesByInputKey;
}

function getGeneratedArtifactCount(metadata: Record<string, unknown>) {
  return Array.isArray(metadata.generated_artifacts) ? metadata.generated_artifacts.length : null;
}

function buildRunChangeSummary(
  run: WorkflowRunRecord,
  previousRun: WorkflowRunRecord | null,
): WorkflowRunChangeSummary {
  if (!previousRun) {
    return {
      artifactCountDelta: null,
      comparedToRunId: null,
      inputKeysAdded: [],
      inputKeysChanged: [],
      inputKeysRemoved: [],
      inputKeysUnchanged: [],
      statusChanged: false,
      workflowVersionChanged: false,
    };
  }

  const currentInputHashes = extractResolvedInputHashes(run.metadata);
  const previousInputHashes = extractResolvedInputHashes(previousRun.metadata);
  const allInputKeys = normalizeUniqueStrings([
    ...currentInputHashes.keys(),
    ...previousInputHashes.keys(),
  ]);
  const inputKeysAdded: string[] = [];
  const inputKeysRemoved: string[] = [];
  const inputKeysChanged: string[] = [];
  const inputKeysUnchanged: string[] = [];

  for (const inputKey of allInputKeys) {
    const currentHashes = currentInputHashes.get(inputKey) ?? [];
    const priorHashes = previousInputHashes.get(inputKey) ?? [];
    const hasCurrent = currentInputHashes.has(inputKey);
    const hasPrior = previousInputHashes.has(inputKey);

    if (hasCurrent && !hasPrior) {
      inputKeysAdded.push(inputKey);
      continue;
    }

    if (!hasCurrent && hasPrior) {
      inputKeysRemoved.push(inputKey);
      continue;
    }

    if (!arraysEqual(currentHashes, priorHashes)) {
      inputKeysChanged.push(inputKey);
    } else {
      inputKeysUnchanged.push(inputKey);
    }
  }

  const currentArtifactCount = getGeneratedArtifactCount(run.metadata);
  const previousArtifactCount = getGeneratedArtifactCount(previousRun.metadata);

  return {
    artifactCountDelta:
      currentArtifactCount === null || previousArtifactCount === null
        ? null
        : currentArtifactCount - previousArtifactCount,
    comparedToRunId: previousRun.id,
    inputKeysAdded,
    inputKeysChanged,
    inputKeysRemoved,
    inputKeysUnchanged,
    statusChanged: run.status !== previousRun.status,
    workflowVersionChanged: run.workflowVersionId !== previousRun.workflowVersionId,
  };
}

function buildRunAlerts(run: WorkflowRunRecord): WorkflowRunAlert[] {
  const alerts: WorkflowRunAlert[] = [];
  const metadata = run.metadata;
  const validation = isRecord(metadata.input_validation) ? metadata.input_validation : null;
  const inputRequest = isRecord(metadata.input_request) ? metadata.input_request : null;

  if (run.status === "failed") {
    alerts.push({
      message: run.failureReason ?? "Run failed.",
      severity: "critical",
      source: "run_failure",
    });
  }

  if (run.status === "waiting_for_input") {
    alerts.push({
      message: "Run is waiting for missing required inputs.",
      severity: "warning",
      source: "run_state",
    });
  }

  if (run.status === "blocked_validation") {
    alerts.push({
      message: "Run is blocked by input validation failures.",
      severity: "critical",
      source: "run_state",
    });
  }

  if (run.status === "skipped") {
    alerts.push({
      message: "Run was skipped because execution was not required for the resolved inputs.",
      severity: "info",
      source: "run_state",
    });
  }

  if (validation) {
    const failedCheckCount =
      typeof validation.failed_check_count === "number"
        ? Math.max(0, Math.trunc(validation.failed_check_count))
        : 0;
    const warningCheckCount =
      typeof validation.warning_check_count === "number"
        ? Math.max(0, Math.trunc(validation.warning_check_count))
        : 0;

    if (failedCheckCount > 0) {
      alerts.push({
        message: `${failedCheckCount} validation check${failedCheckCount === 1 ? "" : "s"} failed.`,
        severity: "critical",
        source: "input_validation",
      });
    }

    if (warningCheckCount > 0) {
      alerts.push({
        message: `${warningCheckCount} validation check${warningCheckCount === 1 ? "" : "s"} returned warnings.`,
        severity: "warning",
        source: "input_validation",
      });
    }
  }

  if (inputRequest) {
    const requestedInputKeys = Array.isArray(inputRequest.requested_input_keys)
      ? normalizeUniqueStrings(
          inputRequest.requested_input_keys
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim()),
        )
      : [];

    if (requestedInputKeys.length > 0) {
      alerts.push({
        message: `Input request is open for: ${requestedInputKeys.join(", ")}.`,
        severity: "info",
        source: "input_request",
      });
    }
  }

  return alerts;
}

export async function GET(_request: Request, context: WorkflowRunRouteContext) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "GET",
    routeGroup: "workflow",
    routeKey: "workflow.runs.detail",
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

  if (!user.access.canViewWorkflows) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse("This membership cannot view workflow runs.", 403),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "workflow",
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

  const { runId } = await context.params;
  const normalizedRunId = runId.trim();

  if (!normalizedRunId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_workflow_request",
      outcome: "error",
      response: buildObservedErrorResponse("runId must be a non-empty string.", 400),
    });
  }

  try {
    const run = await getWorkflowRunById({
      organizationId: user.organizationId,
      runId: normalizedRunId,
    });

    if (!run) {
      return finalizeObservedRequest(observed, {
        errorCode: "workflow_run_not_found",
        outcome: "error",
        response: buildObservedErrorResponse("Workflow run not found.", 404),
      });
    }

    const [inputChecks, inputRequests, steps, deliveries, previousRun] = await Promise.all([
      listWorkflowRunInputChecks({
        organizationId: user.organizationId,
        runId: normalizedRunId,
      }),
      listWorkflowRunInputRequests({
        organizationId: user.organizationId,
        runId: normalizedRunId,
      }),
      listWorkflowRunSteps({
        organizationId: user.organizationId,
        runId: normalizedRunId,
      }),
      listWorkflowRunDeliveries({
        organizationId: user.organizationId,
        runId: normalizedRunId,
      }),
      getPreviousWorkflowRun({
        createdBefore: run.createdAt,
        organizationId: user.organizationId,
        workflowId: run.workflowId,
      }),
    ]);

    return finalizeObservedRequest(observed, {
      metadata: {
        deliveryCount: deliveries.deliveries.length,
        runId: normalizedRunId,
        stepCount: steps.steps.length,
        workflowId: run.workflowId,
      },
      outcome: "ok",
      response: NextResponse.json({
        alerts: buildRunAlerts(run),
        changeSummary: buildRunChangeSummary(run, previousRun),
        deliveries: deliveries.deliveries,
        inputChecks: inputChecks.checks,
        inputRequests: inputRequests.requests,
        previousRun: previousRun
          ? {
              completedAt: previousRun.completedAt,
              id: previousRun.id,
              startedAt: previousRun.startedAt,
              status: previousRun.status,
              workflowVersionId: previousRun.workflowVersionId,
              workflowVersionNumber: previousRun.workflowVersionNumber,
            }
          : null,
        run,
        steps: steps.steps,
      }),
      usageEvents: [
        {
          eventType: "workflow_run_detail_viewed",
          quantity: 1,
          status: "ok",
          usageClass: "system",
        },
      ],
    });
  } catch (caughtError) {
    return finalizeObservedRequest(observed, {
      errorCode: "workflow_run_detail_failed",
      outcome: "error",
      response: buildObservedErrorResponse(
        caughtError instanceof Error ? caughtError.message : "Failed to load workflow run.",
        500,
      ),
    });
  }
}
