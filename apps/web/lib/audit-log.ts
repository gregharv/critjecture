import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/audit-db";
import { auditPrompts, auditToolCalls, auditTraceEvents, users } from "@/lib/audit-schema";
import type {
  AuditPromptLog,
  AuditToolCallStatus,
  AuditTraceEventKind,
} from "@/lib/audit-types";
import type { UserRole } from "@/lib/roles";

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

export async function createAuditPromptLog(input: {
  chatSessionId: string;
  promptText: string;
  role: UserRole;
  userId: string;
}) {
  const db = await getAppDatabase();
  const promptId = randomUUID();

  await db.insert(auditPrompts).values({
    id: promptId,
    sessionId: input.chatSessionId,
    userId: input.userId,
    role: input.role,
    promptText: input.promptText,
    createdAt: Date.now(),
  });

  return { promptId };
}

export async function startAuditToolCallLog(input: {
  parametersJson: string;
  promptId: string;
  toolCallId: string;
  toolName: string;
}) {
  const db = await getAppDatabase();

  await db.insert(auditToolCalls).values({
    id: randomUUID(),
    promptId: input.promptId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    parametersJson: input.parametersJson,
    accessedFilesJson: "[]",
    status: "started",
    resultSummary: null,
    errorMessage: null,
    createdAt: Date.now(),
    completedAt: null,
  });
}

function normalizeAccessedFiles(accessedFiles: string[] | undefined) {
  return [...new Set((accessedFiles ?? []).map((entry) => entry.trim()).filter(Boolean))];
}

export async function finishAuditToolCallLog(input: {
  accessedFiles?: string[];
  errorMessage?: string | null;
  promptId: string;
  resultSummary?: string | null;
  status: AuditToolCallStatus;
  toolCallId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(auditToolCalls)
    .set({
      accessedFilesJson: JSON.stringify(normalizeAccessedFiles(input.accessedFiles)),
      completedAt: Date.now(),
      errorMessage: input.errorMessage ?? null,
      resultSummary: input.resultSummary ?? null,
      status: input.status,
    })
    .where(
      and(
        eq(auditToolCalls.promptId, input.promptId),
        eq(auditToolCalls.toolCallId, input.toolCallId),
      ),
    );
}

export async function createAuditTraceEventLog(input: {
  content: string;
  kind: AuditTraceEventKind;
  promptId: string;
  title: string;
}) {
  const db = await getAppDatabase();
  const content = input.content.trim();
  const title = input.title.trim();

  if (!content || !title) {
    return;
  }

  await db.insert(auditTraceEvents).values({
    id: randomUUID(),
    promptId: input.promptId,
    kind: input.kind,
    title,
    content,
    createdAt: Date.now(),
  });
}

export async function auditPromptBelongsToUser(promptId: string, userId: string) {
  const db = await getAppDatabase();
  const prompt = await db.query.auditPrompts.findFirst({
    columns: {
      userId: true,
    },
    where: eq(auditPrompts.id, promptId),
  });

  return prompt?.userId === userId;
}

export async function listRecentAuditPromptLogs(limit = 50): Promise<AuditPromptLog[]> {
  const db = await getAppDatabase();
  const normalizedLimit = normalizeLimit(limit);
  const promptRows = await db
    .select()
    .from(auditPrompts)
    .orderBy(desc(auditPrompts.createdAt))
    .limit(normalizedLimit);

  if (promptRows.length === 0) {
    return [];
  }

  const promptIds = promptRows.map((row) => row.id);
  const toolCallRows = await db
    .select()
    .from(auditToolCalls)
    .where(inArray(auditToolCalls.promptId, promptIds))
    .orderBy(desc(auditToolCalls.createdAt));
  const traceEventRows = await db
    .select()
    .from(auditTraceEvents)
    .where(inArray(auditTraceEvents.promptId, promptIds))
    .orderBy(desc(auditTraceEvents.createdAt));
  const userIds = [
    ...new Set(
      promptRows
        .map((row) => row.userId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const userRows =
    userIds.length > 0
      ? await db
          .select({
            email: users.email,
            id: users.id,
            name: users.name,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const usersById = new Map(userRows.map((row) => [row.id, row]));

  return promptRows.map((promptRow) => ({
    chatSessionId: promptRow.sessionId,
    createdAt: promptRow.createdAt,
    id: promptRow.id,
    promptText: promptRow.promptText,
    role: promptRow.role,
    userEmail: promptRow.userId ? (usersById.get(promptRow.userId)?.email ?? null) : null,
    userId: promptRow.userId,
    userName: promptRow.userId ? (usersById.get(promptRow.userId)?.name ?? null) : null,
    traceEvents: traceEventRows
      .filter((traceEventRow) => traceEventRow.promptId === promptRow.id)
      .map((traceEventRow) => ({
        content: traceEventRow.content,
        createdAt: traceEventRow.createdAt,
        id: traceEventRow.id,
        kind: traceEventRow.kind,
        promptId: traceEventRow.promptId,
        title: traceEventRow.title,
      })),
    toolCalls: toolCallRows
      .filter((toolCallRow) => toolCallRow.promptId === promptRow.id)
      .map((toolCallRow) => ({
        accessedFiles: JSON.parse(toolCallRow.accessedFilesJson) as string[],
        completedAt: toolCallRow.completedAt,
        createdAt: toolCallRow.createdAt,
        errorMessage: toolCallRow.errorMessage,
        id: toolCallRow.id,
        parametersJson: toolCallRow.parametersJson,
        promptId: toolCallRow.promptId,
        resultSummary: toolCallRow.resultSummary,
        status: toolCallRow.status,
        toolCallId: toolCallRow.toolCallId,
        toolName: toolCallRow.toolName,
      })),
  }));
}
