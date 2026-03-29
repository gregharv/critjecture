import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const chatTurns = sqliteTable("chat_turns", {
  id: text("id").primaryKey(),
  chatSessionId: text("chat_session_id").notNull(),
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  userRole: text("user_role", { enum: ["intern", "owner"] }).notNull(),
  userPromptText: text("user_prompt_text").notNull(),
  createdAt: integer("created_at").notNull(),
});

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
  ],
);

export const assistantMessages = sqliteTable("assistant_messages", {
  id: text("id").primaryKey(),
  turnId: text("turn_id")
    .notNull()
    .references(() => chatTurns.id, { onDelete: "cascade" }),
  messageTitle: text("message_title").notNull(),
  messageText: text("message_text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const sandboxRuns = sqliteTable("sandbox_runs", {
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
});
