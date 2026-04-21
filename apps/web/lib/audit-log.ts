import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/legacy-app-db";
import {
  assistantMessages,
  chatTurns,
  responseCitations,
  retrievalRuns,
  sandboxGeneratedAssets,
  sandboxRuns,
  toolCalls,
  users,
} from "@/lib/legacy-app-schema";
import type {
  AssistantMessageType,
  ChatTurnLog,
  ToolCallStatus,
  TurnStatus,
} from "@/lib/audit-types";
import { toLegacyStoredUserRole, type UserRole } from "@/lib/roles";

function normalizeLimit(limit: number | null | undefined) {
  if (limit === null || typeof limit === "undefined") {
    return null;
  }

  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(5_000, Math.trunc(limit)));
}

export async function createChatTurnLog(input: {
  conversationId: string;
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
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    chatSessionId: input.chatSessionId,
    completedAt: null,
    status: "started",
    userId: input.userId,
    userRole: toLegacyStoredUserRole(input.userRole),
    userPromptText: input.userPromptText,
    createdAt: Date.now(),
  });

  return { turnId };
}

export async function finishChatTurnLog(input: {
  status: Exclude<TurnStatus, "started">;
  turnId: string;
}) {
  const db = await getAppDatabase();

  await db
    .update(chatTurns)
    .set({
      completedAt: Date.now(),
      status: input.status,
    })
    .where(eq(chatTurns.id, input.turnId));
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
  sandboxRunId?: string | null;
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
      sandboxRunId: input.sandboxRunId ?? null,
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
  messageIndex: number;
  messageText: string;
  messageType: AssistantMessageType;
  modelName: string;
  turnId: string;
}) {
  const db = await getAppDatabase();
  const messageText = input.messageText.trim();
  const modelName = input.modelName.trim();

  if (!messageText || !modelName) {
    return;
  }

  await db.insert(assistantMessages).values({
    id: randomUUID(),
    messageIndex: input.messageIndex,
    turnId: input.turnId,
    messageType: input.messageType,
    messageText,
    modelName,
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
  limit?: number | null,
): Promise<ChatTurnLog[]> {
  const db = await getAppDatabase();
  const normalizedLimit = normalizeLimit(limit);
  const baseTurnQuery = db
    .select()
    .from(chatTurns)
    .where(eq(chatTurns.organizationId, organizationId))
    .orderBy(desc(chatTurns.createdAt));
  const turnRows =
    normalizedLimit === null
      ? await baseTurnQuery
      : await baseTurnQuery.limit(normalizedLimit);

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
  const retrievalRunRows = await db
    .select()
    .from(retrievalRuns)
    .where(inArray(retrievalRuns.turnId, turnIds))
    .orderBy(desc(retrievalRuns.startedAt));
  const assistantMessageIds = assistantMessageRows.map((row) => row.id);
  const citationRows =
    assistantMessageIds.length > 0
      ? await db
          .select()
          .from(responseCitations)
          .where(inArray(responseCitations.assistantMessageId, assistantMessageIds))
      : [];
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
  const sandboxRunIds = [
    ...new Set(
      toolCallRows
        .map((row) => row.sandboxRunId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];
  const sandboxRunRows =
    sandboxRunIds.length > 0
      ? await db
          .select()
          .from(sandboxRuns)
          .where(inArray(sandboxRuns.runId, sandboxRunIds))
      : [];
  const sandboxAssetRows =
    sandboxRunIds.length > 0
      ? await db
          .select()
          .from(sandboxGeneratedAssets)
          .where(inArray(sandboxGeneratedAssets.runId, sandboxRunIds))
      : [];
  const sandboxAssetsByRunId = new Map<string, typeof sandboxAssetRows>();

  for (const sandboxAssetRow of sandboxAssetRows) {
    const current = sandboxAssetsByRunId.get(sandboxAssetRow.runId) ?? [];
    current.push(sandboxAssetRow);
    sandboxAssetsByRunId.set(sandboxAssetRow.runId, current);
  }

  const sandboxRunsById = new Map(
    sandboxRunRows.map((row) => [
      row.runId,
      {
        artifactMaxBytes: row.artifactMaxBytes,
        artifactTtlMs: row.artifactTtlMs,
        cleanupCompletedAt: row.cleanupCompletedAt,
        cleanupError: row.cleanupError,
        cleanupStatus: row.cleanupStatus,
        completedAt: row.completedAt,
        cpuLimitSeconds: row.cpuLimitSeconds,
        exitCode: row.exitCode,
        failureReason: row.failureReason,
        generatedAssets: (sandboxAssetsByRunId.get(row.runId) ?? [])
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
          .map((assetRow) => ({
            byteSize: assetRow.byteSize,
            expiresAt: assetRow.expiresAt,
            fileName: assetRow.fileName,
            mimeType: assetRow.mimeType,
            relativePath: assetRow.relativePath,
          })),
        maxProcesses: row.maxProcesses,
        memoryLimitBytes: row.memoryLimitBytes,
        runId: row.runId,
        runner: row.runner,
        startedAt: row.startedAt,
        status: row.status,
        stdoutMaxBytes: row.stdoutMaxBytes,
        timeoutMs: row.timeoutMs,
        toolName: row.toolName,
      },
    ]),
  );

  return turnRows.map((turnRow) => ({
    assistantMessages: assistantMessageRows
      .filter((assistantMessageRow) => assistantMessageRow.turnId === turnRow.id)
      .map((assistantMessageRow) => ({
        createdAt: assistantMessageRow.createdAt,
        id: assistantMessageRow.id,
        messageIndex: assistantMessageRow.messageIndex,
        messageText: assistantMessageRow.messageText,
        messageType: assistantMessageRow.messageType,
        modelName: assistantMessageRow.modelName,
        turnId: assistantMessageRow.turnId,
      })),
    chatSessionId: turnRow.chatSessionId,
    completedAt: turnRow.completedAt,
    conversationId: turnRow.conversationId,
    createdAt: turnRow.createdAt,
    id: turnRow.id,
    responseCitations: citationRows
      .filter((citationRow) =>
        assistantMessageRows.some(
          (assistantMessageRow) =>
            assistantMessageRow.turnId === turnRow.id &&
            assistantMessageRow.id === citationRow.assistantMessageId,
        ),
      )
      .map((citationRow) => ({
        assistantMessageId: citationRow.assistantMessageId,
        citationIndex: citationRow.citationIndex,
        id: citationRow.id,
        retrievalCandidateId: citationRow.retrievalCandidateId,
      })),
    retrievalRuns: retrievalRunRows
      .filter((retrievalRunRow) => retrievalRunRow.turnId === turnRow.id)
      .map((retrievalRunRow) => ({
        completedAt: retrievalRunRow.completedAt,
        embeddingModel: retrievalRunRow.embeddingModel,
        errorMessage: retrievalRunRow.errorMessage,
        id: retrievalRunRow.id,
        pipelineVersion: retrievalRunRow.pipelineVersion,
        rerankModel: retrievalRunRow.rerankModel,
        startedAt: retrievalRunRow.startedAt,
        status: retrievalRunRow.status,
        turnId: retrievalRunRow.turnId,
      })),
    status: turnRow.status,
    toolCalls: toolCallRows
      .filter((toolCallRow) => toolCallRow.turnId === turnRow.id)
      .map((toolCallRow) => ({
        accessedFiles: JSON.parse(toolCallRow.accessedFilesJson) as string[],
        completedAt: toolCallRow.completedAt,
        errorMessage: toolCallRow.errorMessage,
        id: toolCallRow.id,
        resultSummary: toolCallRow.resultSummary,
        sandboxRun: toolCallRow.sandboxRunId
          ? (sandboxRunsById.get(toolCallRow.sandboxRunId) ?? null)
          : null,
        sandboxRunId: toolCallRow.sandboxRunId,
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
