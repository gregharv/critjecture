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

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    role: text("role", { enum: ["intern", "owner"] }).notNull(),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("users_role_check", sql`${table.role} in ('intern', 'owner')`),
    check("users_status_check", sql`${table.status} in ('active', 'suspended')`),
    index("users_status_idx").on(table.status),
  ],
);

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)],
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
    role: text("role", { enum: ["member", "admin", "owner"] }).notNull(),
    status: text("status", { enum: ["active", "restricted", "suspended"] })
      .notNull()
      .default("active"),
    monthlyCreditCap: integer("monthly_credit_cap"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "organization_memberships_role_check",
      sql`${table.role} in ('member', 'admin', 'owner')`,
    ),
    check(
      "organization_memberships_status_check",
      sql`${table.status} in ('active', 'restricted', 'suspended')`,
    ),
    uniqueIndex("organization_memberships_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_memberships_org_status_idx").on(table.organizationId, table.status),
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
    hardCapBehavior: text("hard_cap_behavior", { enum: ["block"] })
      .notNull()
      .default("block"),
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
    routeGroup: text("route_group").notNull(),
    usageClass: text("usage_class", {
      enum: ["analysis", "chart", "chat", "document", "import"],
    }).notNull(),
    creditsDelta: integer("credits_delta").notNull(),
    windowStartAt: integer("window_start_at").notNull(),
    windowEndAt: integer("window_end_at").notNull(),
    status: text("status", {
      enum: ["reserved", "committed", "released", "blocked"],
    })
      .notNull()
      .default("reserved"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workspace_commercial_ledger_usage_class_check",
      sql`${table.usageClass} in ('analysis', 'chart', 'chat', 'document', 'import')`,
    ),
    check(
      "workspace_commercial_ledger_status_check",
      sql`${table.status} in ('reserved', 'committed', 'released', 'blocked')`,
    ),
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

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userRole: text("user_role", { enum: ["intern", "owner"] }).notNull(),
    title: text("title").notNull(),
    previewText: text("preview_text").notNull(),
    messageCount: integer("message_count").notNull(),
    usageJson: text("usage_json").notNull(),
    sessionDataJson: text("session_data_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "conversations_user_role_check",
      sql`${table.userRole} in ('intern', 'owner')`,
    ),
    index("conversations_organization_id_updated_at_idx").on(
      table.organizationId,
      table.updatedAt,
    ),
    index("conversations_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    index("conversations_user_role_idx").on(table.userRole),
  ],
);

export const chatTurns = sqliteTable(
  "chat_turns",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    chatSessionId: text("chat_session_id").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userRole: text("user_role", { enum: ["intern", "owner"] }).notNull(),
    userPromptText: text("user_prompt_text").notNull(),
    status: text("status", { enum: ["started", "completed", "failed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check(
      "chat_turns_user_role_check",
      sql`${table.userRole} in ('intern', 'owner')`,
    ),
    check(
      "chat_turns_status_check",
      sql`${table.status} in ('started', 'completed', 'failed')`,
    ),
    index("chat_turns_created_at_idx").on(table.createdAt),
    index("chat_turns_chat_session_id_idx").on(table.chatSessionId),
    index("chat_turns_conversation_id_idx").on(table.conversationId),
    index("chat_turns_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    index("chat_turns_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => chatTurns.id, { onDelete: "cascade" }),
    runtimeToolCallId: text("runtime_tool_call_id").notNull().unique(),
    toolName: text("tool_name").notNull(),
    toolParametersJson: text("tool_parameters_json").notNull(),
    accessedFilesJson: text("accessed_files_json").notNull().default("[]"),
    sandboxRunId: text("sandbox_run_id"),
    status: text("status", { enum: ["started", "completed", "error"] }).notNull(),
    resultSummary: text("result_summary"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check(
      "audit_tool_calls_status_check",
      sql`${table.status} in ('started', 'completed', 'error')`,
    ),
    index("tool_calls_turn_id_started_at_idx").on(table.turnId, table.startedAt),
    index("tool_calls_sandbox_run_id_idx").on(table.sandboxRunId),
  ],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => chatTurns.id, { onDelete: "cascade" }),
    messageIndex: integer("message_index").notNull(),
    messageType: text("message_type", {
      enum: ["final-response", "planner-selection"],
    }).notNull(),
    messageText: text("message_text").notNull(),
    modelName: text("model_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "assistant_messages_type_check",
      sql`${table.messageType} in ('final-response', 'planner-selection')`,
    ),
    uniqueIndex("assistant_messages_turn_id_message_index_idx").on(
      table.turnId,
      table.messageIndex,
    ),
    index("assistant_messages_turn_id_created_at_idx").on(table.turnId, table.createdAt),
  ],
);

export const sandboxRuns = sqliteTable(
  "sandbox_runs",
  {
    runId: text("run_id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    turnId: text("turn_id").references(() => chatTurns.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runtimeToolCallId: text("runtime_tool_call_id"),
    toolName: text("tool_name").notNull(),
    backend: text("backend", {
      enum: ["container_supervisor", "local_supervisor", "hosted_supervisor"],
    })
      .notNull()
      .default("container_supervisor"),
    runner: text("runner").notNull().default("oci-container"),
    status: text("status", {
      enum: [
        "queued",
        "starting",
        "running",
        "finalizing",
        "completed",
        "failed",
        "timed_out",
        "rejected",
        "abandoned",
      ],
    })
      .notNull()
      .default("queued"),
    failureReason: text("failure_reason"),
    exitCode: integer("exit_code"),
    timeoutMs: integer("timeout_ms").notNull().default(0),
    cpuLimitSeconds: integer("cpu_limit_seconds").notNull().default(0),
    memoryLimitBytes: integer("memory_limit_bytes").notNull().default(0),
    maxProcesses: integer("max_processes").notNull().default(0),
    stdoutMaxBytes: integer("stdout_max_bytes").notNull().default(0),
    artifactMaxBytes: integer("artifact_max_bytes").notNull().default(0),
    artifactTtlMs: integer("artifact_ttl_ms").notNull().default(0),
    codeText: text("code_text").notNull().default(""),
    inputFilesJson: text("input_files_json").notNull().default("[]"),
    inlineWorkspaceFilesJson: text("inline_workspace_files_json").notNull().default("[]"),
    stdoutText: text("stdout_text"),
    stderrText: text("stderr_text"),
    supervisorId: text("supervisor_id"),
    leaseExpiresAt: integer("lease_expires_at"),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    workspacePath: text("workspace_path"),
    cleanupStatus: text("cleanup_status", {
      enum: ["pending", "completed", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    cleanupCompletedAt: integer("cleanup_completed_at"),
    cleanupError: text("cleanup_error"),
    cleanupAttemptCount: integer("cleanup_attempt_count").notNull().default(0),
    reconciliationCount: integer("reconciliation_count").notNull().default(0),
    generatedAssetsJson: text("generated_assets_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at").notNull().default(0),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check(
      "sandbox_runs_backend_check",
      sql`${table.backend} in ('container_supervisor', 'local_supervisor', 'hosted_supervisor')`,
    ),
    check(
      "sandbox_runs_status_check",
      sql`${table.status} in ('queued', 'starting', 'running', 'finalizing', 'completed', 'failed', 'timed_out', 'rejected', 'abandoned')`,
    ),
    check(
      "sandbox_runs_cleanup_status_check",
      sql`${table.cleanupStatus} in ('pending', 'completed', 'failed', 'skipped')`,
    ),
    index("sandbox_runs_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("sandbox_runs_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("sandbox_runs_backend_status_created_at_idx").on(
      table.backend,
      table.status,
      table.createdAt,
    ),
    index("sandbox_runs_status_lease_expires_at_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    index("sandbox_runs_status_started_at_idx").on(table.status, table.startedAt),
    index("sandbox_runs_turn_id_started_at_idx").on(table.turnId, table.startedAt),
  ],
);

export const analysisResults = sqliteTable(
  "analysis_results",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => chatTurns.id, { onDelete: "cascade" }),
    inputFilesJson: text("input_files_json").notNull().default("[]"),
    csvSchemasJson: text("csv_schemas_json").notNull().default("[]"),
    chartJson: text("chart_json").notNull(),
    pointCount: integer("point_count").notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("analysis_results_expires_at_idx").on(table.expiresAt),
    index("analysis_results_org_turn_user_idx").on(
      table.organizationId,
      table.turnId,
      table.userId,
    ),
  ],
);

export const analysisWorkspaces = sqliteTable(
  "analysis_workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    title: text("title"),
    status: text("status", { enum: ["idle", "running", "completed", "failed"] })
      .notNull()
      .default("idle"),
    latestRevisionId: text("latest_revision_id"),
    latestSandboxRunId: text("latest_sandbox_run_id").references(() => sandboxRuns.runId, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "analysis_workspaces_status_check",
      sql`${table.status} in ('idle', 'running', 'completed', 'failed')`,
    ),
    uniqueIndex("analysis_workspaces_conversation_id_idx").on(table.conversationId),
    index("analysis_workspaces_org_updated_at_idx").on(table.organizationId, table.updatedAt),
    index("analysis_workspaces_user_updated_at_idx").on(table.userId, table.updatedAt),
    index("analysis_workspaces_latest_sandbox_run_id_idx").on(table.latestSandboxRunId),
  ],
);

export const analysisNotebookRevisions = sqliteTable(
  "analysis_notebook_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => analysisWorkspaces.id, { onDelete: "cascade" }),
    turnId: text("turn_id").references(() => chatTurns.id, { onDelete: "set null" }),
    revisionNumber: integer("revision_number").notNull(),
    notebookSource: text("notebook_source").notNull(),
    notebookPath: text("notebook_path").notNull(),
    htmlExportPath: text("html_export_path"),
    structuredResultPath: text("structured_result_path"),
    summary: text("summary"),
    sandboxRunId: text("sandbox_run_id").references(() => sandboxRuns.runId, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["running", "completed", "failed", "timed_out", "rejected"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "analysis_notebook_revisions_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'timed_out', 'rejected')`,
    ),
    uniqueIndex("analysis_notebook_revisions_workspace_revision_number_idx").on(
      table.workspaceId,
      table.revisionNumber,
    ),
    index("analysis_notebook_revisions_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("analysis_notebook_revisions_turn_id_idx").on(table.turnId),
    index("analysis_notebook_revisions_sandbox_run_id_idx").on(table.sandboxRunId),
    index("analysis_notebook_revisions_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const analysisPreviewSessions = sqliteTable(
  "analysis_preview_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => analysisWorkspaces.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => analysisNotebookRevisions.id, { onDelete: "cascade" }),
    sandboxRunId: text("sandbox_run_id").references(() => sandboxRuns.runId, {
      onDelete: "set null",
    }),
    previewTokenHash: text("preview_token_hash"),
    previewUrl: text("preview_url"),
    port: integer("port"),
    status: text("status", { enum: ["starting", "ready", "stopped", "failed"] })
      .notNull()
      .default("starting"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "analysis_preview_sessions_status_check",
      sql`${table.status} in ('starting', 'ready', 'stopped', 'failed')`,
    ),
    uniqueIndex("analysis_preview_sessions_preview_token_hash_idx").on(table.previewTokenHash),
    index("analysis_preview_sessions_workspace_updated_at_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    index("analysis_preview_sessions_revision_created_at_idx").on(
      table.revisionId,
      table.createdAt,
    ),
    index("analysis_preview_sessions_status_expires_at_idx").on(table.status, table.expiresAt),
    index("analysis_preview_sessions_sandbox_run_id_idx").on(table.sandboxRunId),
  ],
);

export const sandboxGeneratedAssets = sqliteTable(
  "sandbox_generated_assets",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => sandboxRuns.runId, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("sandbox_generated_assets_run_path_idx").on(table.runId, table.relativePath),
    index("sandbox_generated_assets_run_id_idx").on(table.runId),
    index("sandbox_generated_assets_expires_at_idx").on(table.expiresAt),
  ],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourcePath: text("source_path").notNull(),
    sourceType: text("source_type").notNull(),
    displayName: text("display_name").notNull().default(""),
    accessScope: text("access_scope", { enum: ["public", "admin"] })
      .notNull()
      .default("admin"),
    ingestionStatus: text("ingestion_status", {
      enum: ["pending", "ready", "failed"],
    })
      .notNull()
      .default("ready"),
    ingestionError: text("ingestion_error"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contentSha256: text("content_sha256").notNull(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastIndexedAt: integer("last_indexed_at"),
  },
  (table) => [
    check("documents_access_scope_check", sql`${table.accessScope} in ('public', 'admin')`),
    check(
      "documents_ingestion_status_check",
      sql`${table.ingestionStatus} in ('pending', 'ready', 'failed')`,
    ),
    uniqueIndex("documents_org_source_path_idx").on(table.organizationId, table.sourcePath),
    index("documents_organization_id_idx").on(table.organizationId),
    index("documents_org_source_type_idx").on(table.organizationId, table.sourceType),
    index("documents_org_access_scope_idx").on(table.organizationId, table.accessScope),
    index("documents_org_ingestion_status_idx").on(
      table.organizationId,
      table.ingestionStatus,
    ),
    index("documents_uploaded_by_user_id_idx").on(table.uploadedByUserId),
  ],
);

export const knowledgeImportJobs = sqliteTable(
  "knowledge_import_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    accessScope: text("access_scope", { enum: ["public", "admin"] }).notNull(),
    sourceKind: text("source_kind", {
      enum: ["single_file", "directory", "zip"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "completed_with_errors", "failed"],
    }).notNull(),
    triggerRequestId: text("trigger_request_id"),
    totalFileCount: integer("total_file_count").notNull().default(0),
    queuedFileCount: integer("queued_file_count").notNull().default(0),
    runningFileCount: integer("running_file_count").notNull().default(0),
    readyFileCount: integer("ready_file_count").notNull().default(0),
    failedFileCount: integer("failed_file_count").notNull().default(0),
    retryableFailedFileCount: integer("retryable_failed_file_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("knowledge_import_jobs_access_scope_check", sql`${table.accessScope} in ('public', 'admin')`),
    check(
      "knowledge_import_jobs_source_kind_check",
      sql`${table.sourceKind} in ('single_file', 'directory', 'zip')`,
    ),
    check(
      "knowledge_import_jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'completed_with_errors', 'failed')`,
    ),
    index("knowledge_import_jobs_org_created_at_idx").on(table.organizationId, table.createdAt),
    index("knowledge_import_jobs_org_status_updated_at_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    index("knowledge_import_jobs_created_by_user_id_idx").on(table.createdByUserId),
    index("knowledge_import_jobs_trigger_request_id_idx").on(table.triggerRequestId),
  ],
);

export const knowledgeImportJobFiles = sqliteTable(
  "knowledge_import_job_files",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => knowledgeImportJobs.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    relativePath: text("relative_path").notNull(),
    displayName: text("display_name").notNull(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    contentSha256: text("content_sha256"),
    archiveEntryPath: text("archive_entry_path"),
    stagingStoragePath: text("staging_storage_path").notNull(),
    stage: text("stage", {
      enum: ["queued", "validating", "extracting", "chunking", "indexing", "ready", "retryable_failed", "failed"],
    }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "knowledge_import_job_files_stage_check",
      sql`${table.stage} in ('queued', 'validating', 'extracting', 'chunking', 'indexing', 'ready', 'retryable_failed', 'failed')`,
    ),
    uniqueIndex("knowledge_import_job_files_job_relative_path_idx").on(
      table.jobId,
      table.relativePath,
    ),
    index("knowledge_import_job_files_org_stage_updated_at_idx").on(
      table.organizationId,
      table.stage,
      table.updatedAt,
    ),
    index("knowledge_import_job_files_job_stage_updated_at_idx").on(
      table.jobId,
      table.stage,
      table.updatedAt,
    ),
  ],
);

export const documentChunks = sqliteTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    tokenCount: integer("token_count"),
    contentSha256: text("content_sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("document_chunks_document_chunk_index_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("document_chunks_document_id_idx").on(table.documentId),
  ],
);

export const retrievalRuns = sqliteTable(
  "retrieval_runs",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => chatTurns.id, { onDelete: "cascade" }),
    pipelineVersion: text("pipeline_version").notNull(),
    status: text("status", { enum: ["started", "completed", "failed"] }).notNull(),
    embeddingModel: text("embedding_model"),
    rerankModel: text("rerank_model"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    check(
      "retrieval_runs_status_check",
      sql`${table.status} in ('started', 'completed', 'failed')`,
    ),
    index("retrieval_runs_turn_id_started_at_idx").on(table.turnId, table.startedAt),
  ],
);

export const retrievalRewrites = sqliteTable(
  "retrieval_rewrites",
  {
    id: text("id").primaryKey(),
    retrievalRunId: text("retrieval_run_id")
      .notNull()
      .references(() => retrievalRuns.id, { onDelete: "cascade" }),
    rewriteType: text("rewrite_type", {
      enum: ["contextual-rewrite", "hyde"],
    }).notNull(),
    inputText: text("input_text").notNull(),
    outputText: text("output_text").notNull(),
    modelName: text("model_name"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "retrieval_rewrites_type_check",
      sql`${table.rewriteType} in ('contextual-rewrite', 'hyde')`,
    ),
    index("retrieval_rewrites_run_id_created_at_idx").on(table.retrievalRunId, table.createdAt),
  ],
);

export const retrievalCandidates = sqliteTable(
  "retrieval_candidates",
  {
    id: text("id").primaryKey(),
    retrievalRunId: text("retrieval_run_id")
      .notNull()
      .references(() => retrievalRuns.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id),
    chunkId: text("chunk_id").references(() => documentChunks.id),
    bm25Score: real("bm25_score"),
    vectorScore: real("vector_score"),
    rrfScore: real("rrf_score"),
    rerankScore: real("rerank_score"),
    retrievalRank: integer("retrieval_rank"),
    rerankRank: integer("rerank_rank"),
    selectedForRerank: integer("selected_for_rerank", { mode: "boolean" })
      .notNull()
      .default(false),
    selectedForAnswer: integer("selected_for_answer", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("retrieval_candidates_run_id_idx").on(table.retrievalRunId),
    index("retrieval_candidates_run_id_retrieval_rank_idx").on(
      table.retrievalRunId,
      table.retrievalRank,
    ),
    index("retrieval_candidates_run_id_rerank_rank_idx").on(
      table.retrievalRunId,
      table.rerankRank,
    ),
  ],
);

export const responseCitations = sqliteTable(
  "response_citations",
  {
    id: text("id").primaryKey(),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => assistantMessages.id, { onDelete: "cascade" }),
    retrievalCandidateId: text("retrieval_candidate_id")
      .notNull()
      .references(() => retrievalCandidates.id, { onDelete: "cascade" }),
    citationIndex: integer("citation_index").notNull(),
  },
  (table) => [
    uniqueIndex("response_citations_message_citation_index_idx").on(
      table.assistantMessageId,
      table.citationIndex,
    ),
    index("response_citations_message_id_idx").on(table.assistantMessageId),
    index("response_citations_candidate_id_idx").on(table.retrievalCandidateId),
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
    statusCode: integer("status_code").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    modelName: text("model_name"),
    toolName: text("tool_name"),
    turnId: text("turn_id"),
    runtimeToolCallId: text("runtime_tool_call_id"),
    sandboxRunId: text("sandbox_run_id"),
    governanceJobId: text("governance_job_id"),
    knowledgeImportJobId: text("knowledge_import_job_id"),
    totalTokens: integer("total_tokens"),
    totalCostUsd: real("total_cost_usd"),
    durationMs: integer("duration_ms").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (table) => [
    index("request_logs_route_group_started_at_idx").on(table.routeGroup, table.startedAt),
    index("request_logs_organization_id_started_at_idx").on(table.organizationId, table.startedAt),
    index("request_logs_user_id_started_at_idx").on(table.userId, table.startedAt),
    index("request_logs_status_code_started_at_idx").on(table.statusCode, table.startedAt),
    index("request_logs_turn_id_started_at_idx").on(table.turnId, table.startedAt),
    index("request_logs_governance_job_id_started_at_idx").on(
      table.governanceJobId,
      table.startedAt,
    ),
    index("request_logs_knowledge_import_job_id_started_at_idx").on(
      table.knowledgeImportJobId,
      table.startedAt,
    ),
  ],
);

export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    requestLogId: text("request_log_id").references(() => requestLogs.id, {
      onDelete: "set null",
    }),
    routeKey: text("route_key").notNull(),
    routeGroup: text("route_group").notNull(),
    eventType: text("event_type").notNull(),
    usageClass: text("usage_class", {
      enum: ["analysis", "chart", "chat", "document", "import", "search", "system"],
    })
      .notNull()
      .default("system"),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
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
    check(
      "usage_events_usage_class_check",
      sql`${table.usageClass} in ('analysis', 'chart', 'chat', 'document', 'import', 'search', 'system')`,
    ),
    index("usage_events_route_group_created_at_idx").on(table.routeGroup, table.createdAt),
    index("usage_events_organization_id_created_at_idx").on(table.organizationId, table.createdAt),
    index("usage_events_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("usage_events_event_type_created_at_idx").on(table.eventType, table.createdAt),
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
    alertRetentionDays: integer("alert_retention_days"),
    chatHistoryRetentionDays: integer("chat_history_retention_days"),
    knowledgeImportRetentionDays: integer("knowledge_import_retention_days"),
    exportArtifactRetentionDays: integer("export_artifact_retention_days")
      .notNull()
      .default(7),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_compliance_settings_org_idx").on(table.organizationId),
    index("organization_compliance_settings_updated_by_user_id_idx").on(table.updatedByUserId),
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
    jobType: text("job_type", {
      enum: [
        "organization_export",
        "knowledge_delete",
        "history_purge",
        "import_metadata_purge",
      ],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    }).notNull(),
    triggerRequestId: text("trigger_request_id"),
    triggerKind: text("trigger_kind", { enum: ["manual", "automatic"] })
      .notNull()
      .default("manual"),
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
    check(
      "governance_jobs_type_check",
      sql`${table.jobType} in ('organization_export', 'knowledge_delete', 'history_purge', 'import_metadata_purge')`,
    ),
    check(
      "governance_jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
    check(
      "governance_jobs_trigger_kind_check",
      sql`${table.triggerKind} in ('manual', 'automatic')`,
    ),
    index("governance_jobs_org_created_at_idx").on(table.organizationId, table.createdAt),
    index("governance_jobs_org_status_updated_at_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    index("governance_jobs_requested_by_user_id_idx").on(table.requestedByUserId),
    index("governance_jobs_type_completed_at_idx").on(table.jobType, table.completedAt),
    index("governance_jobs_trigger_request_id_idx").on(table.triggerRequestId),
  ],
);

export const workflows = sqliteTable(
  "workflows",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility", {
      enum: ["private", "organization"],
    })
      .notNull()
      .default("organization"),
    status: text("status", {
      enum: ["draft", "active", "paused", "archived"],
    })
      .notNull()
      .default("draft"),
    currentVersionId: text("current_version_id"),
    lastEnabledByUserId: text("last_enabled_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    nextRunAt: integer("next_run_at"),
    lastRunAt: integer("last_run_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflows_visibility_check",
      sql`${table.visibility} in ('private', 'organization')`,
    ),
    check(
      "workflows_status_check",
      sql`${table.status} in ('draft', 'active', 'paused', 'archived')`,
    ),
    index("workflows_org_status_next_run_at_idx").on(
      table.organizationId,
      table.status,
      table.nextRunAt,
    ),
    index("workflows_org_updated_at_idx").on(table.organizationId, table.updatedAt),
    index("workflows_current_version_id_idx").on(table.currentVersionId),
    index("workflows_created_by_user_id_idx").on(table.createdByUserId),
  ],
);

export const workflowVersions = sqliteTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    inputContractJson: text("input_contract_json").notNull(),
    inputBindingsJson: text("input_bindings_json").notNull(),
    recipeJson: text("recipe_json").notNull(),
    thresholdsJson: text("thresholds_json").notNull(),
    outputsJson: text("outputs_json").notNull(),
    deliveryJson: text("delivery_json").notNull(),
    scheduleJson: text("schedule_json").notNull(),
    executionIdentityJson: text("execution_identity_json").notNull(),
    provenanceJson: text("provenance_json").notNull().default("{}"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_versions_workflow_id_version_number_idx").on(
      table.workflowId,
      table.versionNumber,
    ),
    index("workflow_versions_workflow_id_created_at_idx").on(table.workflowId, table.createdAt),
    index("workflow_versions_org_created_at_idx").on(table.organizationId, table.createdAt),
    index("workflow_versions_created_by_user_id_idx").on(table.createdByUserId),
  ],
);

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    triggerKind: text("trigger_kind", {
      enum: ["manual", "scheduled", "resume"],
    }).notNull(),
    triggerWindowKey: text("trigger_window_key"),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_for_input",
        "blocked_validation",
        "completed",
        "failed",
        "cancelled",
      ],
    })
      .notNull()
      .default("queued"),
    runAsUserId: text("run_as_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    runAsRole: text("run_as_role", { enum: ["member", "admin", "owner"] }).notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    failureReason: text("failure_reason"),
    requestId: text("request_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflow_runs_trigger_kind_check",
      sql`${table.triggerKind} in ('manual', 'scheduled', 'resume')`,
    ),
    check(
      "workflow_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'waiting_for_input', 'blocked_validation', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "workflow_runs_run_as_role_check",
      sql`${table.runAsRole} in ('member', 'admin', 'owner')`,
    ),
    check(
      "workflow_runs_trigger_window_key_check",
      sql`(
        (${table.triggerKind} = 'scheduled' and ${table.triggerWindowKey} is not null)
        or (${table.triggerKind} in ('manual', 'resume') and ${table.triggerWindowKey} is null)
      )`,
    ),
    uniqueIndex("workflow_runs_scheduled_window_unique_idx").on(
      table.workflowId,
      table.triggerKind,
      table.triggerWindowKey,
    ),
    index("workflow_runs_workflow_id_created_at_idx").on(table.workflowId, table.createdAt),
    index("workflow_runs_org_status_created_at_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("workflow_runs_status_updated_at_idx").on(table.status, table.updatedAt),
    index("workflow_runs_trigger_window_key_idx").on(table.triggerWindowKey),
    index("workflow_runs_run_as_user_id_created_at_idx").on(table.runAsUserId, table.createdAt),
    index("workflow_runs_request_id_idx").on(table.requestId),
  ],
);

export const workflowRunSteps = sqliteTable(
  "workflow_run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    stepOrder: integer("step_order").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "skipped"],
    })
      .notNull()
      .default("queued"),
    inputJson: text("input_json").notNull().default("{}"),
    outputJson: text("output_json").notNull().default("{}"),
    sandboxRunId: text("sandbox_run_id").references(() => sandboxRuns.runId, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflow_run_steps_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'skipped')`,
    ),
    uniqueIndex("workflow_run_steps_run_id_step_key_idx").on(table.runId, table.stepKey),
    index("workflow_run_steps_run_id_step_order_idx").on(table.runId, table.stepOrder),
    index("workflow_run_steps_run_id_status_idx").on(table.runId, table.status),
    index("workflow_run_steps_sandbox_run_id_idx").on(table.sandboxRunId),
  ],
);

export const workflowRunInputChecks = sqliteTable(
  "workflow_run_input_checks",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    inputKey: text("input_key").notNull(),
    status: text("status", { enum: ["pass", "warn", "fail"] }).notNull(),
    reportJson: text("report_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflow_run_input_checks_status_check",
      sql`${table.status} in ('pass', 'warn', 'fail')`,
    ),
    uniqueIndex("workflow_run_input_checks_run_id_input_key_idx").on(table.runId, table.inputKey),
    index("workflow_run_input_checks_run_id_status_idx").on(table.runId, table.status),
    index("workflow_run_input_checks_org_created_at_idx").on(table.organizationId, table.createdAt),
  ],
);

export const workflowInputRequests = sqliteTable(
  "workflow_input_requests",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["open", "sent", "fulfilled", "expired", "cancelled"],
    })
      .notNull()
      .default("open"),
    requestedInputKeysJson: text("requested_input_keys_json").notNull().default("[]"),
    notificationChannelsJson: text("notification_channels_json").notNull().default("[]"),
    message: text("message"),
    sentAt: integer("sent_at"),
    fulfilledAt: integer("fulfilled_at"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflow_input_requests_status_check",
      sql`${table.status} in ('open', 'sent', 'fulfilled', 'expired', 'cancelled')`,
    ),
    index("workflow_input_requests_run_id_status_updated_at_idx").on(
      table.runId,
      table.status,
      table.updatedAt,
    ),
    index("workflow_input_requests_org_status_updated_at_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    index("workflow_input_requests_status_expires_at_idx").on(table.status, table.expiresAt),
  ],
);

export const workflowDeliveries = sqliteTable(
  "workflow_deliveries",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    channelKind: text("channel_kind", {
      enum: ["webhook", "chart_pack", "ranked_table", "generated_document", "email"],
    }).notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    payloadSnapshotJson: text("payload_snapshot_json").notNull(),
    artifactManifestJson: text("artifact_manifest_json").notNull().default("[]"),
    responseStatusCode: integer("response_status_code"),
    responseBody: text("response_body"),
    errorMessage: text("error_message"),
    nextRetryAt: integer("next_retry_at"),
    sentAt: integer("sent_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "workflow_deliveries_channel_kind_check",
      sql`${table.channelKind} in ('webhook', 'chart_pack', 'ranked_table', 'generated_document', 'email')`,
    ),
    check(
      "workflow_deliveries_status_check",
      sql`${table.status} in ('pending', 'sent', 'failed')`,
    ),
    uniqueIndex("workflow_deliveries_run_id_channel_attempt_idx").on(
      table.runId,
      table.channelKind,
      table.attemptNumber,
    ),
    index("workflow_deliveries_run_id_created_at_idx").on(table.runId, table.createdAt),
    index("workflow_deliveries_org_status_next_retry_at_idx").on(
      table.organizationId,
      table.status,
      table.nextRetryAt,
    ),
    index("workflow_deliveries_status_created_at_idx").on(table.status, table.createdAt),
  ],
);
