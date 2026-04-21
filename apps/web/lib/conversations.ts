import "server-only";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AgentMessage, SessionData, SessionMetadata } from "@mariozechner/pi-web-ui";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { conversationPins, conversations } from "@/lib/legacy-app-schema";
import { DEFAULT_CHAT_THINKING_LEVEL } from "@/lib/chat-models";
import type {
  ConversationMetadata,
  ConversationSessionData,
  ConversationVisibility,
} from "@/lib/conversation-types";
import {
  fromLegacyStoredUserRole,
  toLegacyStoredUserRole,
  type UserRole,
} from "@/lib/roles";

type ConversationUsage = SessionMetadata["usage"];
type ConversationRow = typeof conversations.$inferSelect;

const EMPTY_USAGE: ConversationUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export class ConversationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ConversationError";
    this.status = status;
  }
}

function getRoleRank(role: UserRole) {
  return role === "owner" ? 1 : 0;
}

function canAccessConversation(currentRole: UserRole, storedRole: "intern" | "owner") {
  return getRoleRank(currentRole) >= getRoleRank(fromLegacyStoredUserRole(storedRole));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTextParts(value: unknown) {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    if (entry.type === "text" && typeof entry.text === "string") {
      return [entry.text];
    }

    return [];
  });
}

function getMessageText(message: AgentMessage) {
  if (message.role === "user" || message.role === "assistant") {
    return getTextParts(message.content).join("\n").trim();
  }

  if (message.role === "user-with-attachments") {
    return getTextParts(message.content).join("\n").trim();
  }

  return "";
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildConversationTitle(messages: AgentMessage[]) {
  const firstPrompt =
    messages.find(
      (message) => message.role === "user" || message.role === "user-with-attachments",
    ) ?? null;
  const text = firstPrompt ? getMessageText(firstPrompt) : "";

  return truncateText(text || "Untitled conversation", 80);
}

function buildPreviewText(messages: AgentMessage[]) {
  const preview = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => getMessageText(message))
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return truncateText(preview, 2_000);
}

function buildUsage(messages: AgentMessage[]) {
  return messages.reduce<ConversationUsage>((usage, message) => {
    if (message.role !== "assistant" || !isRecord(message.usage)) {
      return usage;
    }

    const messageUsage = message.usage;
    const messageCost = (isRecord(messageUsage.cost) ? messageUsage.cost : {}) as Record<
      string,
      unknown
    >;

    return {
      input:
        usage.input +
        (typeof messageUsage.input === "number" ? messageUsage.input : 0),
      output:
        usage.output +
        (typeof messageUsage.output === "number" ? messageUsage.output : 0),
      cacheRead:
        usage.cacheRead +
        (typeof messageUsage.cacheRead === "number" ? messageUsage.cacheRead : 0),
      cacheWrite:
        usage.cacheWrite +
        (typeof messageUsage.cacheWrite === "number" ? messageUsage.cacheWrite : 0),
      totalTokens:
        usage.totalTokens +
        (typeof messageUsage.totalTokens === "number" ? messageUsage.totalTokens : 0),
      cost: {
        input:
          usage.cost.input +
          (typeof messageCost.input === "number" ? messageCost.input : 0),
        output:
          usage.cost.output +
          (typeof messageCost.output === "number" ? messageCost.output : 0),
        cacheRead:
          usage.cost.cacheRead +
          (typeof messageCost.cacheRead === "number" ? messageCost.cacheRead : 0),
        cacheWrite:
          usage.cost.cacheWrite +
          (typeof messageCost.cacheWrite === "number" ? messageCost.cacheWrite : 0),
        total:
          usage.cost.total +
          (typeof messageCost.total === "number" ? messageCost.total : 0),
      },
    };
  }, EMPTY_USAGE);
}

function parseUsageJson(value: string): ConversationUsage {
  try {
    const parsed = JSON.parse(value) as ConversationUsage;

    if (isRecord(parsed) && isRecord(parsed.cost)) {
      return {
        input: typeof parsed.input === "number" ? parsed.input : 0,
        output: typeof parsed.output === "number" ? parsed.output : 0,
        cacheRead: typeof parsed.cacheRead === "number" ? parsed.cacheRead : 0,
        cacheWrite: typeof parsed.cacheWrite === "number" ? parsed.cacheWrite : 0,
        totalTokens: typeof parsed.totalTokens === "number" ? parsed.totalTokens : 0,
        cost: {
          input: typeof parsed.cost.input === "number" ? parsed.cost.input : 0,
          output: typeof parsed.cost.output === "number" ? parsed.cost.output : 0,
          cacheRead:
            typeof parsed.cost.cacheRead === "number" ? parsed.cost.cacheRead : 0,
          cacheWrite:
            typeof parsed.cost.cacheWrite === "number" ? parsed.cost.cacheWrite : 0,
          total: typeof parsed.cost.total === "number" ? parsed.cost.total : 0,
        },
      };
    }
  } catch {
    return EMPTY_USAGE;
  }

  return EMPTY_USAGE;
}

function isConversationSessionData(value: unknown): value is ConversationSessionData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    typeof value.createdAt === "string" &&
    typeof value.lastModified === "string" &&
    "model" in value &&
    "thinkingLevel" in value
  );
}

function parseSessionDataJson(value: string) {
  try {
    const parsed = JSON.parse(value);

    if (isConversationSessionData(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeConversationVisibility(value: unknown): ConversationVisibility {
  return value === "organization" ? "organization" : "private";
}

function normalizeManualTitle(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? truncateText(normalized, 120) : null;
}

function buildResolvedConversationTitle(
  sessionData: ConversationSessionData,
  manualTitle?: string | null,
) {
  const nextManualTitle = normalizeManualTitle(manualTitle);

  if (nextManualTitle) {
    return nextManualTitle;
  }

  const sessionTitle = sessionData.title.trim();
  return sessionTitle || buildConversationTitle(sessionData.messages);
}

function buildConversationMetadataFromRow(
  row: ConversationRow,
  options: {
    canManage: boolean;
    isPinned: boolean;
  },
): ConversationMetadata {
  const sessionData = parseSessionDataJson(row.sessionDataJson);
  const normalizedSessionData = sessionData
    ? normalizeConversationSessionData(sessionData, row.id)
    : null;

  const manualTitle = normalizeManualTitle(row.manualTitle);
  const title = manualTitle || row.title || buildConversationTitle(normalizedSessionData?.messages ?? []);

  return {
    id: row.id,
    title,
    createdAt: new Date(row.createdAt).toISOString(),
    lastModified: new Date(row.updatedAt).toISOString(),
    messageCount: row.messageCount,
    usage: parseUsageJson(row.usageJson),
    thinkingLevel: normalizedSessionData?.thinkingLevel ?? DEFAULT_CHAT_THINKING_LEVEL,
    preview: row.previewText,
    canManage: options.canManage,
    isPinned: options.isPinned,
    visibility: normalizeConversationVisibility(row.visibility),
  } satisfies ConversationMetadata;
}

async function listPinnedConversationIds(input: {
  organizationId: string;
  userId: string;
  conversationIds?: string[];
}) {
  const db = await getAppDatabase();
  const whereClause =
    input.conversationIds && input.conversationIds.length > 0
      ? and(
          eq(conversationPins.organizationId, input.organizationId),
          eq(conversationPins.userId, input.userId),
          inArray(conversationPins.conversationId, input.conversationIds),
        )
      : and(
          eq(conversationPins.organizationId, input.organizationId),
          eq(conversationPins.userId, input.userId),
        );

  const pinRows = await db
    .select({ conversationId: conversationPins.conversationId })
    .from(conversationPins)
    .where(whereClause);

  return new Set(pinRows.map((row) => row.conversationId));
}

async function getAccessibleConversationRow(input: {
  conversationId: string;
  organizationId: string;
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const row = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
      or(
        eq(conversations.userId, input.userId),
        eq(conversations.visibility, "organization"),
      ),
    ),
  });

  if (!row || !canAccessConversation(input.userRole, row.userRole)) {
    return null;
  }

  return row;
}

export function normalizeConversationSessionData(
  input: SessionData,
  conversationId: string,
): ConversationSessionData {
  const normalizedId = conversationId.trim();
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt.trim()
      ? input.createdAt
      : new Date().toISOString();
  const lastModified =
    typeof input.lastModified === "string" && input.lastModified.trim()
      ? input.lastModified
      : new Date().toISOString();

  return {
    ...input,
    id: normalizedId,
    title,
    createdAt,
    lastModified,
  };
}

export function buildConversationMetadata(
  sessionData: ConversationSessionData,
  options?: {
    canManage?: boolean;
    isPinned?: boolean;
    manualTitle?: string | null;
    visibility?: ConversationVisibility;
  },
): ConversationMetadata {
  const title = buildResolvedConversationTitle(sessionData, options?.manualTitle);

  return {
    id: sessionData.id,
    title,
    createdAt: sessionData.createdAt,
    lastModified: sessionData.lastModified,
    messageCount: sessionData.messages.length,
    usage: buildUsage(sessionData.messages),
    thinkingLevel: sessionData.thinkingLevel,
    preview: buildPreviewText(sessionData.messages),
    canManage: options?.canManage ?? true,
    isPinned: options?.isPinned ?? false,
    visibility: options?.visibility ?? "private",
  };
}

export async function upsertConversation(input: {
  conversationId: string;
  organizationId: string;
  sessionData: SessionData;
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const normalizedSessionData = normalizeConversationSessionData(
    input.sessionData,
    input.conversationId,
  );
  const existingRow = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.id, input.conversationId),
      eq(conversations.organizationId, input.organizationId),
    ),
  });

  if (existingRow && existingRow.userId !== input.userId) {
    throw new ConversationError(403, "Cannot overwrite a shared conversation you do not own.");
  }

  const manualTitle = normalizeManualTitle(existingRow?.manualTitle);
  const createdAt = existingRow ? new Date(existingRow.createdAt).toISOString() : normalizedSessionData.createdAt;
  const visibility = normalizeConversationVisibility(existingRow?.visibility);
  const persistedSessionData = {
    ...normalizedSessionData,
    createdAt,
    lastModified: nowIso,
  } satisfies ConversationSessionData;
  const metadata = buildConversationMetadata(persistedSessionData, {
    canManage: true,
    isPinned: false,
    manualTitle,
    visibility,
  });

  await db
    .insert(conversations)
    .values({
      id: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
      userRole: toLegacyStoredUserRole(input.userRole),
      visibility,
      title: metadata.title,
      manualTitle,
      previewText: metadata.preview,
      messageCount: metadata.messageCount,
      usageJson: JSON.stringify(metadata.usage),
      sessionDataJson: JSON.stringify({
        ...persistedSessionData,
        title: metadata.title,
      }),
      createdAt: existingRow?.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: conversations.id,
      set: {
        organizationId: input.organizationId,
        userId: input.userId,
        userRole: toLegacyStoredUserRole(input.userRole),
        visibility,
        title: metadata.title,
        manualTitle,
        previewText: metadata.preview,
        messageCount: metadata.messageCount,
        usageJson: JSON.stringify(metadata.usage),
        sessionDataJson: JSON.stringify({
          ...persistedSessionData,
          title: metadata.title,
        }),
        updatedAt: now,
      },
    });

  const pinIds = await listPinnedConversationIds({
    conversationIds: [input.conversationId],
    organizationId: input.organizationId,
    userId: input.userId,
  });

  return {
    conversationId: input.conversationId,
    metadata: {
      ...metadata,
      isPinned: pinIds.has(input.conversationId),
      lastModified: nowIso,
    },
  };
}

export async function listUserConversations(input: {
  organizationId: string;
  searchQuery?: string | null;
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const normalizedSearchQuery = input.searchQuery?.trim().toLowerCase() ?? "";
  const searchPattern = normalizedSearchQuery ? `%${normalizedSearchQuery}%` : null;
  const searchFilter =
    searchPattern === null
      ? undefined
      : sql`(
          lower(${conversations.title}) like ${searchPattern}
          or lower(${conversations.previewText}) like ${searchPattern}
        )`;

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, input.organizationId),
        or(
          eq(conversations.userId, input.userId),
          eq(conversations.visibility, "organization"),
        ),
        searchFilter,
      ),
    )
    .orderBy(desc(conversations.updatedAt));

  const accessibleRows = rows.filter((row) => canAccessConversation(input.userRole, row.userRole));
  const pinnedConversationIds = await listPinnedConversationIds({
    conversationIds: accessibleRows.map((row) => row.id),
    organizationId: input.organizationId,
    userId: input.userId,
  });

  return accessibleRows.map<ConversationMetadata>((row) =>
    buildConversationMetadataFromRow(row, {
      canManage: row.userId === input.userId,
      isPinned: pinnedConversationIds.has(row.id),
    }),
  );
}

export async function getUserConversation(input: {
  conversationId: string;
  organizationId: string;
  userId: string;
  userRole: UserRole;
}) {
  const row = await getAccessibleConversationRow(input);

  if (!row) {
    return null;
  }

  const sessionData = parseSessionDataJson(row.sessionDataJson);

  if (!sessionData) {
    return null;
  }

  const pinnedConversationIds = await listPinnedConversationIds({
    conversationIds: [row.id],
    organizationId: input.organizationId,
    userId: input.userId,
  });
  const metadata = buildConversationMetadataFromRow(row, {
    canManage: row.userId === input.userId,
    isPinned: pinnedConversationIds.has(row.id),
  });
  const normalizedSessionData = normalizeConversationSessionData(sessionData, row.id);

  return {
    conversation: {
      ...normalizedSessionData,
      id: row.id,
      title: metadata.title,
      createdAt: new Date(row.createdAt).toISOString(),
      lastModified: new Date(row.updatedAt).toISOString(),
    } satisfies ConversationSessionData,
    metadata,
  };
}

export async function updateConversation(input: {
  conversationId: string;
  organizationId: string;
  patch: {
    pinned?: boolean;
    title?: string;
    visibility?: ConversationVisibility;
  };
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const row = await getAccessibleConversationRow({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    userId: input.userId,
    userRole: input.userRole,
  });

  if (!row) {
    return null;
  }

  if (
    (typeof input.patch.title === "string" || typeof input.patch.visibility !== "undefined") &&
    row.userId !== input.userId
  ) {
    throw new ConversationError(403, "Only the conversation owner can rename or share it.");
  }

  if (typeof input.patch.pinned === "boolean") {
    const existingPin = await db.query.conversationPins.findFirst({
      where: and(
        eq(conversationPins.conversationId, row.id),
        eq(conversationPins.organizationId, input.organizationId),
        eq(conversationPins.userId, input.userId),
      ),
    });

    if (input.patch.pinned) {
      const now = Date.now();

      if (existingPin) {
        await db
          .update(conversationPins)
          .set({ updatedAt: now })
          .where(eq(conversationPins.id, existingPin.id));
      } else {
        await db.insert(conversationPins).values({
          id: randomUUID(),
          conversationId: row.id,
          organizationId: input.organizationId,
          userId: input.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else if (existingPin) {
      await db.delete(conversationPins).where(eq(conversationPins.id, existingPin.id));
    }
  }

  if (typeof input.patch.title === "string" || typeof input.patch.visibility !== "undefined") {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sessionData = parseSessionDataJson(row.sessionDataJson);

    if (!sessionData) {
      throw new ConversationError(500, "Conversation data is corrupted and could not be updated.");
    }

    const normalizedSessionData = normalizeConversationSessionData(sessionData, row.id);
    const manualTitle =
      typeof input.patch.title === "string"
        ? normalizeManualTitle(input.patch.title)
        : normalizeManualTitle(row.manualTitle);
    const visibility =
      typeof input.patch.visibility !== "undefined"
        ? normalizeConversationVisibility(input.patch.visibility)
        : normalizeConversationVisibility(row.visibility);
    const persistedSessionData = {
      ...normalizedSessionData,
      title: buildResolvedConversationTitle(normalizedSessionData, manualTitle),
      lastModified: nowIso,
    } satisfies ConversationSessionData;
    const metadata = buildConversationMetadata(persistedSessionData, {
      canManage: true,
      isPinned: false,
      manualTitle,
      visibility,
    });

    await db
      .update(conversations)
      .set({
        visibility,
        title: metadata.title,
        manualTitle,
        previewText: metadata.preview,
        messageCount: metadata.messageCount,
        usageJson: JSON.stringify(metadata.usage),
        sessionDataJson: JSON.stringify(persistedSessionData),
        updatedAt: now,
      })
      .where(eq(conversations.id, row.id));
  }

  const refreshedRow = await getAccessibleConversationRow({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    userId: input.userId,
    userRole: input.userRole,
  });

  if (!refreshedRow) {
    throw new ConversationError(404, "Conversation not found.");
  }

  const pinnedConversationIds = await listPinnedConversationIds({
    conversationIds: [refreshedRow.id],
    organizationId: input.organizationId,
    userId: input.userId,
  });

  return {
    metadata: buildConversationMetadataFromRow(refreshedRow, {
      canManage: refreshedRow.userId === input.userId,
      isPinned: pinnedConversationIds.has(refreshedRow.id),
    }),
  };
}

export async function deleteConversation(input: {
  conversationId: string;
  organizationId: string;
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const row = await getAccessibleConversationRow(input);

  if (!row) {
    return null;
  }

  if (row.userId !== input.userId) {
    throw new ConversationError(403, "Only the conversation owner can delete it.");
  }

  await db.delete(conversations).where(eq(conversations.id, row.id));

  return {
    conversationId: row.id,
  };
}
