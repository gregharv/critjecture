import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAuditDatabase } from "@/lib/audit-db";
import { auditPrompts, auditToolCalls } from "@/lib/audit-schema";
import type { AuditPromptLog, AuditToolCallStatus } from "@/lib/audit-types";
import type { UserRole } from "@/lib/roles";

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

export async function createAuditPromptLog(input: {
  promptText: string;
  role: UserRole;
  sessionId: string;
}) {
  const db = await getAuditDatabase();
  const promptId = randomUUID();

  await db.insert(auditPrompts).values({
    id: promptId,
    sessionId: input.sessionId,
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
  const db = await getAuditDatabase();

  await db.insert(auditToolCalls).values({
    id: randomUUID(),
    promptId: input.promptId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    parametersJson: input.parametersJson,
    status: "started",
    resultSummary: null,
    errorMessage: null,
    createdAt: Date.now(),
    completedAt: null,
  });
}

export async function finishAuditToolCallLog(input: {
  errorMessage?: string | null;
  promptId: string;
  resultSummary?: string | null;
  status: AuditToolCallStatus;
  toolCallId: string;
}) {
  const db = await getAuditDatabase();

  await db
    .update(auditToolCalls)
    .set({
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

export async function listRecentAuditPromptLogs(limit = 50): Promise<AuditPromptLog[]> {
  const db = await getAuditDatabase();
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

  return promptRows.map((promptRow) => ({
    createdAt: promptRow.createdAt,
    id: promptRow.id,
    promptText: promptRow.promptText,
    role: promptRow.role,
    sessionId: promptRow.sessionId,
    toolCalls: toolCallRows
      .filter((toolCallRow) => toolCallRow.promptId === promptRow.id)
      .map((toolCallRow) => ({
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
