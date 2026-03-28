import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const auditPrompts = sqliteTable("audit_prompts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  role: text("role", { enum: ["intern", "owner"] }).notNull(),
  promptText: text("prompt_text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const auditToolCalls = sqliteTable(
  "audit_tool_calls",
  {
    id: text("id").primaryKey(),
    promptId: text("prompt_id")
      .notNull()
      .references(() => auditPrompts.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull().unique(),
    toolName: text("tool_name").notNull(),
    parametersJson: text("parameters_json").notNull(),
    accessedFilesJson: text("accessed_files_json").notNull().default("[]"),
    status: text("status", { enum: ["started", "completed", "error"] }).notNull(),
    resultSummary: text("result_summary"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    check(
      "audit_tool_calls_status_check",
      sql`${table.status} in ('started', 'completed', 'error')`,
    ),
  ],
);

export const auditTraceEvents = sqliteTable("audit_trace_events", {
  id: text("id").primaryKey(),
  promptId: text("prompt_id")
    .notNull()
    .references(() => auditPrompts.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: [
      "assistant-text",
      "assistant-thinking",
      "assistant-tool-plan",
      "tool-call",
      "tool-result",
    ],
  }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sandboxRuns = sqliteTable("sandbox_runs", {
  workspaceId: text("workspace_id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  generatedAssetsJson: text("generated_assets_json").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
});
