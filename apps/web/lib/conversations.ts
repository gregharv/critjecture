import "server-only";

import { and, desc, eq } from "drizzle-orm";

import type { AgentMessage, SessionData, SessionMetadata } from "@mariozechner/pi-web-ui";

import { getAppDatabase } from "@/lib/app-db";
import { DEFAULT_CHAT_THINKING_LEVEL } from "@/lib/chat-models";
import { conversations } from "@/lib/app-schema";
import type {
  ConversationMetadata,
  ConversationSessionData,
} from "@/lib/conversation-types";
import type { UserRole } from "@/lib/roles";

type ConversationUsage = SessionMetadata["usage"];

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

function getRoleRank(role: UserRole) {
  return role === "owner" ? 1 : 0;
}

function canAccessConversation(currentRole: UserRole, storedRole: UserRole) {
  return getRoleRank(currentRole) >= getRoleRank(storedRole);
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
): ConversationMetadata {
  const title = sessionData.title.trim() || buildConversationTitle(sessionData.messages);

  return {
    id: sessionData.id,
    title,
    createdAt: sessionData.createdAt,
    lastModified: sessionData.lastModified,
    messageCount: sessionData.messages.length,
    usage: buildUsage(sessionData.messages),
    thinkingLevel: sessionData.thinkingLevel,
    preview: buildPreviewText(sessionData.messages),
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
  const normalizedSessionData = normalizeConversationSessionData(
    input.sessionData,
    input.conversationId,
  );
  const metadata = buildConversationMetadata(normalizedSessionData);

  await db
    .insert(conversations)
    .values({
      id: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
      userRole: input.userRole,
      title: metadata.title,
      previewText: metadata.preview,
      messageCount: metadata.messageCount,
      usageJson: JSON.stringify(metadata.usage),
      sessionDataJson: JSON.stringify({
        ...normalizedSessionData,
        title: metadata.title,
        lastModified: new Date(now).toISOString(),
      }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: conversations.id,
      set: {
        organizationId: input.organizationId,
        userId: input.userId,
        userRole: input.userRole,
        title: metadata.title,
        previewText: metadata.preview,
        messageCount: metadata.messageCount,
        usageJson: JSON.stringify(metadata.usage),
        sessionDataJson: JSON.stringify({
          ...normalizedSessionData,
          title: metadata.title,
          lastModified: new Date(now).toISOString(),
        }),
        updatedAt: now,
      },
    });

  return {
    conversationId: input.conversationId,
    metadata: {
      ...metadata,
      title: metadata.title,
      lastModified: new Date(now).toISOString(),
    },
  };
}

export async function listUserConversations(input: {
  organizationId: string;
  userId: string;
  userRole: UserRole;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, input.organizationId),
        eq(conversations.userId, input.userId),
      ),
    )
    .orderBy(desc(conversations.updatedAt));

  return rows
    .filter((row) => canAccessConversation(input.userRole, row.userRole))
    .map<ConversationMetadata>((row) => {
      const sessionData = parseSessionDataJson(row.sessionDataJson);
      const normalizedSessionData = sessionData
        ? normalizeConversationSessionData(sessionData, row.id)
        : null;

      return {
        id: row.id,
        title: row.title,
        createdAt: new Date(row.createdAt).toISOString(),
        lastModified: new Date(row.updatedAt).toISOString(),
        messageCount: row.messageCount,
        usage: parseUsageJson(row.usageJson),
        thinkingLevel: normalizedSessionData?.thinkingLevel ?? DEFAULT_CHAT_THINKING_LEVEL,
        preview: row.previewText,
      };
    });
}

export async function getUserConversation(input: {
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
      eq(conversations.userId, input.userId),
    ),
  });

  if (!row || !canAccessConversation(input.userRole, row.userRole)) {
    return null;
  }

  const sessionData = parseSessionDataJson(row.sessionDataJson);

  if (!sessionData) {
    return null;
  }

  const normalizedSessionData = normalizeConversationSessionData(sessionData, row.id);

  return {
    ...normalizedSessionData,
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt).toISOString(),
    lastModified: new Date(row.updatedAt).toISOString(),
  } satisfies ConversationSessionData;
}
