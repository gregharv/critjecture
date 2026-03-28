import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auditPrompts = sqliteTable("audit_prompts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
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
