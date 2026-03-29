import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { assistantMessages, chatTurns, toolCalls, users } from "@/lib/app-schema";
import type {
  ChatTurnLog,
  ToolCallStatus,
} from "@/lib/audit-types";
import type { UserRole } from "@/lib/roles";

function normalizeLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

export async function createChatTurnLog(input: {
  chatSessionId: string;
  organizationId: string;
  userPromptText: string;
  userRole: UserRole;
  userId: string;
}) {
  const db = await getAppDatabase();
  const turnId = randomUUID();

  await db.insert(chatTurns).values({
    id: turnId,
    organizationId: input.organizationId,
    chatSessionId: input.chatSessionId,
    userId: input.userId,
    userRole: input.userRole,
    userPromptText: input.userPromptText,
    createdAt: Date.now(),
  });

  return { turnId };
}

export async function startToolCallLog(input: {
  toolParametersJson: string;
  turnId: string;
  runtimeToolCallId: string;
  toolName: string;
}) {
  const db = await getAppDatabase();

  await db.insert(toolCalls).values({
    id: randomUUID(),
    turnId: input.turnId,
    runtimeToolCallId: input.runtimeToolCallId,
    toolName: input.toolName,
    toolParametersJson: input.toolParametersJson,
    accessedFilesJson: "[]",
    status: "started",
    resultSummary: null,
    errorMessage: null,
    startedAt: Date.now(),
    completedAt: null,
  });
}

function normalizeAccessedFiles(accessedFiles: string[] | undefined) {
  return [...new Set((accessedFiles ?? []).map((entry) => entry.trim()).filter(Boolean))];
}

export async function finishToolCallLog(input: {
  accessedFiles?: string[];
  errorMessage?: string | null;
  turnId: string;
  resultSummary?: string | null;
  status: ToolCallStatus;
  runtimeToolCallId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(toolCalls)
    .set({
      accessedFilesJson: JSON.stringify(normalizeAccessedFiles(input.accessedFiles)),
      completedAt: Date.now(),
      errorMessage: input.errorMessage ?? null,
      resultSummary: input.resultSummary ?? null,
      status: input.status,
    })
    .where(
      and(
        eq(toolCalls.turnId, input.turnId),
        eq(toolCalls.runtimeToolCallId, input.runtimeToolCallId),
      ),
    );
}

export async function createAssistantMessageLog(input: {
  messageText: string;
  messageTitle: string;
  turnId: string;
}) {
  const db = await getAppDatabase();
  const messageText = input.messageText.trim();
  const messageTitle = input.messageTitle.trim();

  if (!messageText || !messageTitle) {
    return;
  }

  await db.insert(assistantMessages).values({
    id: randomUUID(),
    turnId: input.turnId,
    messageTitle,
    messageText,
    createdAt: Date.now(),
  });
}

export async function chatTurnBelongsToUser(
  turnId: string,
  userId: string,
  organizationId: string,
) {
  const db = await getAppDatabase();
  const turn = await db.query.chatTurns.findFirst({
    columns: {
      organizationId: true,
      userId: true,
    },
    where: eq(chatTurns.id, turnId),
  });

  return turn?.userId === userId && turn.organizationId === organizationId;
}

export async function listRecentChatTurnLogs(
  organizationId: string,
  limit = 50,
): Promise<ChatTurnLog[]> {
  const db = await getAppDatabase();
  const normalizedLimit = normalizeLimit(limit);
  const turnRows = await db
    .select()
    .from(chatTurns)
    .where(eq(chatTurns.organizationId, organizationId))
    .orderBy(desc(chatTurns.createdAt))
    .limit(normalizedLimit);

  if (turnRows.length === 0) {
    return [];
  }

  const turnIds = turnRows.map((row) => row.id);
  const toolCallRows = await db
    .select()
    .from(toolCalls)
    .where(inArray(toolCalls.turnId, turnIds))
    .orderBy(desc(toolCalls.startedAt));
  const assistantMessageRows = await db
    .select()
    .from(assistantMessages)
    .where(inArray(assistantMessages.turnId, turnIds))
    .orderBy(desc(assistantMessages.createdAt));
  const userIds = [
    ...new Set(
      turnRows
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

  return turnRows.map((turnRow) => ({
    assistantMessages: assistantMessageRows
      .filter((assistantMessageRow) => assistantMessageRow.turnId === turnRow.id)
      .map((assistantMessageRow) => ({
        createdAt: assistantMessageRow.createdAt,
        id: assistantMessageRow.id,
        messageText: assistantMessageRow.messageText,
        messageTitle: assistantMessageRow.messageTitle,
        turnId: assistantMessageRow.turnId,
      })),
    chatSessionId: turnRow.chatSessionId,
    createdAt: turnRow.createdAt,
    id: turnRow.id,
    toolCalls: toolCallRows
      .filter((toolCallRow) => toolCallRow.turnId === turnRow.id)
      .map((toolCallRow) => ({
        accessedFiles: JSON.parse(toolCallRow.accessedFilesJson) as string[],
        completedAt: toolCallRow.completedAt,
        errorMessage: toolCallRow.errorMessage,
        id: toolCallRow.id,
        resultSummary: toolCallRow.resultSummary,
        runtimeToolCallId: toolCallRow.runtimeToolCallId,
        startedAt: toolCallRow.startedAt,
        status: toolCallRow.status,
        toolName: toolCallRow.toolName,
        toolParametersJson: toolCallRow.toolParametersJson,
        turnId: toolCallRow.turnId,
      })),
    userEmail: turnRow.userId ? (usersById.get(turnRow.userId)?.email ?? null) : null,
    userId: turnRow.userId,
    userName: turnRow.userId ? (usersById.get(turnRow.userId)?.name ?? null) : null,
    userPromptText: turnRow.userPromptText,
    userRole: turnRow.userRole,
  }));
}
