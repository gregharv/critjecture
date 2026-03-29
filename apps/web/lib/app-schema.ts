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
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("users_role_check", sql`${table.role} in ('intern', 'owner')`)],
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
    role: text("role", { enum: ["intern", "owner"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "organization_memberships_role_check",
      sql`${table.role} in ('intern', 'owner')`,
    ),
    uniqueIndex("organization_memberships_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    generatedAssetsJson: text("generated_assets_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("sandbox_runs_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("sandbox_runs_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
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
    contentSha256: text("content_sha256").notNull(),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastIndexedAt: integer("last_indexed_at"),
  },
  (table) => [
    uniqueIndex("documents_org_source_path_idx").on(table.organizationId, table.sourcePath),
    index("documents_organization_id_idx").on(table.organizationId),
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
