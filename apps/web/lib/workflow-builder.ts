import "server-only";

import path from "node:path";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "@/lib/legacy-app-db";
import {
  analysisResults,
  chatTurns,
  documents,
  organizations,
  toolCalls,
} from "@/lib/legacy-app-schema";
import { ensureDocumentAsset, ensureFilesystemAssetVersion } from "@/lib/data-assets";
import type {
  BuildWorkflowFromChatTurnResponse,
  WorkflowDraftFromChatTurn,
  WorkflowDraftVersionPayload,
} from "@/lib/workflow-builder-types";
import { parseWorkflowJsonStringArray } from "@/lib/workflow-types";

export class WorkflowBuilderError extends Error {
  readonly code: string;

  constructor(message: string, code = "workflow_builder_error") {
    super(message);
    this.code = code;
    this.name = "WorkflowBuilderError";
  }
}

type BuildWorkflowDraftInput = {
  conversationId?: string;
  organizationId: string;
  turnId?: string;
  userId: string;
};

type ParsedCsvSchema = {
  columns: string[];
  file: string;
};

type ParsedToolCall = {
  accessedFiles: string[];
  id: string;
  parameters: Record<string, unknown>;
  resultSummary: string | null;
  runtimeToolCallId: string;
  sandboxRunId: string | null;
  startedAt: number;
  status: "started" | "completed" | "error";
  toolName: string;
};

function parseJsonRecord(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseCsvSchemasJson(value: string | null | undefined): ParsedCsvSchema[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }

      const record = entry as Record<string, unknown>;
      const file = typeof record.file === "string" ? record.file.trim() : "";
      const columns = Array.isArray(record.columns)
        ? record.columns
            .filter((column): column is string => typeof column === "string")
            .map((column) => column.trim())
            .filter(Boolean)
        : [];

      if (!file) {
        return [];
      }

      return [
        {
          columns,
          file,
        } satisfies ParsedCsvSchema,
      ];
    });
  } catch {
    return [];
  }
}

function extractInputFilesFromParameters(parameters: Record<string, unknown>) {
  const inputFiles = parameters.inputFiles;

  if (!Array.isArray(inputFiles)) {
    return [];
  }

  return inputFiles
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function deriveSuggestedWorkflowName(promptText: string, createdAt: number) {
  const normalizedPrompt = promptText.replace(/\s+/g, " ").trim();

  if (!normalizedPrompt) {
    return `Workflow ${new Date(createdAt).toISOString().slice(0, 10)}`;
  }

  const sentence = normalizedPrompt
    .replace(/[?.!]+$/g, "")
    .slice(0, 80)
    .trim();

  return sentence || `Workflow ${new Date(createdAt).toISOString().slice(0, 10)}`;
}

function createInputKey(baseName: string, index: number, usedInputKeys: Set<string>) {
  const normalizedBase =
    baseName
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "input";

  let candidate = `input_${normalizedBase}`;

  if (index > 0) {
    candidate = `${candidate}_${index + 1}`;
  }

  let suffix = 2;

  while (usedInputKeys.has(candidate)) {
    candidate = `input_${normalizedBase}_${suffix}`;
    suffix += 1;
  }

  usedInputKeys.add(candidate);
  return candidate;
}

function inferAccessScopeFromPath(filePath: string) {
  return filePath.startsWith("admin/") ? (["admin"] as const) : (["public"] as const);
}

function inferAllowedMimeTypes(inputPath: string, documentMimeType: string | null) {
  if (documentMimeType && documentMimeType.trim()) {
    return [documentMimeType.trim()];
  }

  const extension = path.posix.extname(inputPath).toLowerCase();

  if (extension === ".csv") {
    return ["text/csv"];
  }

  if (extension === ".md") {
    return ["text/markdown", "text/plain"];
  }

  if (extension === ".pdf") {
    return ["application/pdf"];
  }

  if (extension === ".txt") {
    return ["text/plain"];
  }

  return ["text/plain"];
}

function inferDataKind(inputPath: string, documentMimeType: string | null) {
  if (documentMimeType === "text/csv") {
    return "table" as const;
  }

  return path.posix.extname(inputPath).toLowerCase() === ".csv"
    ? ("table" as const)
    : ("text_document" as const);
}

function parseToolCallsForBuilder(
  rows: Array<{
    accessedFilesJson: string;
    id: string;
    resultSummary: string | null;
    runtimeToolCallId: string;
    sandboxRunId: string | null;
    startedAt: number;
    status: "started" | "completed" | "error";
    toolName: string;
    toolParametersJson: string;
  }>,
) {
  return rows.map((row) => ({
    accessedFiles: parseWorkflowJsonStringArray(row.accessedFilesJson),
    id: row.id,
    parameters: parseJsonRecord(row.toolParametersJson),
    resultSummary: row.resultSummary,
    runtimeToolCallId: row.runtimeToolCallId,
    sandboxRunId: row.sandboxRunId,
    startedAt: row.startedAt,
    status: row.status,
    toolName: row.toolName,
  })) satisfies ParsedToolCall[];
}

async function resolveSelectedTurn(input: BuildWorkflowDraftInput) {
  const db = await getAppDatabase();

  if (input.turnId) {
    const rows = await db
      .select({
        conversationId: chatTurns.conversationId,
        createdAt: chatTurns.createdAt,
        id: chatTurns.id,
        status: chatTurns.status,
        userPromptText: chatTurns.userPromptText,
      })
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.id, input.turnId),
          eq(chatTurns.organizationId, input.organizationId),
          eq(chatTurns.userId, input.userId),
        ),
      )
      .limit(1);
    const row = rows[0];

    if (!row) {
      throw new WorkflowBuilderError("Chat turn not found.", "turn_not_found");
    }

    if (row.status !== "completed") {
      throw new WorkflowBuilderError(
        "Chat turn must be completed before it can be saved as a workflow.",
        "turn_not_completed",
      );
    }

    return row;
  }

  if (!input.conversationId) {
    throw new WorkflowBuilderError(
      "Provide either turnId or conversationId when saving a workflow from chat.",
      "missing_turn_selector",
    );
  }

  const rows = await db
    .select({
      conversationId: chatTurns.conversationId,
      createdAt: chatTurns.createdAt,
      id: chatTurns.id,
      status: chatTurns.status,
      userPromptText: chatTurns.userPromptText,
    })
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.organizationId, input.organizationId),
        eq(chatTurns.userId, input.userId),
        eq(chatTurns.conversationId, input.conversationId),
        eq(chatTurns.status, "completed"),
      ),
    )
    .orderBy(desc(chatTurns.createdAt))
    .limit(1);

  const row = rows[0];

  if (!row) {
    throw new WorkflowBuilderError(
      "No completed chat turns were found for this conversation.",
      "turn_not_found",
    );
  }

  return row;
}

function ensureWorkflowRecipeHasExecutableSteps(stepCount: number) {
  if (stepCount <= 0) {
    throw new WorkflowBuilderError(
      "Selected chat turn does not include a completed analysis or chart step that can be replayed as a workflow.",
      "analysis_step_missing",
    );
  }
}

export async function buildWorkflowDraftFromChatTurn(
  input: BuildWorkflowDraftInput,
): Promise<BuildWorkflowFromChatTurnResponse> {
  const selectedTurn = await resolveSelectedTurn(input);
  const db = await getAppDatabase();
  const organizationRow = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
  });

  if (!organizationRow) {
    throw new WorkflowBuilderError("Organization not found.", "organization_not_found");
  }

  const [toolCallRows, analysisResultRow] = await Promise.all([
    db
      .select({
        accessedFilesJson: toolCalls.accessedFilesJson,
        id: toolCalls.id,
        resultSummary: toolCalls.resultSummary,
        runtimeToolCallId: toolCalls.runtimeToolCallId,
        sandboxRunId: toolCalls.sandboxRunId,
        startedAt: toolCalls.startedAt,
        status: toolCalls.status,
        toolName: toolCalls.toolName,
        toolParametersJson: toolCalls.toolParametersJson,
      })
      .from(toolCalls)
      .where(eq(toolCalls.turnId, selectedTurn.id))
      .orderBy(asc(toolCalls.startedAt)),
    db
      .select({
        csvSchemasJson: analysisResults.csvSchemasJson,
        id: analysisResults.id,
        inputFilesJson: analysisResults.inputFilesJson,
      })
      .from(analysisResults)
      .where(
        and(
          eq(analysisResults.organizationId, input.organizationId),
          eq(analysisResults.turnId, selectedTurn.id),
          eq(analysisResults.userId, input.userId),
        ),
      )
      .orderBy(desc(analysisResults.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const parsedToolCalls = parseToolCallsForBuilder(toolCallRows);
  const completedToolCalls = parsedToolCalls.filter((toolCall) => toolCall.status === "completed");
  const relevantToolCalls = completedToolCalls.filter((toolCall) =>
    [
      "search_company_knowledge",
      "run_data_analysis",
      "generate_visual_graph",
      "generate_document",
    ].includes(toolCall.toolName),
  );

  if (relevantToolCalls.length === 0) {
    throw new WorkflowBuilderError(
      "Selected turn does not contain tool activity that can be converted into a workflow draft.",
      "no_supported_tool_calls",
    );
  }

  const inputPaths: string[] = [];
  const inputPathSet = new Set<string>();

  const appendInputPath = (value: string) => {
    const normalized = value.trim();

    if (!normalized || inputPathSet.has(normalized)) {
      return;
    }

    inputPathSet.add(normalized);
    inputPaths.push(normalized);
  };

  for (const toolCall of relevantToolCalls) {
    for (const accessedFile of toolCall.accessedFiles) {
      appendInputPath(accessedFile);
    }

    for (const inputFile of extractInputFilesFromParameters(toolCall.parameters)) {
      appendInputPath(inputFile);
    }
  }

  for (const resultInputFile of parseWorkflowJsonStringArray(analysisResultRow?.inputFilesJson ?? null)) {
    appendInputPath(resultInputFile);
  }

  const csvSchemas = parseCsvSchemasJson(analysisResultRow?.csvSchemasJson ?? null);
  const csvSchemaByPath = new Map(csvSchemas.map((schema) => [schema.file, schema]));
  const csvSchemaByBaseName = new Map(
    csvSchemas.map((schema) => [path.posix.basename(schema.file), schema]),
  );

  const documentRows =
    inputPaths.length > 0
      ? await db
          .select({
            accessScope: documents.accessScope,
            byteSize: documents.byteSize,
            contentSha256: documents.contentSha256,
            displayName: documents.displayName,
            id: documents.id,
            lastIndexedAt: documents.lastIndexedAt,
            mimeType: documents.mimeType,
            sourcePath: documents.sourcePath,
            sourceType: documents.sourceType,
            updatedAt: documents.updatedAt,
            uploadedByUserId: documents.uploadedByUserId,
          })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, input.organizationId),
              eq(documents.ingestionStatus, "ready"),
              inArray(documents.sourcePath, inputPaths),
            ),
          )
      : [];
  const documentsByPath = new Map(documentRows.map((row) => [row.sourcePath, row]));
  const assetsByPath = new Map<
    string,
    {
      assetId: string;
      mimeType: string | null;
    }
  >();

  for (const inputPath of inputPaths) {
    const documentRow = documentsByPath.get(inputPath);

    try {
      const resolvedAsset = documentRow
        ? await ensureDocumentAsset({
            document: {
              accessScope: documentRow.accessScope,
              byteSize: documentRow.byteSize,
              contentSha256: documentRow.contentSha256,
              displayName: documentRow.displayName,
              documentId: documentRow.id,
              lastIndexedAt: documentRow.lastIndexedAt,
              mimeType: documentRow.mimeType,
              organizationId: input.organizationId,
              sourcePath: documentRow.sourcePath,
              sourceType: documentRow.sourceType,
              updatedAt: documentRow.updatedAt,
              uploadedByUserId: documentRow.uploadedByUserId,
            },
          })
        : await ensureFilesystemAssetVersion({
            organizationId: input.organizationId,
            organizationSlug: organizationRow.slug,
            relativePath: inputPath,
          });

      assetsByPath.set(inputPath, {
        assetId: resolvedAsset.asset.id,
        mimeType: resolvedAsset.version.mimeType,
      });
    } catch {
      // Preserve asset-selector fallback when the path can no longer be registered.
    }
  }

  const unresolvedInputPaths: string[] = [];
  const usedInputKeys = new Set<string>();
  const inputKeyByPath = new Map<string, string>();

  const inputContractInputs = inputPaths.map((inputPath, index) => {
    const documentRow = documentsByPath.get(inputPath);
    const filesystemAsset = assetsByPath.get(inputPath);
    const fallbackDisplayName = path.posix.basename(inputPath);
    const inputKey = createInputKey(fallbackDisplayName, index, usedInputKeys);
    inputKeyByPath.set(inputPath, inputKey);

    const resolvedMimeType = documentRow?.mimeType ?? filesystemAsset?.mimeType ?? null;
    const dataKind = inferDataKind(inputPath, resolvedMimeType);
    const schemaMatch =
      csvSchemaByPath.get(inputPath) ?? csvSchemaByBaseName.get(path.posix.basename(inputPath));

    return {
      allowed_mime_types: inferAllowedMimeTypes(inputPath, resolvedMimeType),
      ...(dataKind === "table"
        ? {
            csv_rules: {
              ...(schemaMatch && schemaMatch.columns.length > 0
                ? { required_columns: [...new Set(schemaMatch.columns)] }
                : {}),
              min_row_count: 1,
            },
          }
        : {}),
      data_kind: dataKind,
      duplicate_policy: {
        lookback_successful_runs: 3,
        mode: "warn_if_unchanged" as const,
      },
      input_key: inputKey,
      label: documentRow?.displayName || fallbackDisplayName,
      multiplicity: "one" as const,
      required: true,
    };
  });

  const inputBindings = inputPaths.map((inputPath) => {
    const inputKey = inputKeyByPath.get(inputPath);

    if (!inputKey) {
      throw new WorkflowBuilderError(
        `Missing input key mapping for ${inputPath}.`,
        "input_binding_failed",
      );
    }

    const filesystemAsset = assetsByPath.get(inputPath);

    if (filesystemAsset) {
      return {
        binding: {
          asset_id: filesystemAsset.assetId,
          kind: "asset_id" as const,
        },
        input_key: inputKey,
      };
    }

    unresolvedInputPaths.push(inputPath);

    return {
      binding: {
        kind: "asset_selector" as const,
        max_assets: 1,
        selection: "latest_updated_at" as const,
        selector: {
          access_scope_in: [...inferAccessScopeFromPath(inputPath)],
          asset_key_equals: inputPath,
        },
      },
      input_key: inputKey,
    };
  });

  const recipeSteps: WorkflowDraftVersionPayload["recipe"]["steps"] = [];
  let analysisToolCallCount = 0;
  let chartToolCallCount = 0;
  let documentToolCallCount = 0;
  let lastAnalysisStepRef: { outputKey: string; stepKey: string } | null = null;

  for (const toolCall of relevantToolCalls) {
    if (toolCall.toolName === "run_data_analysis") {
      const analysisCode =
        typeof toolCall.parameters.code === "string" && toolCall.parameters.code.trim()
          ? toolCall.parameters.code.trim()
          : null;

      if (!analysisCode) {
        continue;
      }

      analysisToolCallCount += 1;
      const stepKey = `analysis_${analysisToolCallCount}`;
      const outputKey = `analysis_result_${analysisToolCallCount}`;
      const inputFiles = extractInputFilesFromParameters(toolCall.parameters);
      const selectedInputKeys =
        inputFiles.length > 0
          ? inputFiles
              .map((inputFile) => inputKeyByPath.get(inputFile) ?? null)
              .filter((inputKey): inputKey is string => Boolean(inputKey))
          : inputContractInputs.map((entry) => entry.input_key);

      recipeSteps.push({
        config: {
          analysis_goal:
            selectedTurn.userPromptText.trim() ||
            toolCall.resultSummary?.trim() ||
            "Run the workflow analysis objective.",
          ...(inputFiles.length > 0 ? { input_files: [...new Set(inputFiles)] } : {}),
          python_code: analysisCode,
          result_key: outputKey,
        },
        input_refs: [...new Set(selectedInputKeys)].map((inputKey) => ({
          input_key: inputKey,
          type: "workflow_input" as const,
        })),
        kind: "analysis",
        step_key: stepKey,
        tool: "run_data_analysis",
      });

      lastAnalysisStepRef = {
        outputKey,
        stepKey,
      };
      continue;
    }

    if (toolCall.toolName === "generate_visual_graph") {
      const chartTypeValue = toolCall.parameters.chartType;
      const chartType =
        chartTypeValue === "line" || chartTypeValue === "bar" || chartTypeValue === "scatter"
          ? chartTypeValue
          : "line";
      const titleValue =
        typeof toolCall.parameters.title === "string" && toolCall.parameters.title.trim()
          ? toolCall.parameters.title.trim()
          : `${deriveSuggestedWorkflowName(selectedTurn.userPromptText, selectedTurn.createdAt)} chart`;

      const chartCode =
        typeof toolCall.parameters.code === "string" && toolCall.parameters.code.trim()
          ? toolCall.parameters.code.trim()
          : null;

      if (!chartCode) {
        continue;
      }

      chartToolCallCount += 1;
      const chartInputFiles = extractInputFilesFromParameters(toolCall.parameters);
      const selectedInputKeys =
        chartInputFiles.length > 0
          ? chartInputFiles
              .map((inputFile) => inputKeyByPath.get(inputFile) ?? null)
              .filter((inputKey): inputKey is string => Boolean(inputKey))
          : inputContractInputs.map((entry) => entry.input_key);
      const stepKey = `chart_${chartToolCallCount}`;

      recipeSteps.push({
        config: {
          chart_type: chartType,
          ...(chartInputFiles.length > 0
            ? { input_files: [...new Set(chartInputFiles)] }
            : {}),
          python_code: chartCode,
          title: titleValue,
        },
        input_refs: lastAnalysisStepRef
          ? [
              {
                output_key: lastAnalysisStepRef.outputKey,
                step_key: lastAnalysisStepRef.stepKey,
                type: "step_output" as const,
              },
            ]
          : [...new Set(selectedInputKeys)].map((inputKey) => ({
              input_key: inputKey,
              type: "workflow_input" as const,
            })),
        kind: "chart",
        step_key: stepKey,
        tool: "generate_visual_graph",
      });
      continue;
    }

    if (toolCall.toolName === "generate_document") {
      if (!lastAnalysisStepRef) {
        continue;
      }

      const documentCode =
        typeof toolCall.parameters.code === "string" && toolCall.parameters.code.trim()
          ? toolCall.parameters.code.trim()
          : null;

      if (!documentCode) {
        continue;
      }

      documentToolCallCount += 1;
      const documentInputFiles = extractInputFilesFromParameters(toolCall.parameters);

      recipeSteps.push({
        config: {
          ...(documentInputFiles.length > 0
            ? { input_files: [...new Set(documentInputFiles)] }
            : {}),
          python_code: documentCode,
          template: "summary_v1",
          title: `${deriveSuggestedWorkflowName(selectedTurn.userPromptText, selectedTurn.createdAt)} brief`,
        },
        input_refs: [
          {
            output_key: lastAnalysisStepRef.outputKey,
            step_key: lastAnalysisStepRef.stepKey,
            type: "step_output",
          },
        ],
        kind: "document",
        step_key: `document_${documentToolCallCount}`,
        tool: "generate_document",
      });
    }
  }

  ensureWorkflowRecipeHasExecutableSteps(recipeSteps.length);

  const sandboxRunIds = [...new Set(
    relevantToolCalls
      .map((toolCall) => toolCall.sandboxRunId)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )];
  const selectedToolCallIds = relevantToolCalls.map((toolCall) => toolCall.runtimeToolCallId);

  const versionPayload: WorkflowDraftVersionPayload = {
    delivery: {
      channels: [],
      retry_policy: {
        backoff_multiplier: 2,
        initial_backoff_seconds: 30,
        max_attempts: 3,
      },
      schema_version: 1,
    },
    executionIdentity: {
      mode: "fixed_membership_user",
      on_identity_invalid: "block_run",
      recheck_at_enqueue: true,
      recheck_at_execution: true,
      required_membership_roles: ["admin", "owner"],
      require_membership_status: "active",
      run_as_user_id: input.userId,
      schema_version: 1,
    },
    inputBindings: {
      bindings: inputBindings,
      schema_version: 1,
    },
    inputContract: {
      inputs: inputContractInputs,
      schema_version: 1,
    },
    outputs: {
      include_sections: [
        "input_summary",
        "validation",
        "kpi_changes",
        "threshold_breaches",
        "artifacts",
      ],
      schema_version: 1,
      summary_template: "standard_v1",
    },
    provenance: {
      chat_turn: {
        ...(analysisResultRow?.id ? { analysis_result_id: analysisResultRow.id } : {}),
        conversation_id: selectedTurn.conversationId,
        sandbox_run_ids: sandboxRunIds,
        tool_call_ids: selectedToolCallIds,
        turn_id: selectedTurn.id,
      },
      ...(unresolvedInputPaths.length > 0
        ? {
            note: `Fallback asset_selector bindings were generated for ${unresolvedInputPaths.length} input path(s) that could not be registered as stable assets during draft creation.`,
          }
        : {}),
      schema_version: 1,
      source_kind: "chat_turn",
    },
    recipe: {
      schema_version: 1,
      steps: recipeSteps,
    },
    schedule: {
      kind: "manual_only",
      schema_version: 1,
    },
    thresholds: {
      rules: [],
      schema_version: 1,
    },
  };

  const suggestedName = deriveSuggestedWorkflowName(
    selectedTurn.userPromptText,
    selectedTurn.createdAt,
  );

  const draft: WorkflowDraftFromChatTurn = {
    conversationId: selectedTurn.conversationId,
    inputFilePaths: inputPaths,
    sourceSummary: {
      analysisToolCallCount,
      chartToolCallCount,
      documentToolCallCount,
      sandboxRunIds,
      selectedToolCallIds,
    },
    status: "draft",
    suggestedDescription: `Generated from chat turn ${selectedTurn.id} on ${new Date(selectedTurn.createdAt).toISOString()}.`,
    suggestedName,
    turnId: selectedTurn.id,
    unresolvedInputPaths,
    version: versionPayload,
    visibility: "organization",
  };

  return {
    draft,
  };
}
