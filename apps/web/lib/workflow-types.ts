export const WORKFLOW_JSON_SCHEMA_VERSION = 1 as const;

export const WORKFLOW_VISIBILITIES = ["private", "organization"] as const;
export const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const;
export const WORKFLOW_RUN_TRIGGER_KINDS = ["manual", "scheduled", "resume"] as const;
export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_for_input",
  "blocked_validation",
  "completed",
  "failed",
  "cancelled",
] as const;
export const WORKFLOW_RUN_STEP_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;
export const WORKFLOW_INPUT_CHECK_STATUSES = ["pass", "warn", "fail"] as const;
export const WORKFLOW_INPUT_REQUEST_STATUSES = [
  "open",
  "sent",
  "fulfilled",
  "expired",
  "cancelled",
] as const;
export const WORKFLOW_DELIVERY_CHANNEL_KINDS = [
  "webhook",
  "chart_pack",
  "ranked_table",
  "generated_document",
  "email",
] as const;
export const WORKFLOW_DELIVERY_STATUSES = ["pending", "sent", "failed"] as const;

export type WorkflowVisibility = (typeof WORKFLOW_VISIBILITIES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type WorkflowRunTriggerKind = (typeof WORKFLOW_RUN_TRIGGER_KINDS)[number];
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export type WorkflowRunStepStatus = (typeof WORKFLOW_RUN_STEP_STATUSES)[number];
export type WorkflowInputCheckStatus = (typeof WORKFLOW_INPUT_CHECK_STATUSES)[number];
export type WorkflowInputRequestStatus = (typeof WORKFLOW_INPUT_REQUEST_STATUSES)[number];
export type WorkflowDeliveryChannelKind = (typeof WORKFLOW_DELIVERY_CHANNEL_KINDS)[number];
export type WorkflowDeliveryStatus = (typeof WORKFLOW_DELIVERY_STATUSES)[number];

export function isWorkflowVisibility(value: unknown): value is WorkflowVisibility {
  return typeof value === "string" && WORKFLOW_VISIBILITIES.includes(value as WorkflowVisibility);
}

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return typeof value === "string" && WORKFLOW_STATUSES.includes(value as WorkflowStatus);
}

export function isWorkflowRunTriggerKind(value: unknown): value is WorkflowRunTriggerKind {
  return (
    typeof value === "string" &&
    WORKFLOW_RUN_TRIGGER_KINDS.includes(value as WorkflowRunTriggerKind)
  );
}

export function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return typeof value === "string" && WORKFLOW_RUN_STATUSES.includes(value as WorkflowRunStatus);
}

export type WorkflowInputFreshnessRuleV1 =
  | {
      kind: "max_document_age_hours";
      max_age_hours: number;
    }
  | {
      kind: "max_column_age_days";
      column: string;
      max_age_days: number;
      date_format?: "auto" | "iso8601";
    };

export type WorkflowInputSpecV1 = {
  allowed_mime_types: string[];
  csv_rules?: {
    freshness?: WorkflowInputFreshnessRuleV1;
    max_null_ratio_by_column?: Record<string, number>;
    min_row_count?: number;
    required_columns?: string[];
  };
  data_kind: "table" | "text_document";
  duplicate_policy?: {
    lookback_successful_runs: number;
    mode: "allow" | "warn_if_unchanged" | "block_if_unchanged";
  };
  input_key: string;
  label: string;
  multiplicity: "one" | "many";
  required: boolean;
};

export type WorkflowInputContractV1 = {
  inputs: WorkflowInputSpecV1[];
  schema_version: 1;
};

export type WorkflowInputBindingSelectorV1 = {
  access_scope_in?: Array<"public" | "admin">;
  display_name_equals?: string;
  display_name_regex?: string;
  mime_type_in?: string[];
  source_type_in?: Array<"uploaded" | "bulk_import">;
  uploaded_by_user_id?: string;
};

export type WorkflowInputBindingV1 = {
  binding:
    | {
        document_id: string;
        kind: "document_id";
        lock_to_content_sha256?: string | null;
      }
    | {
        kind: "selector";
        max_documents: number;
        selection: "latest_updated_at" | "latest_indexed_at" | "all_matching";
        selector: WorkflowInputBindingSelectorV1;
      };
  input_key: string;
};

export type WorkflowInputBindingsV1 = {
  bindings: WorkflowInputBindingV1[];
  schema_version: 1;
};

export type WorkflowStepInputRefV1 =
  | { input_key: string; type: "workflow_input" }
  | { output_key: string; step_key: string; type: "step_output" };

export type WorkflowStepV1 =
  | {
      config: {
        analysis_goal: string;
        input_files?: string[];
        python_code?: string;
        result_key: string;
      };
      input_refs: Array<{ input_key: string; type: "workflow_input" }>;
      kind: "analysis";
      step_key: string;
      tool: "run_data_analysis";
    }
  | {
      config: {
        chart_type: "line" | "bar" | "scatter" | "area";
        input_files?: string[];
        python_code?: string;
        title: string;
      };
      input_refs: Array<{ output_key: string; step_key: string; type: "step_output" }>;
      kind: "chart";
      step_key: string;
      tool: "generate_visual_graph";
    }
  | {
      config: {
        input_files?: string[];
        python_code?: string;
        template: "summary_v1" | "brief_v1";
        title: string;
      };
      input_refs: Array<{ output_key: string; step_key: string; type: "step_output" }>;
      kind: "document";
      step_key: string;
      tool: "generate_document";
    };

export type WorkflowRecipeV1 = {
  schema_version: 1;
  steps: WorkflowStepV1[];
};

export type WorkflowThresholdRuleV1 = {
  metric: { path: string; step_key: string };
  on_breach: "include_in_summary" | "mark_run_failed";
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
  rule_key: string;
  severity: "info" | "warning" | "critical";
  target_number: number;
};

export type WorkflowThresholdsV1 = {
  rules: WorkflowThresholdRuleV1[];
  schema_version: 1;
};

export type WorkflowOutputsV1 = {
  include_sections?: Array<
    "input_summary" | "validation" | "kpi_changes" | "threshold_breaches" | "artifacts"
  >;
  schema_version: 1;
  summary_template: "standard_v1";
  table_outputs?: Array<{
    format: "csv" | "markdown";
    output_key: string;
    step_key: string;
  }>;
};

export type WorkflowDeliveryChannelV1 =
  | {
      endpoint_id: string;
      kind: "webhook";
      signing: "hmac_sha256";
    }
  | {
      kind: "chart_pack";
    }
  | {
      format: "csv" | "markdown";
      kind: "ranked_table";
      output_key: string;
    }
  | {
      kind: "generated_document";
      template: "summary_pdf_v1";
    }
  | {
      enabled: boolean;
      kind: "email";
      recipients: string[];
    };

export type WorkflowDeliveryV1 = {
  channels: WorkflowDeliveryChannelV1[];
  retry_policy: {
    backoff_multiplier: number;
    initial_backoff_seconds: number;
    max_attempts: number;
  };
  schema_version: 1;
};

export type WorkflowScheduleV1 =
  | {
      kind: "manual_only";
      schema_version: 1;
    }
  | {
      cadence:
        | {
            day_of_week: 0 | 1 | 2 | 3 | 4 | 5 | 6;
            hour: number;
            kind: "weekly";
            minute: number;
          }
        | {
            day_of_month:
              | 1
              | 2
              | 3
              | 4
              | 5
              | 6
              | 7
              | 8
              | 9
              | 10
              | 11
              | 12
              | 13
              | 14
              | 15
              | 16
              | 17
              | 18
              | 19
              | 20
              | 21
              | 22
              | 23
              | 24
              | 25
              | 26
              | 27
              | 28;
            hour: number;
            kind: "monthly";
            minute: number;
          };
      catch_up_policy: "enqueue_missed_windows";
      kind: "recurring";
      schema_version: 1;
      timezone: string;
    };

export type WorkflowExecutionIdentityV1 = {
  mode: "fixed_membership_user";
  on_identity_invalid: "block_run";
  recheck_at_enqueue: true;
  recheck_at_execution: true;
  required_membership_roles: Array<"admin" | "owner">;
  require_membership_status: "active";
  run_as_user_id: string;
  schema_version: 1;
};

export type WorkflowProvenanceV1 = {
  chat_turn?: {
    analysis_result_id?: string;
    conversation_id: string;
    sandbox_run_ids: string[];
    tool_call_ids: string[];
    turn_id: string;
  };
  note?: string;
  schema_version: 1;
  source_kind: "chat_turn" | "manual_builder";
};

export type WorkflowRunInputCheckReportV1 = {
  checked_at: number;
  checks: Array<{
    code:
      | "missing_required_input"
      | "column_missing"
      | "row_count_below_minimum"
      | "freshness_sla_failed"
      | "duplicate_unchanged_input"
      | "null_ratio_exceeded";
    details?: Record<string, unknown>;
    message: string;
    status: WorkflowInputCheckStatus;
  }>;
  input_key: string;
  resolved_documents: Array<{
    content_sha256: string;
    display_name: string;
    document_id: string;
    mime_type: string | null;
    updated_at: number;
  }>;
  schema_version: 1;
  status: WorkflowInputCheckStatus;
};

export type WorkflowDeliverySnapshotV1 = {
  artifacts: Array<{
    asset_id: string;
    byte_size: number;
    content_sha256?: string;
    file_name: string;
    mime_type: string;
    storage_path: string;
  }>;
  execution_identity: {
    run_as_role: "member" | "admin" | "owner";
    run_as_user_id: string;
  };
  inputs: Array<{
    content_sha256: string;
    display_name: string;
    document_id: string;
    input_key: string;
    mime_type: string | null;
  }>;
  run: {
    completed_at: number | null;
    id: string;
    started_at: number | null;
    status: string;
    trigger_kind: WorkflowRunTriggerKind;
    trigger_window_key: string | null;
  };
  schema_version: 1;
  steps: Array<{
    duration_ms: number | null;
    sandbox_run_id: string | null;
    status: string;
    step_key: string;
    tool: string;
  }>;
  thresholds: Array<{
    rule_key: string;
    severity: "info" | "warning" | "critical";
    status: "pass" | "breach";
  }>;
  validation_summary: {
    failed_check_count: number;
    status: WorkflowInputCheckStatus;
    warning_check_count: number;
  };
  workflow: {
    id: string;
    name: string;
    version_id: string;
  };
};

export type WorkflowVersionContractsV1 = {
  delivery: WorkflowDeliveryV1;
  executionIdentity: WorkflowExecutionIdentityV1;
  inputBindings: WorkflowInputBindingsV1;
  inputContract: WorkflowInputContractV1;
  outputs: WorkflowOutputsV1;
  provenance: WorkflowProvenanceV1;
  recipe: WorkflowRecipeV1;
  schedule: WorkflowScheduleV1;
  thresholds: WorkflowThresholdsV1;
};

export class WorkflowContractValidationError extends Error {
  readonly code: string;
  readonly contractName: string;

  constructor(contractName: string, message: string, code = "invalid_contract") {
    super(message);
    this.code = code;
    this.contractName = contractName;
    this.name = "WorkflowContractValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRoot(value: string | unknown, contractName: string) {
  const parsedValue =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            throw new WorkflowContractValidationError(
              contractName,
              `${contractName} must be valid JSON.`,
              "invalid_json",
            );
          }
        })()
      : value;

  if (!isRecord(parsedValue)) {
    throw new WorkflowContractValidationError(
      contractName,
      `${contractName} must be a JSON object.`,
      "invalid_shape",
    );
  }

  const schemaVersion = parsedValue.schema_version;

  if (schemaVersion !== WORKFLOW_JSON_SCHEMA_VERSION) {
    throw new WorkflowContractValidationError(
      contractName,
      `${contractName} must use schema_version ${WORKFLOW_JSON_SCHEMA_VERSION}.`,
      "unsupported_schema_version",
    );
  }

  return parsedValue;
}

function parseStringValue(
  value: unknown,
  path: string,
  contractName: string,
  options?: { allowEmpty?: boolean },
) {
  if (typeof value !== "string") {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be a string.`,
      "invalid_field",
    );
  }

  const normalized = value.trim();

  if (!options?.allowEmpty && normalized.length === 0) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must not be empty.`,
      "invalid_field",
    );
  }

  return normalized;
}

function parseOptionalStringValue(
  value: unknown,
  path: string,
  contractName: string,
) {
  if (typeof value === "undefined") {
    return undefined;
  }

  return parseStringValue(value, path, contractName);
}

function parseBooleanValue(value: unknown, path: string, contractName: string) {
  if (typeof value !== "boolean") {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be a boolean.`,
      "invalid_field",
    );
  }

  return value;
}

function parseIntegerValue(
  value: unknown,
  path: string,
  contractName: string,
  options?: { max?: number; min?: number },
) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be an integer.`,
      "invalid_field",
    );
  }

  if (typeof options?.min === "number" && value < options.min) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be >= ${options.min}.`,
      "invalid_field",
    );
  }

  if (typeof options?.max === "number" && value > options.max) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be <= ${options.max}.`,
      "invalid_field",
    );
  }

  return value;
}

function parseNumberValue(
  value: unknown,
  path: string,
  contractName: string,
  options?: { max?: number; min?: number },
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be a number.`,
      "invalid_field",
    );
  }

  if (typeof options?.min === "number" && value < options.min) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be >= ${options.min}.`,
      "invalid_field",
    );
  }

  if (typeof options?.max === "number" && value > options.max) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be <= ${options.max}.`,
      "invalid_field",
    );
  }

  return value;
}

function parseStringArrayValue(
  value: unknown,
  path: string,
  contractName: string,
  options?: { allowEmpty?: boolean; unique?: boolean },
) {
  if (!Array.isArray(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be an array.`,
      "invalid_field",
    );
  }

  const parsed = value.map((entry, index) =>
    parseStringValue(entry, `${path}[${index}]`, contractName),
  );

  if (!options?.allowEmpty && parsed.length === 0) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must not be empty.`,
      "invalid_field",
    );
  }

  return options?.unique ? [...new Set(parsed)] : parsed;
}

function parseEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  contractName: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `${path} must be one of: ${allowed.join(", ")}.`,
      "invalid_field",
    );
  }

  return value as T[number];
}

function parseInputSpec(
  value: unknown,
  index: number,
  contractName: string,
): WorkflowInputSpecV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `inputs[${index}] must be an object.`,
      "invalid_field",
    );
  }

  const parsed: WorkflowInputSpecV1 = {
    allowed_mime_types: parseStringArrayValue(
      value.allowed_mime_types,
      `inputs[${index}].allowed_mime_types`,
      contractName,
      { unique: true },
    ),
    data_kind: parseEnumValue(
      value.data_kind,
      ["table", "text_document"] as const,
      `inputs[${index}].data_kind`,
      contractName,
    ),
    input_key: parseStringValue(value.input_key, `inputs[${index}].input_key`, contractName),
    label: parseStringValue(value.label, `inputs[${index}].label`, contractName),
    multiplicity: parseEnumValue(
      value.multiplicity,
      ["one", "many"] as const,
      `inputs[${index}].multiplicity`,
      contractName,
    ),
    required: parseBooleanValue(value.required, `inputs[${index}].required`, contractName),
  };

  if (typeof value.csv_rules !== "undefined") {
    if (!isRecord(value.csv_rules)) {
      throw new WorkflowContractValidationError(
        contractName,
        `inputs[${index}].csv_rules must be an object.`,
        "invalid_field",
      );
    }

    const csvRules: NonNullable<WorkflowInputSpecV1["csv_rules"]> = {};

    if (typeof value.csv_rules.required_columns !== "undefined") {
      csvRules.required_columns = parseStringArrayValue(
        value.csv_rules.required_columns,
        `inputs[${index}].csv_rules.required_columns`,
        contractName,
        { allowEmpty: true, unique: true },
      );
    }

    if (typeof value.csv_rules.min_row_count !== "undefined") {
      csvRules.min_row_count = parseIntegerValue(
        value.csv_rules.min_row_count,
        `inputs[${index}].csv_rules.min_row_count`,
        contractName,
        { min: 1 },
      );
    }

    if (typeof value.csv_rules.max_null_ratio_by_column !== "undefined") {
      if (!isRecord(value.csv_rules.max_null_ratio_by_column)) {
        throw new WorkflowContractValidationError(
          contractName,
          `inputs[${index}].csv_rules.max_null_ratio_by_column must be an object.`,
          "invalid_field",
        );
      }

      const ratioByColumn: Record<string, number> = {};

      for (const [columnName, ratio] of Object.entries(value.csv_rules.max_null_ratio_by_column)) {
        ratioByColumn[parseStringValue(
          columnName,
          `inputs[${index}].csv_rules.max_null_ratio_by_column.<key>`,
          contractName,
        )] = parseNumberValue(
          ratio,
          `inputs[${index}].csv_rules.max_null_ratio_by_column.${columnName}`,
          contractName,
          { min: 0, max: 1 },
        );
      }

      csvRules.max_null_ratio_by_column = ratioByColumn;
    }

    if (typeof value.csv_rules.freshness !== "undefined") {
      if (!isRecord(value.csv_rules.freshness)) {
        throw new WorkflowContractValidationError(
          contractName,
          `inputs[${index}].csv_rules.freshness must be an object.`,
          "invalid_field",
        );
      }

      const freshnessKind = parseEnumValue(
        value.csv_rules.freshness.kind,
        ["max_document_age_hours", "max_column_age_days"] as const,
        `inputs[${index}].csv_rules.freshness.kind`,
        contractName,
      );

      if (freshnessKind === "max_document_age_hours") {
        csvRules.freshness = {
          kind: "max_document_age_hours",
          max_age_hours: parseIntegerValue(
            value.csv_rules.freshness.max_age_hours,
            `inputs[${index}].csv_rules.freshness.max_age_hours`,
            contractName,
            { min: 1 },
          ),
        };
      } else {
        const dateFormat =
          typeof value.csv_rules.freshness.date_format === "undefined"
            ? undefined
            : parseEnumValue(
                value.csv_rules.freshness.date_format,
                ["auto", "iso8601"] as const,
                `inputs[${index}].csv_rules.freshness.date_format`,
                contractName,
              );

        csvRules.freshness = {
          column: parseStringValue(
            value.csv_rules.freshness.column,
            `inputs[${index}].csv_rules.freshness.column`,
            contractName,
          ),
          ...(dateFormat ? { date_format: dateFormat } : {}),
          kind: "max_column_age_days",
          max_age_days: parseIntegerValue(
            value.csv_rules.freshness.max_age_days,
            `inputs[${index}].csv_rules.freshness.max_age_days`,
            contractName,
            { min: 1 },
          ),
        };
      }
    }

    parsed.csv_rules = csvRules;
  }

  if (typeof value.duplicate_policy !== "undefined") {
    if (!isRecord(value.duplicate_policy)) {
      throw new WorkflowContractValidationError(
        contractName,
        `inputs[${index}].duplicate_policy must be an object.`,
        "invalid_field",
      );
    }

    parsed.duplicate_policy = {
      lookback_successful_runs: parseIntegerValue(
        value.duplicate_policy.lookback_successful_runs,
        `inputs[${index}].duplicate_policy.lookback_successful_runs`,
        contractName,
        { max: 20, min: 1 },
      ),
      mode: parseEnumValue(
        value.duplicate_policy.mode,
        ["allow", "warn_if_unchanged", "block_if_unchanged"] as const,
        `inputs[${index}].duplicate_policy.mode`,
        contractName,
      ),
    };
  }

  return parsed;
}

export function parseWorkflowInputContractJson(value: string | unknown): WorkflowInputContractV1 {
  const contractName = "workflow.input_contract";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.inputs)) {
    throw new WorkflowContractValidationError(
      contractName,
      "inputs must be an array.",
      "invalid_field",
    );
  }

  const inputs = root.inputs.map((entry, index) => parseInputSpec(entry, index, contractName));
  const inputKeys = new Set<string>();

  for (const input of inputs) {
    if (inputKeys.has(input.input_key)) {
      throw new WorkflowContractValidationError(
        contractName,
        `Duplicate input_key: ${input.input_key}`,
        "duplicate_key",
      );
    }

    inputKeys.add(input.input_key);
  }

  return {
    inputs,
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
  };
}

function parseInputBinding(
  value: unknown,
  index: number,
  contractName: string,
): WorkflowInputBindingV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `bindings[${index}] must be an object.`,
      "invalid_field",
    );
  }

  const inputKey = parseStringValue(value.input_key, `bindings[${index}].input_key`, contractName);

  if (!isRecord(value.binding)) {
    throw new WorkflowContractValidationError(
      contractName,
      `bindings[${index}].binding must be an object.`,
      "invalid_field",
    );
  }

  const bindingKind = parseEnumValue(
    value.binding.kind,
    ["document_id", "selector"] as const,
    `bindings[${index}].binding.kind`,
    contractName,
  );

  if (bindingKind === "document_id") {
    const lockSha =
      typeof value.binding.lock_to_content_sha256 === "undefined"
        ? undefined
        : value.binding.lock_to_content_sha256 === null
          ? null
          : parseStringValue(
              value.binding.lock_to_content_sha256,
              `bindings[${index}].binding.lock_to_content_sha256`,
              contractName,
            );

    return {
      binding: {
        document_id: parseStringValue(
          value.binding.document_id,
          `bindings[${index}].binding.document_id`,
          contractName,
        ),
        kind: "document_id",
        ...(typeof lockSha === "undefined" ? {} : { lock_to_content_sha256: lockSha }),
      },
      input_key: inputKey,
    };
  }

  if (!isRecord(value.binding.selector)) {
    throw new WorkflowContractValidationError(
      contractName,
      `bindings[${index}].binding.selector must be an object.`,
      "invalid_field",
    );
  }

  const selector: WorkflowInputBindingSelectorV1 = {};

  if (typeof value.binding.selector.access_scope_in !== "undefined") {
    const values = parseStringArrayValue(
      value.binding.selector.access_scope_in,
      `bindings[${index}].binding.selector.access_scope_in`,
      contractName,
      { allowEmpty: true, unique: true },
    ).map((entry) =>
      parseEnumValue(
        entry,
        ["public", "admin"] as const,
        `bindings[${index}].binding.selector.access_scope_in[]`,
        contractName,
      ),
    );

    selector.access_scope_in = values;
  }

  if (typeof value.binding.selector.source_type_in !== "undefined") {
    const values = parseStringArrayValue(
      value.binding.selector.source_type_in,
      `bindings[${index}].binding.selector.source_type_in`,
      contractName,
      { allowEmpty: true, unique: true },
    ).map((entry) =>
      parseEnumValue(
        entry,
        ["uploaded", "bulk_import"] as const,
        `bindings[${index}].binding.selector.source_type_in[]`,
        contractName,
      ),
    );

    selector.source_type_in = values;
  }

  if (typeof value.binding.selector.mime_type_in !== "undefined") {
    selector.mime_type_in = parseStringArrayValue(
      value.binding.selector.mime_type_in,
      `bindings[${index}].binding.selector.mime_type_in`,
      contractName,
      { allowEmpty: true, unique: true },
    );
  }

  const displayNameEquals = parseOptionalStringValue(
    value.binding.selector.display_name_equals,
    `bindings[${index}].binding.selector.display_name_equals`,
    contractName,
  );

  if (displayNameEquals) {
    selector.display_name_equals = displayNameEquals;
  }

  const displayNameRegex = parseOptionalStringValue(
    value.binding.selector.display_name_regex,
    `bindings[${index}].binding.selector.display_name_regex`,
    contractName,
  );

  if (displayNameRegex) {
    selector.display_name_regex = displayNameRegex;
  }

  const uploadedBy = parseOptionalStringValue(
    value.binding.selector.uploaded_by_user_id,
    `bindings[${index}].binding.selector.uploaded_by_user_id`,
    contractName,
  );

  if (uploadedBy) {
    selector.uploaded_by_user_id = uploadedBy;
  }

  return {
    binding: {
      kind: "selector",
      max_documents: parseIntegerValue(
        value.binding.max_documents,
        `bindings[${index}].binding.max_documents`,
        contractName,
        { min: 1 },
      ),
      selection: parseEnumValue(
        value.binding.selection,
        ["latest_updated_at", "latest_indexed_at", "all_matching"] as const,
        `bindings[${index}].binding.selection`,
        contractName,
      ),
      selector,
    },
    input_key: inputKey,
  };
}

export function parseWorkflowInputBindingsJson(value: string | unknown): WorkflowInputBindingsV1 {
  const contractName = "workflow.input_bindings";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.bindings)) {
    throw new WorkflowContractValidationError(
      contractName,
      "bindings must be an array.",
      "invalid_field",
    );
  }

  const bindings = root.bindings.map((entry, index) => parseInputBinding(entry, index, contractName));
  const keys = new Set<string>();

  for (const binding of bindings) {
    if (keys.has(binding.input_key)) {
      throw new WorkflowContractValidationError(
        contractName,
        `Duplicate binding input_key: ${binding.input_key}`,
        "duplicate_key",
      );
    }

    keys.add(binding.input_key);
  }

  return {
    bindings,
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
  };
}

function parseStepInputRef(
  value: unknown,
  path: string,
  contractName: string,
): WorkflowStepInputRefV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(contractName, `${path} must be an object.`, "invalid_field");
  }

  const refType = parseEnumValue(value.type, ["workflow_input", "step_output"] as const, `${path}.type`, contractName);

  if (refType === "workflow_input") {
    return {
      input_key: parseStringValue(value.input_key, `${path}.input_key`, contractName),
      type: "workflow_input",
    };
  }

  return {
    output_key: parseStringValue(value.output_key, `${path}.output_key`, contractName),
    step_key: parseStringValue(value.step_key, `${path}.step_key`, contractName),
    type: "step_output",
  };
}

function parseWorkflowStep(value: unknown, index: number, contractName: string): WorkflowStepV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `steps[${index}] must be an object.`,
      "invalid_field",
    );
  }

  const stepKey = parseStringValue(value.step_key, `steps[${index}].step_key`, contractName);
  const kind = parseEnumValue(
    value.kind,
    ["analysis", "chart", "document"] as const,
    `steps[${index}].kind`,
    contractName,
  );

  if (!Array.isArray(value.input_refs)) {
    throw new WorkflowContractValidationError(
      contractName,
      `steps[${index}].input_refs must be an array.`,
      "invalid_field",
    );
  }

  const refs = value.input_refs.map((entry, refIndex) =>
    parseStepInputRef(entry, `steps[${index}].input_refs[${refIndex}]`, contractName),
  );

  if (!isRecord(value.config)) {
    throw new WorkflowContractValidationError(
      contractName,
      `steps[${index}].config must be an object.`,
      "invalid_field",
    );
  }

  if (kind === "analysis") {
    const tool = parseEnumValue(
      value.tool,
      ["run_data_analysis"] as const,
      `steps[${index}].tool`,
      contractName,
    );

    const analysisRefs = refs.map((ref) => {
      if (ref.type !== "workflow_input") {
        throw new WorkflowContractValidationError(
          contractName,
          `steps[${index}] analysis refs must use workflow_input.`,
          "invalid_field",
        );
      }

      return ref;
    });

    const pythonCode = parseOptionalStringValue(
      value.config.python_code,
      `steps[${index}].config.python_code`,
      contractName,
    );
    const inputFiles =
      typeof value.config.input_files === "undefined"
        ? undefined
        : parseStringArrayValue(
            value.config.input_files,
            `steps[${index}].config.input_files`,
            contractName,
            {
              allowEmpty: true,
              unique: true,
            },
          );

    return {
      config: {
        analysis_goal: parseStringValue(
          value.config.analysis_goal,
          `steps[${index}].config.analysis_goal`,
          contractName,
        ),
        ...(typeof inputFiles === "undefined" ? {} : { input_files: inputFiles }),
        ...(typeof pythonCode === "undefined" ? {} : { python_code: pythonCode }),
        result_key: parseStringValue(
          value.config.result_key,
          `steps[${index}].config.result_key`,
          contractName,
        ),
      },
      input_refs: analysisRefs,
      kind,
      step_key: stepKey,
      tool,
    };
  }

  if (kind === "chart") {
    const tool = parseEnumValue(
      value.tool,
      ["generate_visual_graph"] as const,
      `steps[${index}].tool`,
      contractName,
    );

    const chartRefs = refs.map((ref) => {
      if (ref.type !== "step_output") {
        throw new WorkflowContractValidationError(
          contractName,
          `steps[${index}] chart refs must use step_output.`,
          "invalid_field",
        );
      }

      return ref;
    });

    const pythonCode = parseOptionalStringValue(
      value.config.python_code,
      `steps[${index}].config.python_code`,
      contractName,
    );
    const inputFiles =
      typeof value.config.input_files === "undefined"
        ? undefined
        : parseStringArrayValue(
            value.config.input_files,
            `steps[${index}].config.input_files`,
            contractName,
            {
              allowEmpty: true,
              unique: true,
            },
          );

    return {
      config: {
        chart_type: parseEnumValue(
          value.config.chart_type,
          ["line", "bar", "scatter", "area"] as const,
          `steps[${index}].config.chart_type`,
          contractName,
        ),
        ...(typeof inputFiles === "undefined" ? {} : { input_files: inputFiles }),
        ...(typeof pythonCode === "undefined" ? {} : { python_code: pythonCode }),
        title: parseStringValue(value.config.title, `steps[${index}].config.title`, contractName),
      },
      input_refs: chartRefs,
      kind,
      step_key: stepKey,
      tool,
    };
  }

  const tool = parseEnumValue(
    value.tool,
    ["generate_document"] as const,
    `steps[${index}].tool`,
    contractName,
  );

  const documentRefs = refs.map((ref) => {
    if (ref.type !== "step_output") {
      throw new WorkflowContractValidationError(
        contractName,
        `steps[${index}] document refs must use step_output.`,
        "invalid_field",
      );
    }

    return ref;
  });

  const pythonCode = parseOptionalStringValue(
    value.config.python_code,
    `steps[${index}].config.python_code`,
    contractName,
  );
  const inputFiles =
    typeof value.config.input_files === "undefined"
      ? undefined
      : parseStringArrayValue(
          value.config.input_files,
          `steps[${index}].config.input_files`,
          contractName,
          {
            allowEmpty: true,
            unique: true,
          },
        );

  return {
    config: {
      ...(typeof inputFiles === "undefined" ? {} : { input_files: inputFiles }),
      ...(typeof pythonCode === "undefined" ? {} : { python_code: pythonCode }),
      template: parseEnumValue(
        value.config.template,
        ["summary_v1", "brief_v1"] as const,
        `steps[${index}].config.template`,
        contractName,
      ),
      title: parseStringValue(value.config.title, `steps[${index}].config.title`, contractName),
    },
    input_refs: documentRefs,
    kind,
    step_key: stepKey,
    tool,
  };
}

export function parseWorkflowRecipeJson(value: string | unknown): WorkflowRecipeV1 {
  const contractName = "workflow.recipe";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.steps)) {
    throw new WorkflowContractValidationError(
      contractName,
      "steps must be an array.",
      "invalid_field",
    );
  }

  const steps = root.steps.map((entry, index) => parseWorkflowStep(entry, index, contractName));
  const seenStepKeys = new Set<string>();

  for (const step of steps) {
    if (seenStepKeys.has(step.step_key)) {
      throw new WorkflowContractValidationError(
        contractName,
        `Duplicate step_key: ${step.step_key}`,
        "duplicate_key",
      );
    }

    seenStepKeys.add(step.step_key);
  }

  return {
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    steps,
  };
}

function parseThresholdRule(value: unknown, index: number, contractName: string): WorkflowThresholdRuleV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `rules[${index}] must be an object.`,
      "invalid_field",
    );
  }

  if (!isRecord(value.metric)) {
    throw new WorkflowContractValidationError(
      contractName,
      `rules[${index}].metric must be an object.`,
      "invalid_field",
    );
  }

  return {
    metric: {
      path: parseStringValue(value.metric.path, `rules[${index}].metric.path`, contractName),
      step_key: parseStringValue(value.metric.step_key, `rules[${index}].metric.step_key`, contractName),
    },
    on_breach: parseEnumValue(
      value.on_breach,
      ["include_in_summary", "mark_run_failed"] as const,
      `rules[${index}].on_breach`,
      contractName,
    ),
    operator: parseEnumValue(
      value.operator,
      ["<", "<=", ">", ">=", "==", "!="] as const,
      `rules[${index}].operator`,
      contractName,
    ),
    rule_key: parseStringValue(value.rule_key, `rules[${index}].rule_key`, contractName),
    severity: parseEnumValue(
      value.severity,
      ["info", "warning", "critical"] as const,
      `rules[${index}].severity`,
      contractName,
    ),
    target_number: parseNumberValue(value.target_number, `rules[${index}].target_number`, contractName),
  };
}

export function parseWorkflowThresholdsJson(value: string | unknown): WorkflowThresholdsV1 {
  const contractName = "workflow.thresholds";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.rules)) {
    throw new WorkflowContractValidationError(
      contractName,
      "rules must be an array.",
      "invalid_field",
    );
  }

  const rules = root.rules.map((entry, index) => parseThresholdRule(entry, index, contractName));
  const seenRuleKeys = new Set<string>();

  for (const rule of rules) {
    if (seenRuleKeys.has(rule.rule_key)) {
      throw new WorkflowContractValidationError(
        contractName,
        `Duplicate rule_key: ${rule.rule_key}`,
        "duplicate_key",
      );
    }

    seenRuleKeys.add(rule.rule_key);
  }

  return {
    rules,
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
  };
}

export function parseWorkflowOutputsJson(value: string | unknown): WorkflowOutputsV1 {
  const contractName = "workflow.outputs";
  const root = parseJsonRoot(value, contractName);

  const summaryTemplate =
    typeof root.summary_template === "undefined"
      ? "standard_v1"
      : parseEnumValue(
          root.summary_template,
          ["standard_v1"] as const,
          "summary_template",
          contractName,
        );

  const includeSections =
    typeof root.include_sections === "undefined"
      ? undefined
      : parseStringArrayValue(root.include_sections, "include_sections", contractName, {
          allowEmpty: true,
          unique: true,
        }).map((entry) =>
          parseEnumValue(
            entry,
            ["input_summary", "validation", "kpi_changes", "threshold_breaches", "artifacts"] as const,
            "include_sections[]",
            contractName,
          ),
        );

  let tableOutputs: WorkflowOutputsV1["table_outputs"];

  if (typeof root.table_outputs !== "undefined") {
    if (!Array.isArray(root.table_outputs)) {
      throw new WorkflowContractValidationError(
        contractName,
        "table_outputs must be an array.",
        "invalid_field",
      );
    }

    tableOutputs = root.table_outputs.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `table_outputs[${index}] must be an object.`,
          "invalid_field",
        );
      }

      return {
        format: parseEnumValue(
          entry.format,
          ["csv", "markdown"] as const,
          `table_outputs[${index}].format`,
          contractName,
        ),
        output_key: parseStringValue(
          entry.output_key,
          `table_outputs[${index}].output_key`,
          contractName,
        ),
        step_key: parseStringValue(entry.step_key, `table_outputs[${index}].step_key`, contractName),
      };
    });
  }

  return {
    ...(includeSections ? { include_sections: includeSections } : {}),
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    summary_template: summaryTemplate,
    ...(tableOutputs ? { table_outputs: tableOutputs } : {}),
  };
}

function parseDeliveryChannel(
  value: unknown,
  index: number,
  contractName: string,
): WorkflowDeliveryChannelV1 {
  if (!isRecord(value)) {
    throw new WorkflowContractValidationError(
      contractName,
      `channels[${index}] must be an object.`,
      "invalid_field",
    );
  }

  const kind = parseEnumValue(
    value.kind,
    WORKFLOW_DELIVERY_CHANNEL_KINDS,
    `channels[${index}].kind`,
    contractName,
  );

  if (kind === "webhook") {
    return {
      endpoint_id: parseStringValue(value.endpoint_id, `channels[${index}].endpoint_id`, contractName),
      kind,
      signing: parseEnumValue(
        value.signing,
        ["hmac_sha256"] as const,
        `channels[${index}].signing`,
        contractName,
      ),
    };
  }

  if (kind === "chart_pack") {
    return { kind };
  }

  if (kind === "ranked_table") {
    return {
      format: parseEnumValue(
        value.format,
        ["csv", "markdown"] as const,
        `channels[${index}].format`,
        contractName,
      ),
      kind,
      output_key: parseStringValue(value.output_key, `channels[${index}].output_key`, contractName),
    };
  }

  if (kind === "generated_document") {
    return {
      kind,
      template: parseEnumValue(
        value.template,
        ["summary_pdf_v1"] as const,
        `channels[${index}].template`,
        contractName,
      ),
    };
  }

  return {
    enabled: parseBooleanValue(value.enabled, `channels[${index}].enabled`, contractName),
    kind,
    recipients: parseStringArrayValue(value.recipients, `channels[${index}].recipients`, contractName, {
      allowEmpty: true,
      unique: true,
    }),
  };
}

export function parseWorkflowDeliveryJson(value: string | unknown): WorkflowDeliveryV1 {
  const contractName = "workflow.delivery";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.channels)) {
    throw new WorkflowContractValidationError(
      contractName,
      "channels must be an array.",
      "invalid_field",
    );
  }

  const channels = root.channels.map((entry, index) => parseDeliveryChannel(entry, index, contractName));

  if (typeof root.retry_policy !== "undefined" && !isRecord(root.retry_policy)) {
    throw new WorkflowContractValidationError(
      contractName,
      "retry_policy must be an object when provided.",
      "invalid_field",
    );
  }

  const retryPolicySource = isRecord(root.retry_policy) ? root.retry_policy : {};

  return {
    channels,
    retry_policy: {
      backoff_multiplier:
        typeof retryPolicySource.backoff_multiplier === "undefined"
          ? 2
          : parseNumberValue(
              retryPolicySource.backoff_multiplier,
              "retry_policy.backoff_multiplier",
              contractName,
              { min: 1 },
            ),
      initial_backoff_seconds:
        typeof retryPolicySource.initial_backoff_seconds === "undefined"
          ? 30
          : parseIntegerValue(
              retryPolicySource.initial_backoff_seconds,
              "retry_policy.initial_backoff_seconds",
              contractName,
              { min: 1 },
            ),
      max_attempts:
        typeof retryPolicySource.max_attempts === "undefined"
          ? 3
          : parseIntegerValue(retryPolicySource.max_attempts, "retry_policy.max_attempts", contractName, {
              min: 1,
            }),
    },
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
  };
}

export function parseWorkflowScheduleJson(value: string | unknown): WorkflowScheduleV1 {
  const contractName = "workflow.schedule";
  const root = parseJsonRoot(value, contractName);
  const kind = parseEnumValue(root.kind, ["manual_only", "recurring"] as const, "kind", contractName);

  if (kind === "manual_only") {
    return {
      kind,
      schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    };
  }

  if (!isRecord(root.cadence)) {
    throw new WorkflowContractValidationError(
      contractName,
      "cadence must be an object for recurring schedules.",
      "invalid_field",
    );
  }

  const cadenceKind = parseEnumValue(
    root.cadence.kind,
    ["weekly", "monthly"] as const,
    "cadence.kind",
    contractName,
  );
  const hour = parseIntegerValue(root.cadence.hour, "cadence.hour", contractName, { min: 0, max: 23 });
  const minute = parseIntegerValue(root.cadence.minute, "cadence.minute", contractName, {
    min: 0,
    max: 59,
  });

  return {
    cadence:
      cadenceKind === "weekly"
        ? {
            day_of_week: parseIntegerValue(root.cadence.day_of_week, "cadence.day_of_week", contractName, {
              min: 0,
              max: 6,
            }) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            hour,
            kind: "weekly",
            minute,
          }
        : {
            day_of_month: parseIntegerValue(
              root.cadence.day_of_month,
              "cadence.day_of_month",
              contractName,
              { min: 1, max: 28 },
            ) as
              | 1
              | 2
              | 3
              | 4
              | 5
              | 6
              | 7
              | 8
              | 9
              | 10
              | 11
              | 12
              | 13
              | 14
              | 15
              | 16
              | 17
              | 18
              | 19
              | 20
              | 21
              | 22
              | 23
              | 24
              | 25
              | 26
              | 27
              | 28,
            hour,
            kind: "monthly",
            minute,
          },
    catch_up_policy: parseEnumValue(
      root.catch_up_policy,
      ["enqueue_missed_windows"] as const,
      "catch_up_policy",
      contractName,
    ),
    kind,
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    timezone: parseStringValue(root.timezone, "timezone", contractName),
  };
}

export function parseWorkflowExecutionIdentityJson(
  value: string | unknown,
): WorkflowExecutionIdentityV1 {
  const contractName = "workflow.execution_identity";
  const root = parseJsonRoot(value, contractName);

  const roles = parseStringArrayValue(
    root.required_membership_roles,
    "required_membership_roles",
    contractName,
    { allowEmpty: false, unique: true },
  ).map((entry) =>
    parseEnumValue(entry, ["admin", "owner"] as const, "required_membership_roles[]", contractName),
  );

  const recheckAtEnqueue = parseBooleanValue(
    root.recheck_at_enqueue,
    "recheck_at_enqueue",
    contractName,
  );
  const recheckAtExecution = parseBooleanValue(
    root.recheck_at_execution,
    "recheck_at_execution",
    contractName,
  );

  if (!recheckAtEnqueue || !recheckAtExecution) {
    throw new WorkflowContractValidationError(
      contractName,
      "recheck_at_enqueue and recheck_at_execution must both be true.",
      "invalid_field",
    );
  }

  return {
    mode: parseEnumValue(root.mode, ["fixed_membership_user"] as const, "mode", contractName),
    on_identity_invalid: parseEnumValue(
      root.on_identity_invalid,
      ["block_run"] as const,
      "on_identity_invalid",
      contractName,
    ),
    recheck_at_enqueue: true,
    recheck_at_execution: true,
    required_membership_roles: roles,
    require_membership_status: parseEnumValue(
      root.require_membership_status,
      ["active"] as const,
      "require_membership_status",
      contractName,
    ),
    run_as_user_id: parseStringValue(root.run_as_user_id, "run_as_user_id", contractName),
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
  };
}

export function parseWorkflowProvenanceJson(value: string | unknown): WorkflowProvenanceV1 {
  const contractName = "workflow.provenance";
  const root = parseJsonRoot(value, contractName);

  const sourceKind = parseEnumValue(
    root.source_kind,
    ["chat_turn", "manual_builder"] as const,
    "source_kind",
    contractName,
  );

  const note = parseOptionalStringValue(root.note, "note", contractName);

  if (sourceKind !== "chat_turn") {
    return {
      ...(note ? { note } : {}),
      schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
      source_kind: "manual_builder",
    };
  }

  if (!isRecord(root.chat_turn)) {
    throw new WorkflowContractValidationError(
      contractName,
      "chat_turn must be provided when source_kind is chat_turn.",
      "invalid_field",
    );
  }

  const analysisResultId = parseOptionalStringValue(
    root.chat_turn.analysis_result_id,
    "chat_turn.analysis_result_id",
    contractName,
  );

  return {
    chat_turn: {
      ...(analysisResultId ? { analysis_result_id: analysisResultId } : {}),
      conversation_id: parseStringValue(
        root.chat_turn.conversation_id,
        "chat_turn.conversation_id",
        contractName,
      ),
      sandbox_run_ids: parseStringArrayValue(
        root.chat_turn.sandbox_run_ids,
        "chat_turn.sandbox_run_ids",
        contractName,
        { allowEmpty: true, unique: true },
      ),
      tool_call_ids: parseStringArrayValue(root.chat_turn.tool_call_ids, "chat_turn.tool_call_ids", contractName, {
        allowEmpty: true,
        unique: true,
      }),
      turn_id: parseStringValue(root.chat_turn.turn_id, "chat_turn.turn_id", contractName),
    },
    ...(note ? { note } : {}),
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    source_kind: "chat_turn",
  };
}

export function parseWorkflowRunInputCheckReportJson(
  value: string | unknown,
): WorkflowRunInputCheckReportV1 {
  const contractName = "workflow.run_input_check_report";
  const root = parseJsonRoot(value, contractName);

  if (!Array.isArray(root.resolved_documents)) {
    throw new WorkflowContractValidationError(
      contractName,
      "resolved_documents must be an array.",
      "invalid_field",
    );
  }

  if (!Array.isArray(root.checks)) {
    throw new WorkflowContractValidationError(
      contractName,
      "checks must be an array.",
      "invalid_field",
    );
  }

  return {
    checked_at: parseIntegerValue(root.checked_at, "checked_at", contractName, { min: 0 }),
    checks: root.checks.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `checks[${index}] must be an object.`,
          "invalid_field",
        );
      }

      if (typeof entry.details !== "undefined" && !isRecord(entry.details)) {
        throw new WorkflowContractValidationError(
          contractName,
          `checks[${index}].details must be an object when provided.`,
          "invalid_field",
        );
      }

      return {
        code: parseEnumValue(
          entry.code,
          [
            "missing_required_input",
            "column_missing",
            "row_count_below_minimum",
            "freshness_sla_failed",
            "duplicate_unchanged_input",
            "null_ratio_exceeded",
          ] as const,
          `checks[${index}].code`,
          contractName,
        ),
        ...(isRecord(entry.details) ? { details: entry.details } : {}),
        message: parseStringValue(entry.message, `checks[${index}].message`, contractName),
        status: parseEnumValue(
          entry.status,
          WORKFLOW_INPUT_CHECK_STATUSES,
          `checks[${index}].status`,
          contractName,
        ),
      };
    }),
    input_key: parseStringValue(root.input_key, "input_key", contractName),
    resolved_documents: root.resolved_documents.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `resolved_documents[${index}] must be an object.`,
          "invalid_field",
        );
      }

      const mimeType =
        entry.mime_type === null
          ? null
          : parseStringValue(entry.mime_type, `resolved_documents[${index}].mime_type`, contractName);

      return {
        content_sha256: parseStringValue(
          entry.content_sha256,
          `resolved_documents[${index}].content_sha256`,
          contractName,
        ),
        display_name: parseStringValue(
          entry.display_name,
          `resolved_documents[${index}].display_name`,
          contractName,
        ),
        document_id: parseStringValue(
          entry.document_id,
          `resolved_documents[${index}].document_id`,
          contractName,
        ),
        mime_type: mimeType,
        updated_at: parseIntegerValue(
          entry.updated_at,
          `resolved_documents[${index}].updated_at`,
          contractName,
          { min: 0 },
        ),
      };
    }),
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    status: parseEnumValue(root.status, WORKFLOW_INPUT_CHECK_STATUSES, "status", contractName),
  };
}

export function parseWorkflowDeliverySnapshotJson(value: string | unknown): WorkflowDeliverySnapshotV1 {
  const contractName = "workflow.delivery_snapshot";
  const root = parseJsonRoot(value, contractName);

  if (!isRecord(root.workflow)) {
    throw new WorkflowContractValidationError(contractName, "workflow must be an object.", "invalid_field");
  }

  if (!isRecord(root.run)) {
    throw new WorkflowContractValidationError(contractName, "run must be an object.", "invalid_field");
  }

  if (!isRecord(root.execution_identity)) {
    throw new WorkflowContractValidationError(
      contractName,
      "execution_identity must be an object.",
      "invalid_field",
    );
  }

  if (!Array.isArray(root.inputs)) {
    throw new WorkflowContractValidationError(contractName, "inputs must be an array.", "invalid_field");
  }

  if (!isRecord(root.validation_summary)) {
    throw new WorkflowContractValidationError(
      contractName,
      "validation_summary must be an object.",
      "invalid_field",
    );
  }

  if (!Array.isArray(root.steps)) {
    throw new WorkflowContractValidationError(contractName, "steps must be an array.", "invalid_field");
  }

  if (!Array.isArray(root.thresholds)) {
    throw new WorkflowContractValidationError(
      contractName,
      "thresholds must be an array.",
      "invalid_field",
    );
  }

  if (!Array.isArray(root.artifacts)) {
    throw new WorkflowContractValidationError(contractName, "artifacts must be an array.", "invalid_field");
  }

  return {
    artifacts: root.artifacts.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `artifacts[${index}] must be an object.`,
          "invalid_field",
        );
      }

      const contentSha = parseOptionalStringValue(
        entry.content_sha256,
        `artifacts[${index}].content_sha256`,
        contractName,
      );

      return {
        asset_id: parseStringValue(entry.asset_id, `artifacts[${index}].asset_id`, contractName),
        byte_size: parseIntegerValue(entry.byte_size, `artifacts[${index}].byte_size`, contractName, {
          min: 0,
        }),
        ...(contentSha ? { content_sha256: contentSha } : {}),
        file_name: parseStringValue(entry.file_name, `artifacts[${index}].file_name`, contractName),
        mime_type: parseStringValue(entry.mime_type, `artifacts[${index}].mime_type`, contractName),
        storage_path: parseStringValue(
          entry.storage_path,
          `artifacts[${index}].storage_path`,
          contractName,
        ),
      };
    }),
    execution_identity: {
      run_as_role: parseEnumValue(
        root.execution_identity.run_as_role,
        ["member", "admin", "owner"] as const,
        "execution_identity.run_as_role",
        contractName,
      ),
      run_as_user_id: parseStringValue(
        root.execution_identity.run_as_user_id,
        "execution_identity.run_as_user_id",
        contractName,
      ),
    },
    inputs: root.inputs.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `inputs[${index}] must be an object.`,
          "invalid_field",
        );
      }

      const mimeType =
        entry.mime_type === null
          ? null
          : parseStringValue(entry.mime_type, `inputs[${index}].mime_type`, contractName);

      return {
        content_sha256: parseStringValue(
          entry.content_sha256,
          `inputs[${index}].content_sha256`,
          contractName,
        ),
        display_name: parseStringValue(entry.display_name, `inputs[${index}].display_name`, contractName),
        document_id: parseStringValue(entry.document_id, `inputs[${index}].document_id`, contractName),
        input_key: parseStringValue(entry.input_key, `inputs[${index}].input_key`, contractName),
        mime_type: mimeType,
      };
    }),
    run: {
      completed_at:
        root.run.completed_at === null
          ? null
          : parseIntegerValue(root.run.completed_at, "run.completed_at", contractName, { min: 0 }),
      id: parseStringValue(root.run.id, "run.id", contractName),
      started_at:
        root.run.started_at === null
          ? null
          : parseIntegerValue(root.run.started_at, "run.started_at", contractName, { min: 0 }),
      status: parseStringValue(root.run.status, "run.status", contractName),
      trigger_kind: parseEnumValue(
        root.run.trigger_kind,
        WORKFLOW_RUN_TRIGGER_KINDS,
        "run.trigger_kind",
        contractName,
      ),
      trigger_window_key:
        root.run.trigger_window_key === null
          ? null
          : parseStringValue(root.run.trigger_window_key, "run.trigger_window_key", contractName),
    },
    schema_version: WORKFLOW_JSON_SCHEMA_VERSION,
    steps: root.steps.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `steps[${index}] must be an object.`,
          "invalid_field",
        );
      }

      const durationMs =
        entry.duration_ms === null
          ? null
          : parseIntegerValue(entry.duration_ms, `steps[${index}].duration_ms`, contractName, {
              min: 0,
            });
      const sandboxRunId =
        entry.sandbox_run_id === null
          ? null
          : parseStringValue(entry.sandbox_run_id, `steps[${index}].sandbox_run_id`, contractName);

      return {
        duration_ms: durationMs,
        sandbox_run_id: sandboxRunId,
        status: parseStringValue(entry.status, `steps[${index}].status`, contractName),
        step_key: parseStringValue(entry.step_key, `steps[${index}].step_key`, contractName),
        tool: parseStringValue(entry.tool, `steps[${index}].tool`, contractName),
      };
    }),
    thresholds: root.thresholds.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new WorkflowContractValidationError(
          contractName,
          `thresholds[${index}] must be an object.`,
          "invalid_field",
        );
      }

      return {
        rule_key: parseStringValue(entry.rule_key, `thresholds[${index}].rule_key`, contractName),
        severity: parseEnumValue(
          entry.severity,
          ["info", "warning", "critical"] as const,
          `thresholds[${index}].severity`,
          contractName,
        ),
        status: parseEnumValue(
          entry.status,
          ["pass", "breach"] as const,
          `thresholds[${index}].status`,
          contractName,
        ),
      };
    }),
    validation_summary: {
      failed_check_count: parseIntegerValue(
        root.validation_summary.failed_check_count,
        "validation_summary.failed_check_count",
        contractName,
        { min: 0 },
      ),
      status: parseEnumValue(
        root.validation_summary.status,
        WORKFLOW_INPUT_CHECK_STATUSES,
        "validation_summary.status",
        contractName,
      ),
      warning_check_count: parseIntegerValue(
        root.validation_summary.warning_check_count,
        "validation_summary.warning_check_count",
        contractName,
        { min: 0 },
      ),
    },
    workflow: {
      id: parseStringValue(root.workflow.id, "workflow.id", contractName),
      name: parseStringValue(root.workflow.name, "workflow.name", contractName),
      version_id: parseStringValue(root.workflow.version_id, "workflow.version_id", contractName),
    },
  };
}

function validateWorkflowContractConsistency(contracts: WorkflowVersionContractsV1) {
  const inputKeys = new Set(contracts.inputContract.inputs.map((input) => input.input_key));

  for (const binding of contracts.inputBindings.bindings) {
    if (!inputKeys.has(binding.input_key)) {
      throw new WorkflowContractValidationError(
        "workflow.contract_bundle",
        `input_bindings references unknown input_key: ${binding.input_key}`,
        "unknown_reference",
      );
    }
  }

  for (const input of contracts.inputContract.inputs) {
    if (!contracts.inputBindings.bindings.some((binding) => binding.input_key === input.input_key)) {
      throw new WorkflowContractValidationError(
        "workflow.contract_bundle",
        `Missing binding for input_key: ${input.input_key}`,
        "missing_binding",
      );
    }
  }

  const stepKeys = new Set(contracts.recipe.steps.map((step) => step.step_key));

  for (const step of contracts.recipe.steps) {
    for (const inputRef of step.input_refs) {
      if (inputRef.type === "workflow_input") {
        if (!inputKeys.has(inputRef.input_key)) {
          throw new WorkflowContractValidationError(
            "workflow.contract_bundle",
            `Recipe step ${step.step_key} references unknown input_key: ${inputRef.input_key}`,
            "unknown_reference",
          );
        }

        continue;
      }

      if (!stepKeys.has(inputRef.step_key)) {
        throw new WorkflowContractValidationError(
          "workflow.contract_bundle",
          `Recipe step ${step.step_key} references unknown step_key: ${inputRef.step_key}`,
          "unknown_reference",
        );
      }

      if (inputRef.step_key === step.step_key) {
        throw new WorkflowContractValidationError(
          "workflow.contract_bundle",
          `Recipe step ${step.step_key} cannot reference its own output.`,
          "invalid_reference",
        );
      }
    }
  }

  for (const threshold of contracts.thresholds.rules) {
    if (!stepKeys.has(threshold.metric.step_key)) {
      throw new WorkflowContractValidationError(
        "workflow.contract_bundle",
        `Threshold ${threshold.rule_key} references unknown step_key: ${threshold.metric.step_key}`,
        "unknown_reference",
      );
    }
  }

  for (const output of contracts.outputs.table_outputs ?? []) {
    if (!stepKeys.has(output.step_key)) {
      throw new WorkflowContractValidationError(
        "workflow.contract_bundle",
        `Output table references unknown step_key: ${output.step_key}`,
        "unknown_reference",
      );
    }
  }
}

export function parseWorkflowVersionContracts(input: {
  deliveryJson: string | unknown;
  executionIdentityJson: string | unknown;
  inputBindingsJson: string | unknown;
  inputContractJson: string | unknown;
  outputsJson: string | unknown;
  provenanceJson: string | unknown;
  recipeJson: string | unknown;
  scheduleJson: string | unknown;
  thresholdsJson: string | unknown;
}): WorkflowVersionContractsV1 {
  const contracts: WorkflowVersionContractsV1 = {
    delivery: parseWorkflowDeliveryJson(input.deliveryJson),
    executionIdentity: parseWorkflowExecutionIdentityJson(input.executionIdentityJson),
    inputBindings: parseWorkflowInputBindingsJson(input.inputBindingsJson),
    inputContract: parseWorkflowInputContractJson(input.inputContractJson),
    outputs: parseWorkflowOutputsJson(input.outputsJson),
    provenance: parseWorkflowProvenanceJson(input.provenanceJson),
    recipe: parseWorkflowRecipeJson(input.recipeJson),
    schedule: parseWorkflowScheduleJson(input.scheduleJson),
    thresholds: parseWorkflowThresholdsJson(input.thresholdsJson),
  };

  validateWorkflowContractConsistency(contracts);
  return contracts;
}

export function parseWorkflowJsonRecord(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseWorkflowJsonStringArray(
  value: string | null | undefined,
): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
