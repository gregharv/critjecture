import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

function sqlEnum(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", "));
}

function enumCheck(name: string, column: unknown, values: readonly string[]) {
  return check(name, sql`${column} in (${sqlEnum(values)})`);
}

const userStatusValues = ["active", "suspended"] as const;
const organizationStatusValues = ["active", "suspended", "archived"] as const;
const membershipRoleValues = ["member", "admin", "owner"] as const;
const membershipStatusValues = ["active", "restricted", "suspended"] as const;
const runnerKindValues = ["pywhy", "dowhy", "hybrid"] as const;
const workspaceLedgerUsageClassValues = [
  "causal_intake",
  "causal_run",
  "causal_answer",
  "dataset_profile",
  "reference_ingest",
  "system",
] as const;
const workspaceLedgerStatusValues = ["reserved", "committed", "released", "blocked"] as const;
const dataConnectionKindValues = [
  "filesystem",
  "upload",
  "bulk_import",
  "google_drive",
  "google_sheets",
  "s3",
  "database",
] as const;
const dataConnectionStatusValues = ["active", "paused", "error", "archived"] as const;
const datasetAccessScopeValues = ["public", "admin"] as const;
const datasetStatusValues = ["active", "archived", "deprecated"] as const;
const datasetDataKindValues = ["table", "spreadsheet", "panel", "event_log"] as const;
const datasetIngestionStatusValues = ["pending", "profiling", "ready", "failed", "archived"] as const;
const datasetProfileStatusValues = ["pending", "ready", "failed"] as const;
const datasetSemanticTypeValues = [
  "unknown",
  "identifier",
  "time",
  "numeric",
  "categorical",
  "boolean",
  "text",
  "currency",
  "percentage",
  "treatment_candidate",
  "outcome_candidate",
] as const;
const causalStudyStatusValues = [
  "draft",
  "awaiting_dataset",
  "awaiting_dag",
  "awaiting_approval",
  "ready_to_run",
  "running",
  "completed",
  "blocked",
  "archived",
] as const;
const studyQuestionTypeValues = [
  "cause_of_observed_change",
  "intervention_effect",
  "counterfactual",
  "mediation",
  "instrumental_variable",
  "selection_bias",
  "other",
] as const;
const studyQuestionStatusValues = ["open", "clarifying", "ready", "closed", "archived"] as const;
const intentTypeValues = ["descriptive", "diagnostic", "causal", "counterfactual", "unclear"] as const;
const routingDecisionValues = [
  "continue_descriptive",
  "open_causal_study",
  "ask_clarification",
  "blocked",
] as const;
const studyMessageAuthorTypeValues = ["user", "assistant", "system"] as const;
const studyMessageKindValues = [
  "question",
  "clarification",
  "classification_notice",
  "dataset_binding_notice",
  "dag_note",
  "approval_notice",
  "run_summary",
  "final_answer",
] as const;
const studyDatasetBindingRoleValues = ["primary", "auxiliary", "candidate", "external_requirement"] as const;
const causalDagStatusValues = ["draft", "ready_for_approval", "approved", "superseded", "archived"] as const;
const causalDagNodeTypeValues = [
  "observed_feature",
  "treatment",
  "outcome",
  "confounder",
  "mediator",
  "collider",
  "instrument",
  "selection",
  "latent",
  "external_data_needed",
  "note",
] as const;
const causalDagNodeSourceTypeValues = ["dataset", "user", "system"] as const;
const causalDagNodeObservedStatusValues = ["observed", "unobserved", "missing_external"] as const;
const causalAssumptionTypeValues = [
  "no_unmeasured_confounding",
  "positivity",
  "consistency",
  "measurement_validity",
  "selection_ignorability",
  "instrument_validity",
  "frontdoor_sufficiency",
  "custom",
] as const;
const causalAssumptionStatusValues = ["asserted", "flagged", "contested", "accepted"] as const;
const causalDataRequirementStatusValues = ["missing", "requested", "in_progress", "collected", "waived"] as const;
const causalApprovalKindValues = ["user_signoff", "admin_signoff", "compliance_signoff"] as const;
const causalRunStatusValues = [
  "queued",
  "running",
  "identified",
  "estimated",
  "refuted",
  "completed",
  "failed",
  "not_identifiable",
  "cancelled",
] as const;
const causalIdentificationMethodValues = ["backdoor", "frontdoor", "iv", "mediation", "none"] as const;
const causalEstimandKindValues = ["ate", "att", "atc", "nde", "nie", "late", "custom"] as const;
const causalRefutationStatusValues = ["passed", "failed", "warning", "not_run"] as const;
const computeRunKindValues = [
  "causal_identification",
  "causal_estimation",
  "causal_refutation",
  "dataset_profiling",
  "document_chunking",
] as const;
const computeRunStatusValues = [
  "queued",
  "starting",
  "running",
  "finalizing",
  "completed",
  "failed",
  "timed_out",
  "rejected",
  "abandoned",
] as const;
const runArtifactKindValues = [
  "graph_json",
  "graph_export_png",
  "estimand_report",
  "estimate_json",
  "refutation_report",
  "answer_package",
  "stdout",
  "stderr",
  "misc",
] as const;
const governanceJobTypeValues = [
  "organization_export",
  "history_purge",
  "reference_delete",
  "legacy_archive_export",
] as const;
const governanceJobStatusValues = ["queued", "running", "completed", "failed"] as const;
const usageEventUsageClassValues = [
  "causal_intake",
  "causal_classification",
  "dataset_profile",
  "dag_authoring",
  "causal_run",
  "causal_answer",
  "reference_ingest",
  "system",
] as const;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    status: text("status", { enum: userStatusValues }).notNull().default("active"),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("users_status_check", table.status, userStatusValues),
    index("users_status_idx").on(table.status),
  ],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status", { enum: organizationStatusValues }).notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("organizations_status_check", table.status, organizationStatusValues),
    uniqueIndex("organizations_slug_idx").on(table.slug),
    index("organizations_status_idx").on(table.status),
  ],
);

export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: membershipRoleValues }).notNull(),
    status: text("status", { enum: membershipStatusValues }).notNull().default("active"),
    monthlyCreditCap: integer("monthly_credit_cap"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("organization_memberships_role_check", table.role, membershipRoleValues),
    enumCheck("organization_memberships_status_check", table.status, membershipStatusValues),
    uniqueIndex("organization_memberships_org_user_idx").on(table.organizationId, table.userId),
    index("organization_memberships_org_status_idx").on(table.organizationId, table.status),
    index("organization_memberships_user_status_idx").on(table.userId, table.status),
  ],
);

export const organizationSettings = sqliteTable(
  "organization_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    causalModeRequired: integer("causal_mode_required", { mode: "boolean" }).notNull().default(true),
    requireDagApproval: integer("require_dag_approval", { mode: "boolean" }).notNull().default(true),
    requireAdminApprovalForSignedDags: integer("require_admin_approval_for_signed_dags", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    allowDescriptiveMode: integer("allow_descriptive_mode", { mode: "boolean" }).notNull().default(true),
    defaultRunnerKind: text("default_runner_kind", { enum: runnerKindValues }).notNull().default("pywhy"),
    defaultRunnerVersion: text("default_runner_version"),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("organization_settings_default_runner_kind_check", table.defaultRunnerKind, runnerKindValues),
    uniqueIndex("organization_settings_org_idx").on(table.organizationId),
    index("organization_settings_updated_by_idx").on(table.updatedByUserId),
  ],
);

export const workspacePlans = sqliteTable(
  "workspace_plans",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planCode: text("plan_code").notNull(),
    planName: text("plan_name").notNull(),
    monthlyIncludedCredits: integer("monthly_included_credits").notNull(),
    billingAnchorAt: integer("billing_anchor_at").notNull(),
    currentWindowStartAt: integer("current_window_start_at").notNull(),
    currentWindowEndAt: integer("current_window_end_at").notNull(),
    hardCapBehavior: text("hard_cap_behavior").notNull().default("block"),
    rateCardJson: text("rate_card_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("workspace_plans_hard_cap_behavior_check", sql`${table.hardCapBehavior} in ('block')`),
    uniqueIndex("workspace_plans_organization_id_idx").on(table.organizationId),
    index("workspace_plans_window_end_idx").on(table.currentWindowEndAt),
  ],
);

export const requestLogs = sqliteTable(
  "request_logs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    routeKey: text("route_key").notNull(),
    routeGroup: text("route_group").notNull(),
    method: text("method").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    studyId: text("study_id"),
    studyQuestionId: text("study_question_id"),
    causalRunId: text("causal_run_id"),
    computeRunId: text("compute_run_id"),
    statusCode: integer("status_code").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    modelName: text("model_name"),
    durationMs: integer("duration_ms").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (table) => [
    index("request_logs_route_group_started_at_idx").on(table.routeGroup, table.startedAt),
    index("request_logs_organization_id_started_at_idx").on(table.organizationId, table.startedAt),
    index("request_logs_user_id_started_at_idx").on(table.userId, table.startedAt),
    index("request_logs_study_id_started_at_idx").on(table.studyId, table.startedAt),
    index("request_logs_causal_run_id_started_at_idx").on(table.causalRunId, table.startedAt),
  ],
);

export const workspaceCommercialLedger = sqliteTable(
  "workspace_commercial_ledger",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    requestLogId: text("request_log_id").references(() => requestLogs.id, {
      onDelete: "set null",
    }),
    usageClass: text("usage_class", { enum: workspaceLedgerUsageClassValues }).notNull(),
    creditsDelta: integer("credits_delta").notNull(),
    windowStartAt: integer("window_start_at").notNull(),
    windowEndAt: integer("window_end_at").notNull(),
    status: text("status", { enum: workspaceLedgerStatusValues }).notNull().default("reserved"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("workspace_commercial_ledger_usage_class_check", table.usageClass, workspaceLedgerUsageClassValues),
    enumCheck("workspace_commercial_ledger_status_check", table.status, workspaceLedgerStatusValues),
    index("workspace_commercial_ledger_request_id_idx").on(table.requestId),
    index("workspace_commercial_ledger_org_window_status_idx").on(
      table.organizationId,
      table.windowStartAt,
      table.status,
    ),
    index("workspace_commercial_ledger_user_window_status_idx").on(
      table.userId,
      table.windowStartAt,
      table.status,
    ),
  ],
);

export const dataConnections = sqliteTable(
  "data_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: dataConnectionKindValues }).notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: dataConnectionStatusValues }).notNull().default("active"),
    configJson: text("config_json").notNull().default("{}"),
    credentialsRef: text("credentials_ref"),
    lastSyncAt: integer("last_sync_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("data_connections_kind_check", table.kind, dataConnectionKindValues),
    enumCheck("data_connections_status_check", table.status, dataConnectionStatusValues),
    index("data_connections_org_kind_idx").on(table.organizationId, table.kind),
    index("data_connections_org_status_updated_at_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const datasets = sqliteTable(
  "datasets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").references(() => dataConnections.id, {
      onDelete: "set null",
    }),
    datasetKey: text("dataset_key").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    accessScope: text("access_scope", { enum: datasetAccessScopeValues }).notNull().default("admin"),
    dataKind: text("data_kind", { enum: datasetDataKindValues }).notNull().default("table"),
    grainDescription: text("grain_description"),
    timeColumnName: text("time_column_name"),
    entityIdColumnName: text("entity_id_column_name"),
    status: text("status", { enum: datasetStatusValues }).notNull().default("active"),
    activeVersionId: text("active_version_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("datasets_access_scope_check", table.accessScope, datasetAccessScopeValues),
    enumCheck("datasets_data_kind_check", table.dataKind, datasetDataKindValues),
    enumCheck("datasets_status_check", table.status, datasetStatusValues),
    uniqueIndex("datasets_org_key_idx").on(table.organizationId, table.datasetKey),
    index("datasets_org_scope_updated_at_idx").on(table.organizationId, table.accessScope, table.updatedAt),
    index("datasets_status_updated_at_idx").on(table.status, table.updatedAt),
    index("datasets_active_version_id_idx").on(table.activeVersionId),
  ],
);

export const datasetVersions = sqliteTable(
  "dataset_versions",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    sourceVersionToken: text("source_version_token"),
    sourceModifiedAt: integer("source_modified_at"),
    contentHash: text("content_hash").notNull(),
    schemaHash: text("schema_hash").notNull(),
    rowCount: integer("row_count"),
    byteSize: integer("byte_size"),
    materializedPath: text("materialized_path").notNull(),
    ingestionStatus: text("ingestion_status", { enum: datasetIngestionStatusValues }).notNull().default("pending"),
    profileStatus: text("profile_status", { enum: datasetProfileStatusValues }).notNull().default("pending"),
    ingestionError: text("ingestion_error"),
    profileError: text("profile_error"),
    indexedAt: integer("indexed_at"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("dataset_versions_ingestion_status_check", table.ingestionStatus, datasetIngestionStatusValues),
    enumCheck("dataset_versions_profile_status_check", table.profileStatus, datasetProfileStatusValues),
    uniqueIndex("dataset_versions_dataset_version_idx").on(table.datasetId, table.versionNumber),
    index("dataset_versions_dataset_created_at_idx").on(table.datasetId, table.createdAt),
    index("dataset_versions_org_status_updated_at_idx").on(
      table.organizationId,
      table.ingestionStatus,
      table.updatedAt,
    ),
    index("dataset_versions_content_hash_idx").on(table.datasetId, table.contentHash),
  ],
);

export const datasetVersionColumns = sqliteTable(
  "dataset_version_columns",
  {
    id: text("id").primaryKey(),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    columnName: text("column_name").notNull(),
    displayName: text("display_name").notNull(),
    columnOrder: integer("column_order").notNull(),
    physicalType: text("physical_type").notNull(),
    semanticType: text("semantic_type", { enum: datasetSemanticTypeValues }).notNull().default("unknown"),
    nullable: integer("nullable", { mode: "boolean" }).notNull().default(true),
    isIndexedCandidate: integer("is_indexed_candidate", { mode: "boolean" }).notNull().default(false),
    isTreatmentCandidate: integer("is_treatment_candidate", { mode: "boolean" }).notNull().default(false),
    isOutcomeCandidate: integer("is_outcome_candidate", { mode: "boolean" }).notNull().default(false),
    description: text("description"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("dataset_version_columns_semantic_type_check", table.semanticType, datasetSemanticTypeValues),
    uniqueIndex("dataset_version_columns_version_name_idx").on(table.datasetVersionId, table.columnName),
    uniqueIndex("dataset_version_columns_version_order_idx").on(table.datasetVersionId, table.columnOrder),
    index("dataset_version_columns_version_semantic_idx").on(table.datasetVersionId, table.semanticType),
    index("dataset_version_columns_org_created_at_idx").on(table.organizationId, table.createdAt),
  ],
);

export const datasetVersionColumnProfiles = sqliteTable(
  "dataset_version_column_profiles",
  {
    id: text("id").primaryKey(),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => datasetVersionColumns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    missingRate: real("missing_rate"),
    distinctCount: integer("distinct_count"),
    minValueText: text("min_value_text"),
    maxValueText: text("max_value_text"),
    sampleValuesJson: text("sample_values_json").notNull().default("[]"),
    profileJson: text("profile_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("dataset_version_column_profiles_column_idx").on(table.columnId),
    index("dataset_version_column_profiles_version_idx").on(table.datasetVersionId),
  ],
);

export const causalStudies = sqliteTable(
  "causal_studies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: causalStudyStatusValues }).notNull().default("draft"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    currentQuestionId: text("current_question_id"),
    currentDagId: text("current_dag_id"),
    currentDagVersionId: text("current_dag_version_id"),
    currentRunId: text("current_run_id"),
    currentAnswerId: text("current_answer_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (table) => [
    enumCheck("causal_studies_status_check", table.status, causalStudyStatusValues),
    index("causal_studies_org_status_updated_at_idx").on(table.organizationId, table.status, table.updatedAt),
    index("causal_studies_created_by_updated_at_idx").on(table.createdByUserId, table.updatedAt),
  ],
);

export const studyQuestions = sqliteTable(
  "study_questions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    askedByUserId: text("asked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    questionText: text("question_text").notNull(),
    questionType: text("question_type", { enum: studyQuestionTypeValues }).notNull(),
    status: text("status", { enum: studyQuestionStatusValues }).notNull().default("open"),
    proposedTreatmentLabel: text("proposed_treatment_label"),
    proposedOutcomeLabel: text("proposed_outcome_label"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("study_questions_type_check", table.questionType, studyQuestionTypeValues),
    enumCheck("study_questions_status_check", table.status, studyQuestionStatusValues),
    index("study_questions_study_created_at_idx").on(table.studyId, table.createdAt),
    index("study_questions_org_status_created_at_idx").on(table.organizationId, table.status, table.createdAt),
  ],
);

export const intentClassifications = sqliteTable(
  "intent_classifications",
  {
    id: text("id").primaryKey(),
    studyQuestionId: text("study_question_id")
      .notNull()
      .references(() => studyQuestions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    classifierModelName: text("classifier_model_name").notNull(),
    classifierPromptVersion: text("classifier_prompt_version").notNull(),
    rawOutputJson: text("raw_output_json").notNull(),
    isCausal: integer("is_causal", { mode: "boolean" }).notNull(),
    intentType: text("intent_type", { enum: intentTypeValues }).notNull(),
    confidence: real("confidence").notNull(),
    reasonText: text("reason_text").notNull(),
    routingDecision: text("routing_decision", { enum: routingDecisionValues }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("intent_classifications_intent_type_check", table.intentType, intentTypeValues),
    enumCheck("intent_classifications_routing_decision_check", table.routingDecision, routingDecisionValues),
    index("intent_classifications_question_created_at_idx").on(table.studyQuestionId, table.createdAt),
    index("intent_classifications_org_created_at_idx").on(table.organizationId, table.createdAt),
    index("intent_classifications_routing_decision_idx").on(table.routingDecision, table.createdAt),
  ],
);

export const studyMessages = sqliteTable(
  "study_messages",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: studyMessageAuthorTypeValues }).notNull(),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    messageKind: text("message_kind", { enum: studyMessageKindValues }).notNull(),
    contentText: text("content_text").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("study_messages_author_type_check", table.authorType, studyMessageAuthorTypeValues),
    enumCheck("study_messages_message_kind_check", table.messageKind, studyMessageKindValues),
    index("study_messages_study_created_at_idx").on(table.studyId, table.createdAt),
    index("study_messages_org_created_at_idx").on(table.organizationId, table.createdAt),
  ],
);

export const studyDatasetBindings = sqliteTable(
  "study_dataset_bindings",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    datasetVersionId: text("dataset_version_id").references(() => datasetVersions.id, {
      onDelete: "set null",
    }),
    bindingRole: text("binding_role", { enum: studyDatasetBindingRoleValues }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    bindingNote: text("binding_note"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("study_dataset_bindings_binding_role_check", table.bindingRole, studyDatasetBindingRoleValues),
    uniqueIndex("study_dataset_bindings_study_dataset_role_idx").on(
      table.studyId,
      table.datasetId,
      table.bindingRole,
    ),
    uniqueIndex("study_dataset_bindings_one_active_primary_idx")
      .on(table.studyId)
      .where(sql`${table.bindingRole} = 'primary' and ${table.isActive} = 1`),
    index("study_dataset_bindings_active_idx").on(table.studyId, table.isActive),
    index("study_dataset_bindings_dataset_version_idx").on(table.datasetVersionId),
  ],
);

export const causalDags = sqliteTable(
  "causal_dags",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: causalDagStatusValues }).notNull().default("draft"),
    currentVersionId: text("current_version_id"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("causal_dags_status_check", table.status, causalDagStatusValues),
    index("causal_dags_study_status_updated_at_idx").on(table.studyId, table.status, table.updatedAt),
    index("causal_dags_org_updated_at_idx").on(table.organizationId, table.updatedAt),
  ],
);

export const causalDagVersions = sqliteTable(
  "causal_dag_versions",
  {
    id: text("id").primaryKey(),
    dagId: text("dag_id")
      .notNull()
      .references(() => causalDags.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    primaryDatasetVersionId: text("primary_dataset_version_id").references(() => datasetVersions.id, {
      onDelete: "set null",
    }),
    graphJson: text("graph_json").notNull(),
    validationJson: text("validation_json").notNull().default("{}"),
    layoutJson: text("layout_json").notNull().default("{}"),
    treatmentNodeKey: text("treatment_node_key"),
    outcomeNodeKey: text("outcome_node_key"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("causal_dag_versions_dag_version_idx").on(table.dagId, table.versionNumber),
    index("causal_dag_versions_study_created_at_idx").on(table.studyId, table.createdAt),
    index("causal_dag_versions_dataset_version_idx").on(table.primaryDatasetVersionId),
  ],
);

export const causalDagNodes = sqliteTable(
  "causal_dag_nodes",
  {
    id: text("id").primaryKey(),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    label: text("label").notNull(),
    nodeType: text("node_type", { enum: causalDagNodeTypeValues }).notNull(),
    sourceType: text("source_type", { enum: causalDagNodeSourceTypeValues }).notNull(),
    observedStatus: text("observed_status", { enum: causalDagNodeObservedStatusValues }).notNull(),
    datasetVersionId: text("dataset_version_id").references(() => datasetVersions.id, { onDelete: "set null" }),
    datasetColumnId: text("dataset_column_id").references(() => datasetVersionColumns.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    assumptionNote: text("assumption_note"),
    positionX: real("position_x"),
    positionY: real("position_y"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_dag_nodes_node_type_check", table.nodeType, causalDagNodeTypeValues),
    enumCheck("causal_dag_nodes_source_type_check", table.sourceType, causalDagNodeSourceTypeValues),
    enumCheck("causal_dag_nodes_observed_status_check", table.observedStatus, causalDagNodeObservedStatusValues),
    check(
      "causal_dag_nodes_dataset_source_requires_column_check",
      sql`(${table.sourceType} != 'dataset' or ${table.datasetColumnId} is not null)`,
    ),
    uniqueIndex("causal_dag_nodes_version_key_idx").on(table.dagVersionId, table.nodeKey),
    index("causal_dag_nodes_version_type_idx").on(table.dagVersionId, table.nodeType),
    index("causal_dag_nodes_column_idx").on(table.datasetColumnId),
  ],
);

export const causalDagEdges = sqliteTable(
  "causal_dag_edges",
  {
    id: text("id").primaryKey(),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    edgeKey: text("edge_key").notNull(),
    sourceNodeId: text("source_node_id")
      .notNull()
      .references(() => causalDagNodes.id, { onDelete: "cascade" }),
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => causalDagNodes.id, { onDelete: "cascade" }),
    relationshipLabel: text("relationship_label").notNull().default("causes"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("causal_dag_edges_version_edge_key_idx").on(table.dagVersionId, table.edgeKey),
    uniqueIndex("causal_dag_edges_version_source_target_idx").on(
      table.dagVersionId,
      table.sourceNodeId,
      table.targetNodeId,
    ),
    index("causal_dag_edges_source_idx").on(table.sourceNodeId),
    index("causal_dag_edges_target_idx").on(table.targetNodeId),
  ],
);

export const causalAssumptions = sqliteTable(
  "causal_assumptions",
  {
    id: text("id").primaryKey(),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assumptionType: text("assumption_type", { enum: causalAssumptionTypeValues }).notNull(),
    description: text("description").notNull(),
    status: text("status", { enum: causalAssumptionStatusValues }).notNull().default("asserted"),
    relatedNodeId: text("related_node_id").references(() => causalDagNodes.id, { onDelete: "set null" }),
    relatedEdgeId: text("related_edge_id").references(() => causalDagEdges.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("causal_assumptions_type_check", table.assumptionType, causalAssumptionTypeValues),
    enumCheck("causal_assumptions_status_check", table.status, causalAssumptionStatusValues),
    index("causal_assumptions_dag_version_idx").on(table.dagVersionId),
    index("causal_assumptions_status_idx").on(table.status, table.createdAt),
    index("causal_assumptions_related_node_idx").on(table.relatedNodeId),
  ],
);

export const causalDataRequirements = sqliteTable(
  "causal_data_requirements",
  {
    id: text("id").primaryKey(),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    relatedNodeId: text("related_node_id").references(() => causalDagNodes.id, { onDelete: "set null" }),
    variableLabel: text("variable_label").notNull(),
    status: text("status", { enum: causalDataRequirementStatusValues }).notNull().default("missing"),
    importanceRank: integer("importance_rank"),
    reasonNeeded: text("reason_needed").notNull(),
    suggestedSource: text("suggested_source"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("causal_data_requirements_status_check", table.status, causalDataRequirementStatusValues),
    index("causal_data_requirements_dag_status_idx").on(table.dagVersionId, table.status),
    index("causal_data_requirements_study_status_idx").on(table.studyId, table.status),
  ],
);

export const causalApprovals = sqliteTable(
  "causal_approvals",
  {
    id: text("id").primaryKey(),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    approvedByUserId: text("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    approvalKind: text("approval_kind", { enum: causalApprovalKindValues }).notNull(),
    approvalText: text("approval_text").notNull(),
    approvalHash: text("approval_hash"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_approvals_kind_check", table.approvalKind, causalApprovalKindValues),
    index("causal_approvals_dag_created_at_idx").on(table.dagVersionId, table.createdAt),
    index("causal_approvals_study_created_at_idx").on(table.studyId, table.createdAt),
    index("causal_approvals_approved_by_idx").on(table.approvedByUserId, table.createdAt),
  ],
);

export const causalRuns = sqliteTable(
  "causal_runs",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    studyQuestionId: text("study_question_id")
      .notNull()
      .references(() => studyQuestions.id, { onDelete: "cascade" }),
    dagVersionId: text("dag_version_id")
      .notNull()
      .references(() => causalDagVersions.id, { onDelete: "cascade" }),
    primaryDatasetVersionId: text("primary_dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "restrict" }),
    approvalId: text("approval_id").references(() => causalApprovals.id, { onDelete: "set null" }),
    treatmentNodeKey: text("treatment_node_key").notNull(),
    outcomeNodeKey: text("outcome_node_key").notNull(),
    status: text("status", { enum: causalRunStatusValues }).notNull().default("queued"),
    runnerKind: text("runner_kind", { enum: runnerKindValues }).notNull().default("pywhy"),
    runnerVersion: text("runner_version"),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    failureReason: text("failure_reason"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("causal_runs_status_check", table.status, causalRunStatusValues),
    enumCheck("causal_runs_runner_kind_check", table.runnerKind, runnerKindValues),
    index("causal_runs_study_created_at_idx").on(table.studyId, table.createdAt),
    index("causal_runs_org_status_created_at_idx").on(table.organizationId, table.status, table.createdAt),
    index("causal_runs_dag_version_idx").on(table.dagVersionId),
    index("causal_runs_primary_dataset_version_idx").on(table.primaryDatasetVersionId),
    index("causal_runs_requested_by_idx").on(table.requestedByUserId, table.createdAt),
  ],
);

export const causalRunDatasetBindings = sqliteTable(
  "causal_run_dataset_bindings",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    datasetVersionId: text("dataset_version_id")
      .notNull()
      .references(() => datasetVersions.id, { onDelete: "restrict" }),
    bindingRole: text("binding_role", { enum: studyDatasetBindingRoleValues }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_run_dataset_bindings_binding_role_check", table.bindingRole, studyDatasetBindingRoleValues),
    uniqueIndex("causal_run_dataset_bindings_run_dataset_role_idx").on(
      table.runId,
      table.datasetVersionId,
      table.bindingRole,
    ),
    index("causal_run_dataset_bindings_dataset_version_idx").on(table.datasetVersionId),
  ],
);

export const causalIdentifications = sqliteTable(
  "causal_identifications",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    identified: integer("identified", { mode: "boolean" }).notNull(),
    method: text("method", { enum: causalIdentificationMethodValues }).notNull(),
    estimandExpression: text("estimand_expression"),
    adjustmentSetJson: text("adjustment_set_json").notNull().default("[]"),
    blockingReasonsJson: text("blocking_reasons_json").notNull().default("[]"),
    identificationJson: text("identification_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_identifications_method_check", table.method, causalIdentificationMethodValues),
    uniqueIndex("causal_identifications_run_idx").on(table.runId),
    index("causal_identifications_identified_idx").on(table.identified, table.createdAt),
  ],
);

export const causalEstimands = sqliteTable(
  "causal_estimands",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    estimandKind: text("estimand_kind", { enum: causalEstimandKindValues }).notNull(),
    estimandLabel: text("estimand_label").notNull(),
    estimandExpression: text("estimand_expression").notNull(),
    identificationAssumptionsJson: text("identification_assumptions_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_estimands_kind_check", table.estimandKind, causalEstimandKindValues),
    index("causal_estimands_run_idx").on(table.runId),
    index("causal_estimands_kind_idx").on(table.estimandKind, table.createdAt),
  ],
);

export const causalEstimates = sqliteTable(
  "causal_estimates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    estimandId: text("estimand_id")
      .notNull()
      .references(() => causalEstimands.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    estimatorName: text("estimator_name").notNull(),
    estimatorConfigJson: text("estimator_config_json").notNull().default("{}"),
    effectName: text("effect_name").notNull(),
    estimateValue: real("estimate_value"),
    stdError: real("std_error"),
    confidenceIntervalLow: real("confidence_interval_low"),
    confidenceIntervalHigh: real("confidence_interval_high"),
    pValue: real("p_value"),
    estimateJson: text("estimate_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("causal_estimates_run_idx").on(table.runId),
    index("causal_estimates_estimand_idx").on(table.estimandId),
    index("causal_estimates_estimator_idx").on(table.estimatorName, table.createdAt),
  ],
);

export const causalRefutations = sqliteTable(
  "causal_refutations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    refuterName: text("refuter_name").notNull(),
    status: text("status", { enum: causalRefutationStatusValues }).notNull(),
    summaryText: text("summary_text").notNull(),
    resultJson: text("result_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("causal_refutations_status_check", table.status, causalRefutationStatusValues),
    uniqueIndex("causal_refutations_run_refuter_idx").on(table.runId, table.refuterName),
    index("causal_refutations_status_idx").on(table.status, table.createdAt),
  ],
);

export const computeRuns = sqliteTable(
  "compute_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    studyId: text("study_id").references(() => causalStudies.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => causalRuns.id, { onDelete: "set null" }),
    computeKind: text("compute_kind", { enum: computeRunKindValues }).notNull(),
    status: text("status", { enum: computeRunStatusValues }).notNull().default("queued"),
    backend: text("backend").notNull(),
    runner: text("runner").notNull(),
    failureReason: text("failure_reason"),
    timeoutMs: integer("timeout_ms").notNull().default(0),
    cpuLimitSeconds: integer("cpu_limit_seconds").notNull().default(0),
    memoryLimitBytes: integer("memory_limit_bytes").notNull().default(0),
    maxProcesses: integer("max_processes").notNull().default(0),
    stdoutMaxBytes: integer("stdout_max_bytes").notNull().default(0),
    artifactMaxBytes: integer("artifact_max_bytes").notNull().default(0),
    codeText: text("code_text").notNull().default(""),
    inputManifestJson: text("input_manifest_json").notNull().default("[]"),
    stdoutText: text("stdout_text"),
    stderrText: text("stderr_text"),
    leaseExpiresAt: integer("lease_expires_at"),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    cleanupStatus: text("cleanup_status").notNull().default("pending"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
  },
  (table) => [
    enumCheck("compute_runs_kind_check", table.computeKind, computeRunKindValues),
    enumCheck("compute_runs_status_check", table.status, computeRunStatusValues),
    check("compute_runs_cleanup_status_check", sql`${table.cleanupStatus} in ('pending', 'completed', 'failed', 'skipped')`),
    check("compute_runs_owner_check", sql`(${table.runId} is not null or ${table.studyId} is not null)`),
    check(
      "compute_runs_causal_kinds_require_run_id_check",
      sql`(
        ${table.computeKind} not in ('causal_identification', 'causal_estimation', 'causal_refutation')
        or ${table.runId} is not null
      )`,
    ),
    index("compute_runs_run_id_idx").on(table.runId),
    index("compute_runs_study_id_idx").on(table.studyId),
    index("compute_runs_org_status_created_at_idx").on(table.organizationId, table.status, table.createdAt),
    index("compute_runs_status_lease_expires_at_idx").on(table.status, table.leaseExpiresAt),
  ],
);

export const runArtifacts = sqliteTable(
  "run_artifacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    studyId: text("study_id").references(() => causalStudies.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => causalRuns.id, { onDelete: "set null" }),
    computeRunId: text("compute_run_id").references(() => computeRuns.id, { onDelete: "set null" }),
    artifactKind: text("artifact_kind", { enum: runArtifactKindValues }).notNull(),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (table) => [
    enumCheck("run_artifacts_kind_check", table.artifactKind, runArtifactKindValues),
    index("run_artifacts_run_idx").on(table.runId),
    index("run_artifacts_compute_run_idx").on(table.computeRunId),
    index("run_artifacts_kind_created_at_idx").on(table.artifactKind, table.createdAt),
    index("run_artifacts_expires_at_idx").on(table.expiresAt),
  ],
);

export const causalAnswerPackages = sqliteTable(
  "causal_answer_packages",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packageJson: text("package_json").notNull(),
    packageHash: text("package_hash").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("causal_answer_packages_run_idx").on(table.runId),
    index("causal_answer_packages_study_created_at_idx").on(table.studyId, table.createdAt),
  ],
);

export const causalAnswers = sqliteTable(
  "causal_answers",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => causalRuns.id, { onDelete: "cascade" }),
    studyId: text("study_id")
      .notNull()
      .references(() => causalStudies.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    answerPackageId: text("answer_package_id")
      .notNull()
      .references(() => causalAnswerPackages.id, { onDelete: "cascade" }),
    modelName: text("model_name").notNull(),
    promptVersion: text("prompt_version").notNull(),
    answerText: text("answer_text").notNull(),
    answerFormat: text("answer_format").notNull().default("markdown"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("causal_answers_run_idx").on(table.runId),
    index("causal_answers_study_created_at_idx").on(table.studyId, table.createdAt),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    requestLogId: text("request_log_id").references(() => requestLogs.id, { onDelete: "set null" }),
    routeKey: text("route_key").notNull(),
    routeGroup: text("route_group").notNull(),
    eventType: text("event_type").notNull(),
    usageClass: text("usage_class", { enum: usageEventUsageClassValues }).notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    studyId: text("study_id").references(() => causalStudies.id, { onDelete: "set null" }),
    causalRunId: text("causal_run_id").references(() => causalRuns.id, { onDelete: "set null" }),
    subjectName: text("subject_name"),
    status: text("status").notNull(),
    quantity: integer("quantity").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    commercialCredits: integer("commercial_credits").notNull().default(0),
    durationMs: integer("duration_ms"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    enumCheck("usage_events_usage_class_check", table.usageClass, usageEventUsageClassValues),
    index("usage_events_route_group_created_at_idx").on(table.routeGroup, table.createdAt),
    index("usage_events_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    index("usage_events_study_id_created_at_idx").on(table.studyId, table.createdAt),
    index("usage_events_causal_run_id_created_at_idx").on(table.causalRunId, table.createdAt),
  ],
);

export const rateLimitBuckets = sqliteTable(
  "rate_limit_buckets",
  {
    id: text("id").primaryKey(),
    routeGroup: text("route_group").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    bucketStartAt: integer("bucket_start_at").notNull(),
    bucketWidthSeconds: integer("bucket_width_seconds").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("rate_limit_buckets_scope_bucket_idx").on(
      table.routeGroup,
      table.scopeType,
      table.scopeId,
      table.bucketStartAt,
      table.bucketWidthSeconds,
    ),
    index("rate_limit_buckets_updated_at_idx").on(table.updatedAt),
  ],
);

export const operationalAlerts = sqliteTable(
  "operational_alerts",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    studyId: text("study_id").references(() => causalStudies.id, { onDelete: "set null" }),
    causalRunId: text("causal_run_id").references(() => causalRuns.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    index("operational_alerts_status_last_seen_at_idx").on(table.status, table.lastSeenAt),
    index("operational_alerts_organization_id_last_seen_at_idx").on(
      table.organizationId,
      table.lastSeenAt,
    ),
    index("operational_alerts_causal_run_id_last_seen_at_idx").on(table.causalRunId, table.lastSeenAt),
  ],
);

export const organizationComplianceSettings = sqliteTable(
  "organization_compliance_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestLogRetentionDays: integer("request_log_retention_days"),
    usageRetentionDays: integer("usage_retention_days"),
    studyHistoryRetentionDays: integer("study_history_retention_days"),
    referenceRetentionDays: integer("reference_retention_days"),
    runArtifactRetentionDays: integer("run_artifact_retention_days").notNull().default(7),
    legacyArchiveRetentionDays: integer("legacy_archive_retention_days"),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_compliance_settings_org_idx").on(table.organizationId),
    index("organization_compliance_settings_updated_by_idx").on(table.updatedByUserId),
  ],
);

export const governanceJobs = sqliteTable(
  "governance_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    jobType: text("job_type", { enum: governanceJobTypeValues }).notNull(),
    status: text("status", { enum: governanceJobStatusValues }).notNull(),
    triggerRequestId: text("trigger_request_id"),
    targetLabel: text("target_label").notNull(),
    cutoffTimestamp: integer("cutoff_timestamp"),
    artifactStoragePath: text("artifact_storage_path"),
    artifactFileName: text("artifact_file_name"),
    artifactByteSize: integer("artifact_byte_size"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    resultJson: text("result_json").notNull().default("{}"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    enumCheck("governance_jobs_type_check", table.jobType, governanceJobTypeValues),
    enumCheck("governance_jobs_status_check", table.status, governanceJobStatusValues),
    index("governance_jobs_org_created_at_idx").on(table.organizationId, table.createdAt),
    index("governance_jobs_status_updated_at_idx").on(table.status, table.updatedAt),
    index("governance_jobs_type_completed_at_idx").on(table.jobType, table.completedAt),
  ],
);
