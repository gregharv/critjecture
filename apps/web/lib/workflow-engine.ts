import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { getAppDatabase } from "@/lib/app-db";
import {
  documents,
  organizationMemberships,
  workflowRunSteps,
  workflowRuns,
  workflowVersions,
  workflows,
} from "@/lib/app-schema";
import {
  SandboxAdmissionError,
  SandboxExecutionError,
  SandboxUnavailableError,
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import {
  deliverWorkflowRunOutputs,
  processDueWorkflowDeliveryRetries,
} from "@/lib/workflow-delivery";
import {
  cancelWorkflowInputRequestsForRun,
  ensureWorkflowInputRequestNotification,
  fulfillWorkflowInputRequestsForRun,
  sendWorkflowRunEmailAlert,
} from "@/lib/workflow-notifications";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import type { UserRole } from "@/lib/roles";
import { getWorkflowRunById, type WorkflowRunRecord } from "@/lib/workflow-runs";
import {
  parseWorkflowJsonRecord,
  parseWorkflowVersionContracts,
  type WorkflowStepV1,
  type WorkflowVersionContractsV1,
} from "@/lib/workflow-types";
import {
  validateWorkflowRunInputs,
  type WorkflowInputValidationSummary,
  type WorkflowValidatorResolvedDocument,
} from "@/lib/workflow-validator";

type WorkflowRunExecutionContext = {
  metadataJson: string;
  organizationId: string;
  runAsRole: "admin" | "member" | "owner";
  runAsUserId: string | null;
  runId: string;
  status: "blocked_validation" | "cancelled" | "completed" | "failed" | "queued" | "running" | "waiting_for_input";
  version: {
    deliveryJson: string;
    executionIdentityJson: string;
    inputBindingsJson: string;
    inputContractJson: string;
    outputsJson: string;
    provenanceJson: string;
    recipeJson: string;
    scheduleJson: string;
    thresholdsJson: string;
    workflowVersionId: string;
    workflowVersionNumber: number;
  };
  workflow: {
    id: string;
    name: string;
  };
};

type ResolvedWorkflowDocument = WorkflowValidatorResolvedDocument;

type StepExecutionState = {
  generatedAssets: GeneratedSandboxAsset[];
  inputFiles: string[];
  sandboxRunId: string;
  toolName: string;
};

export type ExecuteWorkflowRunResult = {
  completedStepCount: number;
  run: WorkflowRunRecord;
  status: "completed" | "failed" | "blocked_validation" | "waiting_for_input";
  totalStepCount: number;
};

class WorkflowEngineError extends Error {
  readonly code: string;

  constructor(message: string, code = "workflow_engine_error") {
    super(message);
    this.code = code;
    this.name = "WorkflowEngineError";
  }
}

function normalizeUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncateText(value: string, maxLength = 8_000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}… [truncated]`;
}

function extractSandboxRunIdFromError(caughtError: unknown) {
  if (
    caughtError instanceof SandboxExecutionError ||
    caughtError instanceof SandboxAdmissionError ||
    caughtError instanceof SandboxUnavailableError ||
    caughtError instanceof SandboxValidationError
  ) {
    return caughtError.sandboxRunId ?? null;
  }

  return null;
}

function getErrorMessage(caughtError: unknown, fallbackMessage: string) {
  return caughtError instanceof Error ? caughtError.message : fallbackMessage;
}


function parseWorkflowRunExecutionContext(row: {
  deliveryJson: string;
  executionIdentityJson: string;
  failureReason: string | null;
  id: string;
  inputBindingsJson: string;
  inputContractJson: string;
  metadataJson: string;
  organizationId: string;
  outputsJson: string;
  provenanceJson: string;
  recipeJson: string;
  runAsRole: "admin" | "member" | "owner";
  runAsUserId: string | null;
  scheduleJson: string;
  status: WorkflowRunExecutionContext["status"];
  thresholdsJson: string;
  versionNumber: number;
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
}) {
  return {
    metadataJson: row.metadataJson,
    organizationId: row.organizationId,
    runAsRole: row.runAsRole,
    runAsUserId: row.runAsUserId,
    runId: row.id,
    status: row.status,
    version: {
      deliveryJson: row.deliveryJson,
      executionIdentityJson: row.executionIdentityJson,
      inputBindingsJson: row.inputBindingsJson,
      inputContractJson: row.inputContractJson,
      outputsJson: row.outputsJson,
      provenanceJson: row.provenanceJson,
      recipeJson: row.recipeJson,
      scheduleJson: row.scheduleJson,
      thresholdsJson: row.thresholdsJson,
      workflowVersionId: row.workflowVersionId,
      workflowVersionNumber: row.versionNumber,
    },
    workflow: {
      id: row.workflowId,
      name: row.workflowName,
    },
  } satisfies WorkflowRunExecutionContext;
}

async function getWorkflowRunExecutionContext(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      deliveryJson: workflowVersions.deliveryJson,
      executionIdentityJson: workflowVersions.executionIdentityJson,
      failureReason: workflowRuns.failureReason,
      id: workflowRuns.id,
      inputBindingsJson: workflowVersions.inputBindingsJson,
      inputContractJson: workflowVersions.inputContractJson,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      outputsJson: workflowVersions.outputsJson,
      provenanceJson: workflowVersions.provenanceJson,
      recipeJson: workflowVersions.recipeJson,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      scheduleJson: workflowVersions.scheduleJson,
      status: workflowRuns.status,
      thresholdsJson: workflowVersions.thresholdsJson,
      versionNumber: workflowVersions.versionNumber,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      workflowVersionId: workflowRuns.workflowVersionId,
    })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    )
    .limit(1);

  const row = rows[0];

  return row ? parseWorkflowRunExecutionContext(row) : null;
}

async function markRunRunning(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(workflowRuns)
    .set({
      startedAt: now,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    );

  return now;
}

async function markRunValidationState(input: {
  metadata: Record<string, unknown>;
  organizationId: string;
  runId: string;
  status: "blocked_validation" | "waiting_for_input";
  workflowId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(workflowRuns)
    .set({
      completedAt: input.status === "blocked_validation" ? now : null,
      failureReason: input.status === "blocked_validation" ? "validation_failed" : null,
      metadataJson: JSON.stringify(input.metadata),
      startedAt: null,
      status: input.status,
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    );

  await db
    .update(workflows)
    .set({
      ...(input.status === "blocked_validation" ? { lastRunAt: now } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(workflows.organizationId, input.organizationId),
        eq(workflows.id, input.workflowId),
      ),
    );
}

async function markRunTerminal(input: {
  completedAt: number;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  organizationId: string;
  runId: string;
  status: "completed" | "failed";
  workflowId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(workflowRuns)
    .set({
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      metadataJson: JSON.stringify(input.metadata),
      status: input.status,
      updatedAt: input.completedAt,
    })
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    );

  await db
    .update(workflows)
    .set({
      lastRunAt: input.completedAt,
      updatedAt: input.completedAt,
    })
    .where(
      and(
        eq(workflows.organizationId, input.organizationId),
        eq(workflows.id, input.workflowId),
      ),
    );
}

async function assertRunExecutionIdentity(input: {
  contracts: WorkflowVersionContractsV1;
  organizationId: string;
  runAsUserId: string | null;
}) {
  if (!input.runAsUserId) {
    throw new WorkflowEngineError(
      "Workflow run is missing run_as_user_id.",
      "identity_invalid_missing_user",
    );
  }

  const db = await getAppDatabase();
  const membership = await db.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, input.organizationId),
      eq(organizationMemberships.userId, input.runAsUserId),
    ),
  });

  if (!membership) {
    throw new WorkflowEngineError(
      "Workflow execution identity is no longer a member of the organization.",
      "identity_invalid_membership_missing",
    );
  }

  if (membership.status !== input.contracts.executionIdentity.require_membership_status) {
    throw new WorkflowEngineError(
      `Workflow execution identity must be ${input.contracts.executionIdentity.require_membership_status}.`,
      "identity_invalid_membership_status",
    );
  }

  const membershipRole =
    membership.role === "admin" || membership.role === "owner"
      ? membership.role
      : null;

  if (
    !membershipRole ||
    !input.contracts.executionIdentity.required_membership_roles.includes(membershipRole)
  ) {
    throw new WorkflowEngineError(
      "Workflow execution identity no longer has a required role.",
      "identity_invalid_role",
    );
  }

  if (
    input.contracts.executionIdentity.mode === "fixed_membership_user" &&
    input.contracts.executionIdentity.run_as_user_id !== input.runAsUserId
  ) {
    throw new WorkflowEngineError(
      "Workflow execution identity no longer matches the workflow version policy.",
      "identity_invalid_mismatch",
    );
  }

  return membershipRole;
}

function buildSelectorRegex(pattern: string) {
  try {
    return new RegExp(pattern);
  } catch {
    throw new WorkflowEngineError(
      `Invalid selector display_name_regex pattern: ${pattern}`,
      "invalid_selector_regex",
    );
  }
}

async function resolveSelectorBindingDocuments(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
}) {
  if (input.binding.binding.kind !== "selector") {
    return [];
  }

  const selector = input.binding.binding.selector;
  const whereClauses = [
    eq(documents.organizationId, input.organizationId),
    eq(documents.ingestionStatus, "ready"),
  ];

  if (selector.access_scope_in && selector.access_scope_in.length > 0) {
    whereClauses.push(inArray(documents.accessScope, selector.access_scope_in));
  }

  if (selector.source_type_in && selector.source_type_in.length > 0) {
    whereClauses.push(inArray(documents.sourceType, selector.source_type_in));
  }

  if (selector.mime_type_in && selector.mime_type_in.length > 0) {
    whereClauses.push(inArray(documents.mimeType, selector.mime_type_in));
  }

  if (selector.display_name_equals) {
    whereClauses.push(eq(documents.displayName, selector.display_name_equals));
  }

  if (selector.uploaded_by_user_id) {
    whereClauses.push(eq(documents.uploadedByUserId, selector.uploaded_by_user_id));
  }

  const db = await getAppDatabase();
  const maxDocuments = Math.min(Math.max(input.binding.binding.max_documents, 1), 100);
  const fetchLimit = Math.min(Math.max(maxDocuments * 5, 50), 500);

  const baseQuery = db
    .select({
      accessScope: documents.accessScope,
      contentSha256: documents.contentSha256,
      displayName: documents.displayName,
      id: documents.id,
      mimeType: documents.mimeType,
      sourcePath: documents.sourcePath,
      sourceType: documents.sourceType,
      updatedAt: documents.updatedAt,
      uploadedByUserId: documents.uploadedByUserId,
    })
    .from(documents)
    .where(and(...whereClauses));

  const orderedQuery =
    input.binding.binding.selection === "latest_indexed_at"
      ? baseQuery.orderBy(desc(documents.lastIndexedAt), desc(documents.updatedAt))
      : baseQuery.orderBy(desc(documents.updatedAt));

  const candidateRows = await orderedQuery.limit(fetchLimit);
  const regex = selector.display_name_regex
    ? buildSelectorRegex(selector.display_name_regex)
    : null;

  const filteredRows = regex
    ? candidateRows.filter((row) => regex.test(row.displayName))
    : candidateRows;

  return filteredRows.slice(0, maxDocuments);
}

async function resolveDocumentBindingDocument(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
}) {
  if (input.binding.binding.kind !== "document_id") {
    return [];
  }

  const db = await getAppDatabase();
  const documentRow = await db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, input.organizationId),
      eq(documents.id, input.binding.binding.document_id),
      eq(documents.ingestionStatus, "ready"),
    ),
  });

  if (!documentRow) {
    return [];
  }

  return [
    {
      accessScope: documentRow.accessScope,
      contentSha256: documentRow.contentSha256,
      displayName: documentRow.displayName,
      id: documentRow.id,
      mimeType: documentRow.mimeType,
      sourcePath: documentRow.sourcePath,
      sourceType: documentRow.sourceType,
      updatedAt: documentRow.updatedAt,
      uploadedByUserId: documentRow.uploadedByUserId,
    },
  ];
}

async function resolveWorkflowInputBindings(input: {
  contracts: WorkflowVersionContractsV1;
  executionRole: UserRole;
  organizationId: string;
}) {
  const inputByKey = new Map(
    input.contracts.inputContract.inputs.map((spec) => [spec.input_key, spec]),
  );
  const resolvedInputDocuments = new Map<string, ResolvedWorkflowDocument[]>();

  for (const binding of input.contracts.inputBindings.bindings) {
    const inputSpec = inputByKey.get(binding.input_key);

    if (!inputSpec) {
      throw new WorkflowEngineError(
        `Unknown input binding key: ${binding.input_key}`,
        "invalid_input_binding",
      );
    }

    const boundDocuments =
      binding.binding.kind === "document_id"
        ? await resolveDocumentBindingDocument({
            binding,
            organizationId: input.organizationId,
          })
        : await resolveSelectorBindingDocuments({
            binding,
            organizationId: input.organizationId,
          });

    const accessibleDocuments = boundDocuments.filter((documentRow) =>
      canRoleAccessKnowledgeScope(input.executionRole, documentRow.accessScope),
    );

    if (accessibleDocuments.length !== boundDocuments.length) {
      throw new WorkflowEngineError(
        `Workflow input ${binding.input_key} resolved files that are no longer accessible to the run identity.`,
        "identity_invalid_document_access",
      );
    }

    const normalizedDocuments =
      inputSpec.multiplicity === "one"
        ? accessibleDocuments.slice(0, 1)
        : accessibleDocuments;

    resolvedInputDocuments.set(binding.input_key, normalizedDocuments);
  }

  for (const inputSpec of input.contracts.inputContract.inputs) {
    if (!resolvedInputDocuments.has(inputSpec.input_key)) {
      resolvedInputDocuments.set(inputSpec.input_key, []);
    }
  }

  return resolvedInputDocuments;
}

function resolveStepInputFiles(input: {
  resolvedInputs: Map<string, ResolvedWorkflowDocument[]>;
  step: WorkflowStepV1;
  stepOutputs: Map<string, StepExecutionState>;
}) {
  const fromConfig = normalizeUniqueStrings(input.step.config.input_files ?? []);
  const allowedInputFiles = new Set(
    [...input.resolvedInputs.values()]
      .flatMap((documentRows) => documentRows.map((documentRow) => documentRow.sourcePath)),
  );

  if (fromConfig.length > 0) {
    const invalidConfiguredFiles = fromConfig.filter((filePath) => !allowedInputFiles.has(filePath));

    if (invalidConfiguredFiles.length > 0) {
      throw new WorkflowEngineError(
        `Step ${input.step.step_key} references input files not covered by workflow bindings: ${invalidConfiguredFiles.join(", ")}`,
        "step_input_file_not_bound",
      );
    }

    return fromConfig;
  }

  const resolvedFiles: string[] = [];

  for (const inputRef of input.step.input_refs) {
    if (inputRef.type === "workflow_input") {
      const documentsForInput = input.resolvedInputs.get(inputRef.input_key) ?? [];
      for (const documentRow of documentsForInput) {
        resolvedFiles.push(documentRow.sourcePath);
      }
      continue;
    }

    const referencedOutput = input.stepOutputs.get(inputRef.step_key);

    if (referencedOutput) {
      resolvedFiles.push(...referencedOutput.inputFiles);
    }
  }

  return normalizeUniqueStrings(resolvedFiles);
}

function getStepToolDisplayName(step: WorkflowStepV1) {
  if (step.tool === "run_data_analysis") {
    return "analysis";
  }

  if (step.tool === "generate_visual_graph") {
    return "chart";
  }

  return "document";
}

async function executeWorkflowStep(input: {
  executionRole: UserRole;
  organizationId: string;
  organizationSlug: string;
  resolvedInputs: Map<string, ResolvedWorkflowDocument[]>;
  runAsUserId: string;
  runId: string;
  step: WorkflowStepV1;
  stepOutputs: Map<string, StepExecutionState>;
}) {
  resolveStepInputFiles({
    resolvedInputs: input.resolvedInputs,
    step: input.step,
    stepOutputs: input.stepOutputs,
  });

  throw new WorkflowEngineError(
    `Legacy workflow step ${input.step.step_key} uses removed tool ${input.step.tool}. Notebook-native workflow execution has not been rebuilt yet.`,
    "legacy_workflow_tool_removed",
  );
}

async function createRunningWorkflowStep(input: {
  organizationId: string;
  runId: string;
  step: WorkflowStepV1;
  stepInput: Record<string, unknown>;
  stepOrder: number;
}) {
  const now = Date.now();
  const stepRowId = randomUUID();
  const db = await getAppDatabase();

  await db.insert(workflowRunSteps).values({
    completedAt: null,
    createdAt: now,
    errorMessage: null,
    id: stepRowId,
    inputJson: JSON.stringify(input.stepInput),
    organizationId: input.organizationId,
    outputJson: JSON.stringify({}),
    runId: input.runId,
    sandboxRunId: null,
    startedAt: now,
    status: "running",
    stepKey: input.step.step_key,
    stepOrder: input.stepOrder,
    toolName: input.step.tool,
    updatedAt: now,
  });

  return stepRowId;
}

async function completeWorkflowStep(input: {
  organizationId: string;
  outputJson: Record<string, unknown>;
  sandboxRunId: string;
  stepRowId: string;
}) {
  const completedAt = Date.now();
  const db = await getAppDatabase();

  await db
    .update(workflowRunSteps)
    .set({
      completedAt,
      outputJson: JSON.stringify(input.outputJson),
      sandboxRunId: input.sandboxRunId,
      status: "completed",
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(workflowRunSteps.organizationId, input.organizationId),
        eq(workflowRunSteps.id, input.stepRowId),
      ),
    );
}

async function failWorkflowStep(input: {
  errorMessage: string;
  organizationId: string;
  outputJson: Record<string, unknown>;
  sandboxRunId: string | null;
  stepRowId: string;
}) {
  const failedAt = Date.now();
  const db = await getAppDatabase();

  await db
    .update(workflowRunSteps)
    .set({
      completedAt: failedAt,
      errorMessage: input.errorMessage,
      outputJson: JSON.stringify(input.outputJson),
      sandboxRunId: input.sandboxRunId,
      status: "failed",
      updatedAt: failedAt,
    })
    .where(
      and(
        eq(workflowRunSteps.organizationId, input.organizationId),
        eq(workflowRunSteps.id, input.stepRowId),
      ),
    );
}

function collectResolvedInputSummary(
  resolvedInputs: Map<string, ResolvedWorkflowDocument[]>,
) {
  const summary: Array<{
    documents: Array<{
      access_scope: "admin" | "public";
      content_sha256: string;
      display_name: string;
      document_id: string;
      mime_type: string | null;
      source_path: string;
      updated_at: number;
    }>;
    input_key: string;
  }> = [];

  for (const [inputKey, documentRows] of resolvedInputs.entries()) {
    summary.push({
      documents: documentRows.map((documentRow) => ({
        access_scope: documentRow.accessScope,
        content_sha256: documentRow.contentSha256,
        display_name: documentRow.displayName,
        document_id: documentRow.id,
        mime_type: documentRow.mimeType,
        source_path: documentRow.sourcePath,
        updated_at: documentRow.updatedAt,
      })),
      input_key: inputKey,
    });
  }

  return summary.sort((left, right) => left.input_key.localeCompare(right.input_key));
}

function collectMissingRequiredInputKeys(validationReports: {
  checks: Array<{ code: string; status: string }>;
  input_key: string;
}[]) {
  const missingKeys = validationReports
    .filter((report) =>
      report.checks.some(
        (check) => check.code === "missing_required_input" && check.status === "fail",
      ),
    )
    .map((report) => report.input_key)
    .sort((left, right) => left.localeCompare(right));

  return [...new Set(missingKeys)];
}

export async function executeWorkflowRun(input: {
  organizationId: string;
  organizationSlug: string;
  runId: string;
}): Promise<ExecuteWorkflowRunResult> {
  const runContext = await getWorkflowRunExecutionContext({
    organizationId: input.organizationId,
    runId: input.runId,
  });

  if (!runContext) {
    throw new WorkflowEngineError("Workflow run not found.", "run_not_found");
  }

  try {
    await processDueWorkflowDeliveryRetries({
      limit: 20,
      organizationId: input.organizationId,
    });
  } catch (caughtError) {
    logStructuredError("workflow.delivery_retry_dispatch_failed", caughtError, {
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.delivery.retry",
      workflowRunId: input.runId,
    });
  }

  if (runContext.status === "completed" || runContext.status === "failed") {
    const existingRun = await getWorkflowRunById({
      organizationId: input.organizationId,
      runId: input.runId,
    });

    if (!existingRun) {
      throw new WorkflowEngineError("Workflow run could not be reloaded.", "run_reload_failed");
    }

    return {
      completedStepCount: existingRun.status === "completed" ? 0 : 0,
      run: existingRun,
      status: existingRun.status === "completed" ? "completed" : "failed",
      totalStepCount: 0,
    };
  }

  const baseMetadata = parseWorkflowJsonRecord(runContext.metadataJson);

  let completedStepCount = 0;
  let totalStepCount = 0;
  let validationSummary: WorkflowInputValidationSummary | null = null;
  let contracts: WorkflowVersionContractsV1 | null = null;

  try {
    contracts = parseWorkflowVersionContracts({
      deliveryJson: runContext.version.deliveryJson,
      executionIdentityJson: runContext.version.executionIdentityJson,
      inputBindingsJson: runContext.version.inputBindingsJson,
      inputContractJson: runContext.version.inputContractJson,
      outputsJson: runContext.version.outputsJson,
      provenanceJson: runContext.version.provenanceJson,
      recipeJson: runContext.version.recipeJson,
      scheduleJson: runContext.version.scheduleJson,
      thresholdsJson: runContext.version.thresholdsJson,
    });

    if (!contracts) {
      throw new WorkflowEngineError("Workflow contracts could not be parsed.", "contract_parse_failed");
    }

    const executionRole = await assertRunExecutionIdentity({
      contracts,
      organizationId: input.organizationId,
      runAsUserId: runContext.runAsUserId,
    });

    if (!runContext.runAsUserId) {
      throw new WorkflowEngineError(
        "Workflow run is missing run_as_user_id.",
        "identity_invalid_missing_user",
      );
    }

    const resolvedInputs = await resolveWorkflowInputBindings({
      contracts,
      executionRole,
      organizationId: input.organizationId,
    });

    totalStepCount = contracts.recipe.steps.length;

    const validation = await validateWorkflowRunInputs({
      contracts,
      executionRole,
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      resolvedInputs,
      runId: input.runId,
      workflowId: runContext.workflow.id,
    });

    validationSummary = validation.summary;

    if (validation.status !== "pass") {
      const missingRequiredInputKeys = collectMissingRequiredInputKeys(validation.reports);
      const inputRequestNotification =
        validation.status === "waiting_for_input"
          ? await ensureWorkflowInputRequestNotification({
              organizationId: input.organizationId,
              requestedInputKeys: missingRequiredInputKeys,
              runId: input.runId,
              workflowId: runContext.workflow.id,
              workflowName: runContext.workflow.name,
            })
          : null;

      if (validation.status === "blocked_validation") {
        await cancelWorkflowInputRequestsForRun({
          organizationId: input.organizationId,
          reason: "Input validation failed for non-missing reasons.",
          runId: input.runId,
        });
      }

      await markRunValidationState({
        metadata: {
          ...baseMetadata,
          completed_step_count: 0,
          input_request:
            validation.status === "waiting_for_input"
              ? {
                  knowledge_upload_path: inputRequestNotification?.knowledgeUploadPath ?? null,
                  notification_channels: inputRequestNotification?.notificationChannels ?? ["in_app"],
                  request_id: inputRequestNotification?.requestId ?? null,
                  requested_input_keys: missingRequiredInputKeys,
                }
              : null,
          input_validation: {
            checked_at: validation.summary.checkedAt,
            failed_check_count: validation.summary.failedCheckCount,
            failed_input_count: validation.summary.failedInputCount,
            missing_required_input_count: validation.summary.missingRequiredInputCount,
            missing_required_input_keys: missingRequiredInputKeys,
            status: validation.status,
            warning_check_count: validation.summary.warningCheckCount,
            warning_input_count: validation.summary.warningInputCount,
          },
          resolved_inputs: collectResolvedInputSummary(resolvedInputs),
          total_step_count: totalStepCount,
          workflow_name: runContext.workflow.name,
          workflow_version_id: runContext.version.workflowVersionId,
          workflow_version_number: runContext.version.workflowVersionNumber,
        },
        organizationId: input.organizationId,
        runId: input.runId,
        status: validation.status,
        workflowId: runContext.workflow.id,
      });

      if (validation.status === "waiting_for_input" && inputRequestNotification?.notificationDispatched) {
        await sendWorkflowRunEmailAlert({
          channels: contracts.delivery.channels,
          event: "waiting_for_input",
          knowledgeUploadPath: inputRequestNotification.knowledgeUploadPath,
          organizationId: input.organizationId,
          requestedInputKeys: missingRequiredInputKeys,
          runId: input.runId,
          runStatus: "waiting_for_input",
          workflowId: runContext.workflow.id,
          workflowName: runContext.workflow.name,
        });
      }

      if (validation.status === "blocked_validation") {
        await sendWorkflowRunEmailAlert({
          channels: contracts.delivery.channels,
          event: "run_failed",
          failureReason: `validation_failed: ${validation.summary.failedCheckCount} check(s) failed across ${validation.summary.failedInputCount} input(s).`,
          organizationId: input.organizationId,
          runId: input.runId,
          runStatus: "blocked_validation",
          workflowId: runContext.workflow.id,
          workflowName: runContext.workflow.name,
        });
      }

      const blockedRun = await getWorkflowRunById({
        organizationId: input.organizationId,
        runId: input.runId,
      });

      if (!blockedRun) {
        throw new WorkflowEngineError(
          "Workflow run could not be reloaded after validation.",
          "run_reload_failed",
        );
      }

      logStructuredEvent("workflow.run_validation_blocked", {
        organizationId: input.organizationId,
        routeGroup: "workflow",
        routeKey: "workflow.engine.execute",
        workflowRunId: input.runId,
      });

      return {
        completedStepCount: 0,
        run: blockedRun,
        status: validation.status,
        totalStepCount,
      };
    }

    await fulfillWorkflowInputRequestsForRun({
      organizationId: input.organizationId,
      runId: input.runId,
    });

    await markRunRunning({
      organizationId: input.organizationId,
      runId: input.runId,
    });

    const stepOutputs = new Map<string, StepExecutionState>();
    const generatedArtifacts: Array<{
      byte_size: number;
      expires_at: number;
      file_name: string;
      mime_type: string;
      relative_path: string;
      run_id: string;
    }> = [];
    const sandboxRunIds: string[] = [];

    for (const [stepOrder, step] of contracts.recipe.steps.entries()) {
      const stepInputFiles = resolveStepInputFiles({
        resolvedInputs,
        step,
        stepOutputs,
      });
      const stepInput = {
        input_files: stepInputFiles,
        step_kind: step.kind,
        tool: step.tool,
      };
      const stepRowId = await createRunningWorkflowStep({
        organizationId: input.organizationId,
        runId: input.runId,
        step,
        stepInput,
        stepOrder,
      });

      try {
        const execution = await executeWorkflowStep({
          executionRole,
          organizationId: input.organizationId,
          organizationSlug: input.organizationSlug,
          resolvedInputs,
          runAsUserId: runContext.runAsUserId,
          runId: input.runId,
          step,
          stepOutputs,
        });

        stepOutputs.set(step.step_key, {
          generatedAssets: execution.generatedAssets,
          inputFiles: execution.inputFiles,
          sandboxRunId: execution.sandboxResult.sandboxRunId,
          toolName: execution.toolName,
        });
        sandboxRunIds.push(execution.sandboxResult.sandboxRunId);
        generatedArtifacts.push(
          ...execution.generatedAssets.map((asset) => ({
            byte_size: asset.byteSize,
            expires_at: asset.expiresAt,
            file_name: asset.fileName,
            mime_type: asset.mimeType,
            relative_path: asset.relativePath,
            run_id: asset.runId,
          })),
        );

        await completeWorkflowStep({
          organizationId: input.organizationId,
          outputJson: {
            exit_code: execution.sandboxResult.exitCode,
            generated_assets: execution.generatedAssets.map((asset) => ({
              byte_size: asset.byteSize,
              expires_at: asset.expiresAt,
              file_name: asset.fileName,
              mime_type: asset.mimeType,
              relative_path: asset.relativePath,
              run_id: asset.runId,
            })),
            sandbox_run_id: execution.sandboxResult.sandboxRunId,
            status: execution.sandboxResult.status,
            stderr: truncateText(execution.sandboxResult.stderr),
            stdout: truncateText(execution.sandboxResult.stdout),
          },
          sandboxRunId: execution.sandboxResult.sandboxRunId,
          stepRowId,
        });

        completedStepCount += 1;
      } catch (caughtError) {
        const errorMessage = getErrorMessage(caughtError, "Workflow step execution failed.");
        const sandboxRunId = extractSandboxRunIdFromError(caughtError);

        await failWorkflowStep({
          errorMessage,
          organizationId: input.organizationId,
          outputJson: {
            error_code:
              caughtError instanceof WorkflowEngineError
                ? caughtError.code
                : "step_execution_failed",
            error_message: errorMessage,
          },
          sandboxRunId,
          stepRowId,
        });

        throw new WorkflowEngineError(
          `${getStepToolDisplayName(step)} step ${step.step_key} failed: ${errorMessage}`,
          caughtError instanceof WorkflowEngineError
            ? caughtError.code
            : "step_execution_failed",
        );
      }
    }

    const completedAt = Date.now();

    await markRunTerminal({
      completedAt,
      failureReason: null,
      metadata: {
        ...baseMetadata,
        completed_step_count: completedStepCount,
        generated_artifacts: generatedArtifacts,
        input_validation: validationSummary
          ? {
              checked_at: validationSummary.checkedAt,
              failed_check_count: validationSummary.failedCheckCount,
              failed_input_count: validationSummary.failedInputCount,
              missing_required_input_count: validationSummary.missingRequiredInputCount,
              status: "pass",
              warning_check_count: validationSummary.warningCheckCount,
              warning_input_count: validationSummary.warningInputCount,
            }
          : null,
        resolved_inputs: collectResolvedInputSummary(resolvedInputs),
        sandbox_run_ids: normalizeUniqueStrings(sandboxRunIds),
        total_step_count: totalStepCount,
        workflow_name: runContext.workflow.name,
        workflow_version_id: runContext.version.workflowVersionId,
        workflow_version_number: runContext.version.workflowVersionNumber,
      },
      organizationId: input.organizationId,
      runId: input.runId,
      status: "completed",
      workflowId: runContext.workflow.id,
    });

    try {
      await deliverWorkflowRunOutputs({
        organizationId: input.organizationId,
        runId: input.runId,
      });
    } catch (caughtError) {
      logStructuredError("workflow.delivery_dispatch_failed", caughtError, {
        organizationId: input.organizationId,
        routeGroup: "workflow",
        routeKey: "workflow.delivery",
        workflowRunId: input.runId,
      });
    }

    logStructuredEvent("workflow.run_completed", {
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.engine.execute",
      workflowRunId: input.runId,
    });
  } catch (caughtError) {
    const failureCode =
      caughtError instanceof WorkflowEngineError
        ? caughtError.code
        : "workflow_execution_failed";
    const failureMessage = getErrorMessage(caughtError, "Workflow execution failed.");
    const completedAt = Date.now();

    await markRunTerminal({
      completedAt,
      failureReason: `${failureCode}: ${failureMessage}`,
      metadata: {
        ...baseMetadata,
        completed_step_count: completedStepCount,
        failure_code: failureCode,
        failure_message: failureMessage,
        input_validation: validationSummary
          ? {
              checked_at: validationSummary.checkedAt,
              failed_check_count: validationSummary.failedCheckCount,
              failed_input_count: validationSummary.failedInputCount,
              missing_required_input_count: validationSummary.missingRequiredInputCount,
              status: "pass",
              warning_check_count: validationSummary.warningCheckCount,
              warning_input_count: validationSummary.warningInputCount,
            }
          : null,
        total_step_count: totalStepCount,
        workflow_name: runContext.workflow.name,
        workflow_version_id: runContext.version.workflowVersionId,
        workflow_version_number: runContext.version.workflowVersionNumber,
      },
      organizationId: input.organizationId,
      runId: input.runId,
      status: "failed",
      workflowId: runContext.workflow.id,
    });

    await sendWorkflowRunEmailAlert({
      channels: contracts?.delivery.channels ?? [],
      event: "run_failed",
      failureReason: `${failureCode}: ${failureMessage}`,
      organizationId: input.organizationId,
      runId: input.runId,
      runStatus: "failed",
      workflowId: runContext.workflow.id,
      workflowName: runContext.workflow.name,
    });

    logStructuredEvent("workflow.run_failed", {
      error_code: failureCode,
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.engine.execute",
      workflowRunId: input.runId,
    });
  }

  const finalizedRun = await getWorkflowRunById({
    organizationId: input.organizationId,
    runId: input.runId,
  });

  if (!finalizedRun) {
    throw new WorkflowEngineError("Workflow run could not be reloaded.", "run_reload_failed");
  }

  const normalizedStatus: ExecuteWorkflowRunResult["status"] =
    finalizedRun.status === "completed"
      ? "completed"
      : finalizedRun.status === "waiting_for_input"
        ? "waiting_for_input"
        : finalizedRun.status === "blocked_validation"
          ? "blocked_validation"
          : "failed";

  return {
    completedStepCount,
    run: finalizedRun,
    status: normalizedStatus,
    totalStepCount,
  };
}
