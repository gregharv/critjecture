"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Agent, AgentMessage, SessionData } from "@mariozechner/pi-web-ui";

import {
  WorkflowBuilderModal,
  type SaveWorkflowDraftInput,
} from "@/components/workflow-builder-modal";
import type {
  CompanyKnowledgeCandidateFile,
  CompanyKnowledgeMatch,
} from "@/lib/company-knowledge-types";
import {
  createAskUserSelectionMessage,
  markAskUserSelectionSubmitted,
  registerAskUserMessageRenderers,
  ASK_USER_EVENT,
  type AskUserOption,
  type AskUserSelectionEventDetail,
} from "@/lib/ask-user-messages";
import {
  buildFileSelectionPrompt,
  createFileSelectionMessage,
  critjectureConvertToLlm,
  FILE_SELECTION_EVENT,
  markFileSelectionSelected,
  registerCritjectureMessageRenderers,
  type FileSelectionCandidate,
  type FileSelectionEventDetail,
} from "@/lib/file-selection-messages";
import type {
  ConversationMetadata,
  GetConversationResponse,
  ListConversationsResponse,
  UpsertConversationResponse,
} from "@/lib/conversation-types";
import type {
  AssistantMessageType,
  CreateChatTurnResponse,
  FinishChatTurnResponse,
  ToolCallStatus,
} from "@/lib/audit-types";
import type {
  BuildWorkflowFromChatTurnResponse,
  WorkflowDraftFromChatTurn,
} from "@/lib/workflow-builder-types";
import type {
  DataAnalysisToolResponse,
  GeneratedAssetToolResponse,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";
import { registerCritjectureToolRenderers } from "@/lib/tool-renderers";
import {
  DATA_ANALYSIS_CHAT_MODEL_ID,
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_CHAT_THINKING_LEVEL,
  getSessionModelId,
} from "@/lib/chat-models";
import { buildChatSystemPrompt } from "@/lib/chat-system-prompt";
import type { UserRole } from "@/lib/roles";

type ChatShellState = {
  error: string | null;
  ready: boolean;
};

type SearchToolResponse = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  matches: CompanyKnowledgeMatch[];
  recommendedFiles: string[];
  role: UserRole;
  selectedFiles: string[];
  selectionReason:
    | "single-candidate"
    | "unique-year-match"
    | "multiple-candidates"
    | "no-match";
  selectionRequired: boolean;
  scopeDescription: string;
  summary: string;
};

type BraveSearchToolResponse = {
  count: number;
  country: string;
  fetchContent: boolean;
  format: "one_line" | "raw_json" | "short";
  freshness?: "pd" | "pm" | "pw" | "py";
  query: string;
  results: Array<{
    age?: string;
    content?: string;
    contentFilePath?: string;
    snippet: string;
    title: string;
    url: string;
  }>;
  text: string;
};

type BraveGroundingToolResponse = {
  answer: string;
  citations: Array<{
    label: string;
    url: string;
  }>;
  enableCitations: boolean;
  enableEntities: boolean;
  enableResearch: boolean;
  maxAnswerChars: number;
  question: string;
  text: string;
  usage: unknown;
};

type AskUserToolResponse = {
  answer: string | null;
  cancelled: boolean;
  context?: string;
  options: AskUserOption[];
  question: string;
  wasCustom?: boolean;
};

type PendingChatTurn = {
  userPromptText: string;
  synthetic: boolean;
};

type PendingPlannerSearch = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  query: string;
  recommendedFiles: string[];
  selectedFiles: string[];
  selectionRequired: boolean;
};

type ConversationBootstrapState = {
  createdAt: string;
  id: string;
  initialSessionData: SessionData | null;
};

type CreateWorkflowResponse = {
  workflow?: {
    workflow?: {
      id?: string;
      name?: string;
    };
  };
};

const GRAPH_REVIEW_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const DATA_ANALYSIS_TEXT_ASSET_MAX_BYTES = 512 * 1024;
const DATA_ANALYSIS_TEXT_ASSET_PREVIEW_MAX_CHARS = 50_000;

function isUserAgentMessage(value: unknown): value is Extract<AgentMessage, { role: "user" }> {
  return typeof value === "object" && value !== null && "role" in value && value.role === "user";
}

function isAssistantAgentMessage(
  value: unknown,
): value is Extract<AgentMessage, { role: "assistant" }> {
  return (
    typeof value === "object" && value !== null && "role" in value && value.role === "assistant"
  );
}

function extractUserTextContent(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "type" in entry &&
        entry.type === "text" &&
        "text" in entry &&
        typeof entry.text === "string"
      ) {
        return entry.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractPromptText(input: string | AgentMessage | AgentMessage[]) {
  if (typeof input === "string") {
    return input.trim();
  }

  const messages = Array.isArray(input) ? input : [input];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (isUserAgentMessage(message)) {
      return extractUserTextContent(message.content);
    }
  }

  return "";
}

function stringifyToolArgs(args: unknown) {
  try {
    return JSON.stringify(args, null, 2) ?? "null";
  } catch {
    return String(args);
  }
}

function getToolResultSummary(result: {
  content?: Array<{ type: string; text?: string }>;
  details?: unknown;
}) {
  const textSummary =
    result.content
      ?.filter((content) => content.type === "text" && typeof content.text === "string")
      .map((content) => content.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n")
      .trim() ?? "";

  if (textSummary) {
    return textSummary;
  }

  if (
    typeof result.details === "object" &&
    result.details !== null &&
    "summary" in result.details &&
    typeof result.details.summary === "string"
  ) {
    return result.details.summary.trim();
  }

  return "";
}

function getErrorMessage(value: unknown, fallbackMessage: string) {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return fallbackMessage;
}

function extractSandboxRunId(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "sandboxRunId" in value &&
    typeof value.sandboxRunId === "string" &&
    value.sandboxRunId.trim()
  ) {
    return value.sandboxRunId.trim();
  }

  return null;
}

function getUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getActiveModelId(model: unknown) {
  return getSessionModelId(model) ?? DEFAULT_CHAT_MODEL_ID;
}

const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;

function getMostRecentToolResultName(context: unknown) {
  if (typeof context !== "object" || context === null || !("messages" in context)) {
    return null;
  }

  const messages = Array.isArray(context.messages) ? context.messages : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (typeof message !== "object" || message === null || !("role" in message)) {
      continue;
    }

    if (message.role !== "toolResult") {
      continue;
    }

    const toolName =
      "toolName" in message && typeof message.toolName === "string"
        ? message.toolName.trim()
        : "";

    return toolName || null;
  }

  return null;
}

function shouldUseDataAnalysisModel(context: unknown) {
  const toolName = getMostRecentToolResultName(context);

  return toolName === "search_company_knowledge" || toolName === "run_data_analysis";
}

function getDataAnalysisReasoning(
  reasoning: "high" | "low" | "medium" | "minimal" | "xhigh" | undefined,
  failureStreak: number,
) {
  const normalizedReasoning = reasoning ?? "low";
  const baseIndex = THINKING_LEVELS.indexOf(normalizedReasoning);
  const lowIndex = THINKING_LEVELS.indexOf("low");
  const mediumIndex = THINKING_LEVELS.indexOf("medium");
  const highIndex = THINKING_LEVELS.indexOf("high");
  const cappedBaseIndex =
    baseIndex < 0
      ? lowIndex
      : Math.min(Math.max(baseIndex, lowIndex), highIndex);

  let targetIndex = cappedBaseIndex;

  if (failureStreak >= 4) {
    targetIndex = Math.max(targetIndex, highIndex);
  } else if (failureStreak >= 2) {
    targetIndex = Math.max(targetIndex, mediumIndex);
  }

  return THINKING_LEVELS[targetIndex] as "high" | "low" | "medium";
}

type AskUserOptionInput = AskUserOption | string;

function normalizeAskUserOptions(options: AskUserOptionInput[]) {
  return options
    .map((option) => {
      if (typeof option === "string") {
        const title = option.trim();

        return title ? { title } : null;
      }

      if (typeof option !== "object" || option === null) {
        return null;
      }

      const title = typeof option.title === "string" ? option.title.trim() : "";
      const description =
        typeof option.description === "string" ? option.description.trim() : undefined;

      return title ? { description, title } : null;
    })
    .filter((option): option is AskUserOption => option !== null);
}

function createPlannerSelectionMessage(searches: PendingPlannerSearch[]) {
  const hasPendingSelection = searches.some(
    (search) => search.selectionRequired && search.candidateFiles.length > 0,
  );

  if (!hasPendingSelection) {
    return null;
  }

  const candidatesByFile = new Map<string, FileSelectionCandidate>();

  for (const search of searches) {
    for (const candidate of search.candidateFiles) {
      const existing = candidatesByFile.get(candidate.file);
      const mergedMatches = new Map<string, CompanyKnowledgeMatch>();

      for (const match of existing?.matches ?? []) {
        mergedMatches.set(`${match.file}:${match.line}:${match.text}`, match);
      }

      for (const match of candidate.matches) {
        mergedMatches.set(`${match.file}:${match.line}:${match.text}`, match);
      }

      candidatesByFile.set(candidate.file, {
        ...candidate,
        matchedQueries: getUniqueStrings([
          ...(existing?.matchedQueries ?? []),
          search.query,
        ]),
        matchedTerms: getUniqueStrings([
          ...(existing?.matchedTerms ?? []),
          ...candidate.matchedTerms,
        ]).sort(),
        matches: [...mergedMatches.values()].sort((left, right) => {
          if (left.line === right.line) {
            return left.text.localeCompare(right.text);
          }

          return left.line - right.line;
        }),
        recommendedByQueries: search.recommendedFiles.includes(candidate.file)
          ? getUniqueStrings([...(existing?.recommendedByQueries ?? []), search.query])
          : existing?.recommendedByQueries ?? [],
        score: Math.max(existing?.score ?? 0, candidate.score),
        selectedByQueries: search.selectedFiles.includes(candidate.file)
          ? getUniqueStrings([...(existing?.selectedByQueries ?? []), search.query])
          : existing?.selectedByQueries ?? [],
      });
    }
  }

  const selectedFiles = getUniqueStrings(
    searches.flatMap((search) => [...search.selectedFiles, ...search.recommendedFiles]),
  );
  const candidates = [...candidatesByFile.values()].sort((left, right) => {
    const leftSelected = selectedFiles.includes(left.file);
    const rightSelected = selectedFiles.includes(right.file);

    if (leftSelected !== rightSelected) {
      return leftSelected ? -1 : 1;
    }

    if (left.score === right.score) {
      return left.file.localeCompare(right.file);
    }

    return right.score - left.score;
  });

  if (candidates.length === 0) {
    return null;
  }

  return createFileSelectionMessage({
    candidates,
    queries: getUniqueStrings(searches.map((search) => search.query)),
    selectedFiles,
  });
}

function getContentString(entry: unknown, key: string) {
  if (typeof entry === "object" && entry !== null) {
    const record = entry as Record<string, unknown>;

    if (typeof record[key] === "string") {
      return record[key].trim();
    }
  }

  return "";
}

function extractAssistantMessages(message: AgentMessage) {
  if (!isAssistantAgentMessage(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap<{
    messageText: string;
  }>((entry) => {
    if (typeof entry !== "object" || entry === null || !("type" in entry)) {
      return [];
    }

    if (entry.type === "text") {
      const messageText = getContentString(entry, "text");

      return messageText
        ? [
            {
              messageText,
            },
          ]
        : [];
    }

    return [];
  });
}

function extractAccessedFiles(
  args: unknown,
  result: {
    details?: unknown;
  },
) {
  const files = new Set<string>();

  if (
    typeof args === "object" &&
    args !== null &&
    "inputFiles" in args &&
    Array.isArray(args.inputFiles)
  ) {
    for (const entry of args.inputFiles) {
      if (typeof entry === "string" && entry.trim()) {
        files.add(entry.trim());
      }
    }
  }

  if (
    typeof result.details === "object" &&
    result.details !== null &&
    "selectedFiles" in result.details &&
    Array.isArray(result.details.selectedFiles)
  ) {
    for (const entry of result.details.selectedFiles) {
      if (typeof entry === "string" && entry.trim()) {
        files.add(entry.trim());
      }
    }
  }

  if (
    typeof result.details === "object" &&
    result.details !== null &&
    "stagedFiles" in result.details &&
    Array.isArray(result.details.stagedFiles)
  ) {
    for (const stagedFile of result.details.stagedFiles) {
      if (
        typeof stagedFile === "object" &&
        stagedFile !== null &&
        "sourcePath" in stagedFile &&
        typeof stagedFile.sourcePath === "string" &&
        stagedFile.sourcePath.trim()
      ) {
        files.add(stagedFile.sourcePath.trim());
      }
    }
  }

  return [...files];
}

function createToolRouteError(
  value: unknown,
  fallbackMessage: string,
): Error & { sandboxRunId?: string } {
  const error = new Error(getErrorMessage(value, fallbackMessage)) as Error & {
    sandboxRunId?: string;
  };
  const sandboxRunId = extractSandboxRunId(value);

  if (sandboxRunId) {
    error.sandboxRunId = sandboxRunId;
  }

  return error;
}

function isImageMimeType(mimeType: string) {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp";
}

async function convertBlobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read generated image for graph review."));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Generated image did not produce a valid data URL."));
        return;
      }

      resolve(reader.result);
    };

    reader.readAsDataURL(blob);
  });

  const commaIndex = dataUrl.indexOf(",");

  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : null;
}

function getGraphReviewAsset(
  result: SandboxToolResponse,
): GeneratedAssetToolResponse["generatedAsset"] | null {
  if (!("generatedAsset" in result)) {
    return null;
  }

  const generatedAsset = (result as GeneratedAssetToolResponse).generatedAsset;

  if (!generatedAsset || !isImageMimeType(generatedAsset.mimeType)) {
    return null;
  }

  if (generatedAsset.byteSize > GRAPH_REVIEW_IMAGE_MAX_BYTES) {
    return null;
  }

  return generatedAsset;
}

function getDataAnalysisTextAsset(result: SandboxToolResponse) {
  const generatedAssets = Array.isArray(result.generatedAssets) ? result.generatedAssets : [];

  return (
    generatedAssets.find((asset) => {
      if (asset.byteSize > DATA_ANALYSIS_TEXT_ASSET_MAX_BYTES) {
        return false;
      }

      return (
        asset.mimeType === "text/csv" ||
        asset.mimeType === "application/json" ||
        asset.mimeType === "text/plain"
      );
    }) ?? null
  );
}

async function buildDataAnalysisTextAssetContent(
  result: SandboxToolResponse,
  signal?: AbortSignal,
) {
  const generatedAsset = getDataAnalysisTextAsset(result);

  if (!generatedAsset) {
    return null;
  }

  try {
    const response = await fetch(generatedAsset.downloadUrl, { signal });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    const normalized = text.trim();

    if (!normalized) {
      return null;
    }

    const preview =
      normalized.length <= DATA_ANALYSIS_TEXT_ASSET_PREVIEW_MAX_CHARS
        ? normalized
        : `${normalized.slice(0, DATA_ANALYSIS_TEXT_ASSET_PREVIEW_MAX_CHARS).trimEnd()}… [truncated]`;

    return {
      type: "text" as const,
      text: `Analysis output file (${generatedAsset.relativePath}):\n${preview}`,
    };
  } catch {
    return null;
  }
}

async function buildGraphReviewImageContent(
  result: SandboxToolResponse,
  signal?: AbortSignal,
) {
  const generatedAsset = getGraphReviewAsset(result);

  if (!generatedAsset) {
    return null;
  }

  try {
    const response = await fetch(generatedAsset.downloadUrl, { signal });

    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    const data = await convertBlobToBase64(blob);

    if (!data) {
      return null;
    }

    return {
      data,
      mimeType: generatedAsset.mimeType,
      type: "image" as const,
    };
  } catch {
    return null;
  }
}


function generateClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `critjecture-${Date.now()}`;
}

function createDraftConversation(): ConversationBootstrapState {
  return {
    createdAt: new Date().toISOString(),
    id: generateClientId(),
    initialSessionData: null,
  };
}

function hasConversationContent(messages: AgentMessage[]) {
  return messages.some((message) => {
    if (message.role === "assistant") {
      return extractAssistantMessages(message).length > 0;
    }

    if (message.role === "user" || message.role === "user-with-attachments") {
      return extractUserTextContent(message.content).length > 0;
    }

    return false;
  });
}

function buildConversationTitle(messages: AgentMessage[]) {
  for (const message of messages) {
    if (message.role === "user" || message.role === "user-with-attachments") {
      const promptText = extractUserTextContent(message.content);

      if (promptText) {
        return promptText.slice(0, 80).trim();
      }
    }
  }

  return "Untitled conversation";
}

function upsertConversationMetadata(
  conversations: ConversationMetadata[],
  metadata: ConversationMetadata,
) {
  const next = conversations.filter((conversation) => conversation.id !== metadata.id);
  next.unshift(metadata);

  return next.sort((left, right) => right.lastModified.localeCompare(left.lastModified));
}

type ConversationHistoryGroupId = "today" | "yesterday" | "last7" | "older";

type ConversationHistoryGroup = {
  conversations: ConversationMetadata[];
  id: ConversationHistoryGroupId;
  label: string;
};

function groupConversationHistory(conversations: ConversationMetadata[]) {
  const grouped: Record<ConversationHistoryGroupId, ConversationMetadata[]> = {
    today: [],
    yesterday: [],
    last7: [],
    older: [],
  };

  const now = Date.now();

  conversations.forEach((conversation) => {
    const modifiedAt = new Date(conversation.lastModified).getTime();

    if (Number.isNaN(modifiedAt)) {
      grouped.older.push(conversation);
      return;
    }

    const ageInDays = Math.floor((now - modifiedAt) / (1000 * 60 * 60 * 24));

    if (ageInDays <= 0) {
      grouped.today.push(conversation);
      return;
    }

    if (ageInDays === 1) {
      grouped.yesterday.push(conversation);
      return;
    }

    if (ageInDays < 7) {
      grouped.last7.push(conversation);
      return;
    }

    grouped.older.push(conversation);
  });

  const groups: ConversationHistoryGroup[] = [
    { id: "today", label: "Today", conversations: grouped.today },
    { id: "yesterday", label: "Yesterday", conversations: grouped.yesterday },
    { id: "last7", label: "Last 7 days", conversations: grouped.last7 },
    { id: "older", label: "Older", conversations: grouped.older },
  ];

  return groups.filter((group) => group.conversations.length > 0);
}

type ConversationHistoryListProps = {
  activeConversationId: string | null;
  conversations: ConversationMetadata[];
  disabled: boolean;
  emptyMessage: string;
  loading: boolean;
  onSelect: (conversationId: string) => void;
};

function ConversationHistoryList({
  activeConversationId,
  conversations,
  disabled,
  emptyMessage,
  loading,
  onSelect,
}: ConversationHistoryListProps) {
  if (loading) {
    return <div className="chat-history-empty">Loading conversation history...</div>;
  }

  const groups = groupConversationHistory(conversations);

  if (groups.length === 0) {
    return <div className="chat-history-empty">{emptyMessage}</div>;
  }

  return (
    <div className="chat-history-list">
      {groups.map((group) => (
        <section className="chat-history-group" key={group.id}>
          <h3 className="chat-history-group__title">{group.label}</h3>
          <div className="chat-history-group__items">
            {group.conversations.map((conversation) => (
              <button
                className={`chat-history-card ${
                  conversation.id === activeConversationId ? "is-active" : ""
                }`}
                disabled={disabled}
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                type="button"
              >
                <span className="chat-history-card__title">
                  {conversation.title || "Untitled conversation"}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type ChatHistorySidebarProps = {
  activeConversationId: string | null;
  conversations: ConversationMetadata[];
  loading: boolean;
  onNewChat: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (conversationId: string) => void;
  query: string;
  streaming: boolean;
};

function ChatHistorySidebar({
  activeConversationId,
  conversations,
  loading,
  onNewChat,
  onQueryChange,
  onSelect,
  query,
  streaming,
}: ChatHistorySidebarProps) {
  const emptyMessage = query.trim()
    ? "No conversations match your search."
    : "No saved conversations yet.";

  return (
    <aside aria-label="Conversation history" className="chat-history-sidebar">
      <div className="chat-history-sidebar__header">
        <div>
          <p className="chat-history-dialog__eyebrow">History</p>
          <h2 className="chat-history-sidebar__title">Conversations</h2>
        </div>
        <button
          className="chat-history-sidebar__new-chat"
          disabled={streaming}
          onClick={onNewChat}
          type="button"
        >
          New chat
        </button>
      </div>
      <input
        aria-label="Search conversation history"
        className="chat-history-search"
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        placeholder="Search conversations"
        type="search"
        value={query}
      />
      <div className="chat-history-sidebar__list">
        <ConversationHistoryList
          activeConversationId={activeConversationId}
          conversations={conversations}
          disabled={streaming}
          emptyMessage={emptyMessage}
          loading={loading}
          onSelect={onSelect}
        />
      </div>
    </aside>
  );
}

type ChatHistoryDialogProps = {
  activeConversationId: string | null;
  conversations: ConversationMetadata[];
  loading: boolean;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSelect: (conversationId: string) => void;
  query: string;
  streaming: boolean;
};

function ChatHistoryDialog({
  activeConversationId,
  conversations,
  loading,
  onClose,
  onQueryChange,
  onSelect,
  query,
  streaming,
}: ChatHistoryDialogProps) {
  const emptyMessage = query.trim()
    ? "No conversations match your search."
    : "No saved conversations yet.";

  return (
    <div className="chat-history-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Conversation history"
        aria-modal="true"
        className="chat-history-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="chat-history-dialog__header">
          <div>
            <p className="chat-history-dialog__eyebrow">History</p>
            <h2 className="chat-history-dialog__title">Load a prior conversation</h2>
          </div>
          <button className="chat-toolbar__button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <input
          aria-label="Search conversation history"
          className="chat-history-search"
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder="Search conversations"
          type="search"
          value={query}
        />
        <div className="chat-history-dialog__list">
          <ConversationHistoryList
            activeConversationId={activeConversationId}
            conversations={conversations}
            disabled={streaming}
            emptyMessage={emptyMessage}
            loading={loading}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

type ChatShellProps = {
  organizationSlug: string;
  role: UserRole;
  userId: string;
};

export function ChatShellWithRole({ organizationSlug, role, userId }: ChatShellProps) {
  const activeTurnIdRef = useRef<string | null>(null);
  const awaitingFileSelectionRef = useRef(false);
  const browserSessionIdRef = useRef<string>("");
  const conversationCreatedAtRef = useRef("");
  const conversationIdRef = useRef<string | null>(null);
  const conversationPersistedRef = useRef(false);
  const historyQueryRef = useRef("");
  const historyRequestIdRef = useRef(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const messageIndexRef = useRef(0);
  const lastCompletedTurnIdRef = useRef<string | null>(null);
  const runDataAnalysisFailureStreakRef = useRef(0);
  const pendingChatTurnRef = useRef<PendingChatTurn | null>(null);
  const plannerSearchesRef = useRef<PendingPlannerSearch[]>([]);
  const pendingSelectionRef = useRef<FileSelectionEventDetail | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const syntheticContinuationRef = useRef(false);
  const toolbarMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState("");
  const [conversationBootstrap, setConversationBootstrap] =
    useState<ConversationBootstrapState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyConversations, setHistoryConversations] = useState<ConversationMetadata[]>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [workflowBuilderOpen, setWorkflowBuilderOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraftFromChatTurn | null>(
    null,
  );
  const [workflowDraftError, setWorkflowDraftError] = useState<string | null>(null);
  const [workflowDraftLoading, setWorkflowDraftLoading] = useState(false);
  const [workflowSaveError, setWorkflowSaveError] = useState<string | null>(null);
  const [workflowSaveSuccess, setWorkflowSaveSuccess] = useState<string | null>(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [{ error, ready }, setState] = useState<ChatShellState>({
    error: null,
    ready: false,
  });

  useEffect(() => {
    historyQueryRef.current = historyQuery;
  }, [historyQuery]);

  useEffect(() => {
    let cancelled = false;

    async function initializeConversation() {
      const url = new URL(window.location.href);
      const requestedConversationId = url.searchParams.get("conversation")?.trim() ?? "";

      if (!requestedConversationId) {
        const draft = createDraftConversation();

        if (!cancelled) {
          conversationCreatedAtRef.current = draft.createdAt;
          conversationIdRef.current = draft.id;
          conversationPersistedRef.current = false;
          lastCompletedTurnIdRef.current = null;
          setWorkflowBuilderOpen(false);
          setWorkflowDraft(null);
          setWorkflowDraftError(null);
          setWorkflowSaveError(null);
          setWorkflowSaveSuccess(null);
          setActiveConversationTitle("");
          setConversationBootstrap(draft);
        }

        return;
      }

      try {
        const response = await fetch(`/api/conversations/${requestedConversationId}`);
        const data = (await response.json()) as
          | GetConversationResponse
          | {
              error: string;
            };

        if (!response.ok) {
          throw new Error(getErrorMessage(data, "Failed to load conversation."));
        }

        if (!("conversation" in data)) {
          throw new Error("Conversation payload was missing from the response.");
        }

        if (cancelled) {
          return;
        }

        const bootstrap = {
          createdAt: data.conversation.createdAt,
          id: data.conversation.id,
          initialSessionData: data.conversation,
        } satisfies ConversationBootstrapState;

        conversationCreatedAtRef.current = bootstrap.createdAt;
        conversationIdRef.current = bootstrap.id;
        conversationPersistedRef.current = true;
        lastCompletedTurnIdRef.current = null;
        setWorkflowBuilderOpen(false);
        setWorkflowDraft(null);
        setWorkflowDraftError(null);
        setWorkflowSaveError(null);
        setWorkflowSaveSuccess(null);
        setActiveConversationTitle(data.conversation.title);
        setConversationBootstrap(bootstrap);
      } catch (caughtError) {
        console.error("Failed to restore conversation from URL.", caughtError);
        const draft = createDraftConversation();

        if (!cancelled) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete("conversation");
          window.history.replaceState({}, "", nextUrl.toString());
          conversationCreatedAtRef.current = draft.createdAt;
          conversationIdRef.current = draft.id;
          conversationPersistedRef.current = false;
          lastCompletedTurnIdRef.current = null;
          setWorkflowBuilderOpen(false);
          setWorkflowDraft(null);
          setWorkflowDraftError(null);
          setWorkflowSaveError(null);
          setWorkflowSaveSuccess(null);
          setActiveConversationTitle("");
          setConversationBootstrap(draft);
        }
      }
    }

    void initializeConversation();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!conversationBootstrap) {
      return;
    }

    const initialConversation = conversationBootstrap;
    let mounted = true;
    let cleanup: (() => void) | undefined;
    let agent: Agent | null = null;

    setState({ error: null, ready: false });
    setIsStreaming(false);
    runDataAnalysisFailureStreakRef.current = 0;

    if (!browserSessionIdRef.current) {
      browserSessionIdRef.current = generateClientId();
    }

    async function bootstrap() {
      try {
        const [{ Agent, streamProxy }, { Type, getModel }, webUi] = await Promise.all([
          import("@mariozechner/pi-agent-core"),
          import("@mariozechner/pi-ai"),
          import("@mariozechner/pi-web-ui"),
        ]);

        const bootstrapConversationId = initialConversation.id;
        conversationIdRef.current = bootstrapConversationId;
        conversationCreatedAtRef.current = initialConversation.createdAt;
        conversationPersistedRef.current = Boolean(initialConversation.initialSessionData);
        setActiveConversationTitle(initialConversation.initialSessionData?.title ?? "");

        const settings = new webUi.SettingsStore();
        const providerKeys = new webUi.ProviderKeysStore();
        const sessions = new webUi.SessionsStore();
        const customProviders = new webUi.CustomProvidersStore();

        const backend = new webUi.IndexedDBStorageBackend({
          dbName: `critjecture-user-${userId}-${organizationSlug}`,
          version: 6,
          stores: [
            settings.getConfig(),
            providerKeys.getConfig(),
            sessions.getConfig(),
            webUi.SessionsStore.getMetadataConfig(),
            customProviders.getConfig(),
          ],
        });

        settings.setBackend(backend);
        providerKeys.setBackend(backend);
        sessions.setBackend(backend);
        customProviders.setBackend(backend);

        webUi.setAppStorage(
          new webUi.AppStorage(
            settings,
            providerKeys,
            sessions,
            customProviders,
            backend,
          ),
        );

        registerCritjectureToolRenderers(webUi);
        registerCritjectureMessageRenderers(webUi);
        registerAskUserMessageRenderers(webUi);

        const postAuditJson = async <TResponse,>(
          url: string,
          body: Record<string, unknown>,
          signal?: AbortSignal,
        ) => {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal,
          });
          const data = (await response.json()) as TResponse | { error: string };

          if (!response.ok) {
            throw new Error(getErrorMessage(data, "Audit request failed."));
          }

          return data as TResponse;
        };

        const putConversationJson = async (
          sessionData: SessionData,
          signal?: AbortSignal,
        ) => {
          const response = await fetch(`/api/conversations/${sessionData.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ sessionData }),
            signal,
          });
          const data = (await response.json()) as
            | UpsertConversationResponse
            | {
                error: string;
              };

          if (!response.ok) {
            throw new Error(getErrorMessage(data, "Failed to save conversation."));
          }

          return data as UpsertConversationResponse;
        };

        const buildSessionData = () => {
          if (!agent || !conversationIdRef.current || !agent.state.model) {
            return null;
          }

          const messages = agent.state.messages as AgentMessage[];

          if (!hasConversationContent(messages)) {
            return null;
          }

          return {
            id: conversationIdRef.current,
            title: buildConversationTitle(messages),
            model: agent.state.model,
            thinkingLevel: agent.state.thinkingLevel,
            messages,
            createdAt: conversationCreatedAtRef.current || new Date().toISOString(),
            lastModified: new Date().toISOString(),
          } satisfies SessionData;
        };

        const saveConversationSnapshot = async (signal?: AbortSignal) => {
          const sessionData = buildSessionData();

          if (!sessionData) {
            return;
          }

          await putConversationJson(sessionData, signal).then((result) => {
            if (!mounted || conversationIdRef.current !== result.conversationId) {
              return;
            }

            conversationPersistedRef.current = true;
            setActiveConversationTitle(result.metadata.title);
            setHistoryConversations((current) => {
              const normalizedQuery = historyQueryRef.current.trim().toLowerCase();

              if (!normalizedQuery) {
                return upsertConversationMetadata(current, result.metadata);
              }

              const searchableText = `${result.metadata.title}\n${result.metadata.preview}`
                .trim()
                .toLowerCase();

              if (!searchableText.includes(normalizedQuery)) {
                return current.filter(
                  (conversation) => conversation.id !== result.metadata.id,
                );
              }

              return upsertConversationMetadata(current, result.metadata);
            });

            const url = new URL(window.location.href);
            url.searchParams.set("conversation", result.conversationId);
            window.history.replaceState({}, "", url.toString());
          });
        };

        const scheduleConversationSave = (immediate = false) => {
          if (!agent) {
            return;
          }

          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }

          if (immediate) {
            void saveConversationSnapshot();
            return;
          }

          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            void saveConversationSnapshot();
          }, 350);
        };

        const queueChatTurn = (
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
        ) => {
          const userPromptText = extractPromptText(input);

          if (!synthetic) {
            plannerSearchesRef.current = [];
          }

          if (!userPromptText) {
            return;
          }

          pendingChatTurnRef.current = {
            userPromptText,
            synthetic,
          };
        };

        const runPromptWithAudit = async (
          originalPrompt: Agent["prompt"],
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
          images?: unknown[],
        ) => {
          queueChatTurn(input, synthetic);

          if (synthetic) {
            syntheticContinuationRef.current = true;
          }

          try {
            if (typeof input === "string") {
              await originalPrompt(input, images as never);
              return;
            }

            await originalPrompt(input as never);
          } catch (caughtError) {
            scheduleConversationSave(true);
            const turnId = activeTurnIdRef.current;

            if (turnId) {
              activeTurnIdRef.current = null;
              messageIndexRef.current = 0;
              plannerSearchesRef.current = [];
              syntheticContinuationRef.current = false;

              void postAuditJson<FinishChatTurnResponse>(
                "/api/audit/chat-turns/finish",
                {
                  status: "failed",
                  turnId,
                },
              ).catch((finishError) => {
                console.error("Failed to mark chat turn as failed.", finishError);
              });
            }

            throw caughtError;
          }
        };

        const hasPendingPlannerSelection = () =>
          plannerSearchesRef.current.some(
            (search) => search.selectionRequired && search.candidateFiles.length > 0,
          );

        const pushPlannerSearch = (search: PendingPlannerSearch) => {
          const alreadyTracked = plannerSearchesRef.current.some((existing) => {
            return (
              existing.query === search.query &&
              existing.selectionRequired === search.selectionRequired &&
              JSON.stringify(existing.candidateFiles.map((candidate) => candidate.file)) ===
                JSON.stringify(search.candidateFiles.map((candidate) => candidate.file)) &&
              JSON.stringify(existing.selectedFiles) === JSON.stringify(search.selectedFiles) &&
              JSON.stringify(existing.recommendedFiles) ===
                JSON.stringify(search.recommendedFiles)
            );
          });

          if (alreadyTracked) {
            return;
          }

          plannerSearchesRef.current = [...plannerSearchesRef.current, search];
        };

        const flushPendingPlannerSelection = () => {
          if (!agent || agent.state.isStreaming || awaitingFileSelectionRef.current) {
            return false;
          }

          const selectionMessage = createPlannerSelectionMessage(plannerSearchesRef.current);
          plannerSearchesRef.current = [];

          if (!selectionMessage) {
            return false;
          }

          awaitingFileSelectionRef.current = true;
          agent.appendMessage(selectionMessage);
          return true;
        };

        const flushPendingSelection = async () => {
          if (!agent || !pendingSelectionRef.current || agent.state.isStreaming) {
            return;
          }

          const selection = pendingSelectionRef.current;
          pendingSelectionRef.current = null;
          awaitingFileSelectionRef.current = false;
          await runPromptWithAudit(
            originalPrompt,
            buildFileSelectionPrompt(selection.files),
            true,
          );
        };

        let activeAskUserSelectionId: string | null = null;
        let askUserAbortCleanup: (() => void) | null = null;
        let askUserTimeoutHandle: number | null = null;
        let resolveAskUserSelection:
          | ((result: { answer: string | null; wasCustom: boolean }) => void)
          | null = null;

        const finalizeAskUserSelection = (result: {
          answer: string | null;
          wasCustom: boolean;
        }) => {
          if (askUserTimeoutHandle) {
            window.clearTimeout(askUserTimeoutHandle);
            askUserTimeoutHandle = null;
          }

          if (askUserAbortCleanup) {
            askUserAbortCleanup();
            askUserAbortCleanup = null;
          }

          const resolver = resolveAskUserSelection;
          resolveAskUserSelection = null;
          activeAskUserSelectionId = null;
          resolver?.(result);
        };

        const requestAskUserInput = (
          prompt: {
            allowFreeform: boolean;
            allowMultiple: boolean;
            context?: string;
            options: AskUserOption[];
            question: string;
            timeout?: number;
          },
          signal?: AbortSignal,
        ) => {
          if (!agent) {
            return Promise.resolve({ answer: null, wasCustom: false });
          }

          if (resolveAskUserSelection) {
            finalizeAskUserSelection({ answer: null, wasCustom: false });
          }

          const selectionMessage = createAskUserSelectionMessage({
            allowFreeform: prompt.allowFreeform,
            allowMultiple: prompt.allowMultiple,
            context: prompt.context,
            options: prompt.options,
            question: prompt.question,
          });

          activeAskUserSelectionId = selectionMessage.selectionId;
          agent.appendMessage(selectionMessage);
          scheduleConversationSave(true);

          return new Promise<{ answer: string | null; wasCustom: boolean }>((resolve) => {
            resolveAskUserSelection = resolve;

            if (typeof prompt.timeout === "number") {
              const timeout = Math.max(0, Math.trunc(prompt.timeout));

              if (timeout > 0) {
                askUserTimeoutHandle = window.setTimeout(() => {
                  finalizeAskUserSelection({ answer: null, wasCustom: false });
                }, timeout);
              }
            }

            if (signal) {
              const abortListener = () => {
                finalizeAskUserSelection({ answer: null, wasCustom: false });
              };

              signal.addEventListener("abort", abortListener, { once: true });
              askUserAbortCleanup = () => {
                signal.removeEventListener("abort", abortListener);
              };
            }
          });
        };

        const sandboxToolParameters = Type.Object({
          code: Type.String({
            description:
                "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path> for the current organization. inputs/ is read-only; never write or overwrite files there. Use Polars for staged CSV inputs and use pl.scan_csv(...).collect(). Always print the final answer to stdout. Do not rely on print(df) for full tables because Polars display truncates; save full tabular output to outputs/result.csv (or outputs/result.json / outputs/result.txt) and print a short summary. Save at most one structured file and only at outputs/result.csv, outputs/result.json, or outputs/result.txt. If you are preparing reusable chart-ready data instead of saving a PNG, print exactly one JSON object under a chart key, preferably via json.dumps(...). Multi-series charts may use chart.series with items shaped like {name, x, y}.",
            minLength: 1,
          }),
          inputFiles: Type.Optional(
            Type.Array(
              Type.String({
                description:
                  "A company_data-relative file path for the current organization discovered via search_company_knowledge, such as admin/quarterly_report_2026.csv.",
                minLength: 1,
              }),
            ),
          ),
        });

        const generateVisualGraphParameters = Type.Object({
          analysisResultId: Type.Optional(
            Type.String({
              description:
                "Optional analysisResultId returned by run_data_analysis for chart-ready data. If present, the server renders the stored chart without rerunning analysis code.",
              minLength: 1,
            }),
          ),
          chartType: Type.Optional(
            Type.Union([
              Type.Literal("bar"),
              Type.Literal("line"),
              Type.Literal("scatter"),
            ]),
          ),
          code: Type.Optional(
            Type.String({
              description:
                "Python plotting code to execute inside the sandbox. This may read staged company CSV files from inputs/<same-relative-path> or render a manual/synthetic chart. Save exactly one PNG to outputs/chart.png and print a short summary.",
              minLength: 1,
            }),
          ),
          inputFiles: Type.Optional(
            Type.Array(
              Type.String({
                description:
                  "Optional company_data-relative paths to stage for plotting code, such as admin/quarterly_report_2026.csv. These are ignored when analysisResultId is used.",
                minLength: 1,
              }),
            ),
          ),
          title: Type.Optional(Type.String({ minLength: 1 })),
          xLabel: Type.Optional(Type.String({ minLength: 1 })),
          yLabel: Type.Optional(Type.String({ minLength: 1 })),
        });

        const createSandboxTool = <
          TParams extends Record<string, unknown>,
          TResponse extends SandboxToolResponse,
        >(
          options: {
            attachDataAnalysisTextOutput?: boolean;
            attachGraphImageForReview?: boolean;
            buildRequestBody: (runtimeToolCallId: string, params: TParams) => Record<string, unknown>;
            description: string;
            label: string;
            name: string;
            parameters: unknown;
            route: string;
          },
        ) => ({
          name: options.name,
          label: options.label,
          description: options.description,
          parameters: options.parameters,
          async execute(
            runtimeToolCallId: string,
            params: TParams,
            signal?: AbortSignal,
          ) {
            if (awaitingFileSelectionRef.current || hasPendingPlannerSelection()) {
              throw new Error(
                "File selection is pending. Wait for the user to confirm the multi-select picker before using a Python sandbox tool.",
              );
            }

            const response = await fetch(options.route, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...options.buildRequestBody(runtimeToolCallId, params),
                turnId: activeTurnIdRef.current,
              }),
              signal,
            });

            const data = (await response.json()) as TResponse | { error: string };

            if (!response.ok) {
              throw createToolRouteError(data, `${options.label} request failed.`);
            }

            const result = data as TResponse;
            const content: Array<
              | {
                  text: string;
                  type: "text";
                }
              | {
                  data: string;
                  mimeType: string;
                  type: "image";
                }
            > = [
              {
                type: "text",
                text: result.summary,
              },
            ];

            if (options.attachDataAnalysisTextOutput) {
              const textAssetContent = await buildDataAnalysisTextAssetContent(result, signal);

              if (textAssetContent) {
                content.push(textAssetContent);
              }
            }

            if (options.attachGraphImageForReview) {
              const imageContent = await buildGraphReviewImageContent(result, signal);

              if (imageContent) {
                content.push(imageContent);
              }
            }

            return {
              content,
              details: result,
            };
          },
        });

        const searchCompanyKnowledgeTool = {
          name: "search_company_knowledge",
          label: "Search Company Knowledge",
          description:
            "Search the current organization's company_data using short keywords, filenames, or years. The tool may auto-select files or trigger a planner-level multi-select picker when multiple files are relevant.",
          parameters: Type.Object({
            query: Type.String({
              description:
                "A short keyword, filename, or year such as revenue, operations, quarterly_report.csv, or 2026.",
              minLength: 1,
            }),
          }),
          async execute(
            _runtimeToolCallId: string,
            params: { query: string },
            signal?: AbortSignal,
          ) {
            const response = await fetch("/api/company-knowledge/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                query: params.query,
              }),
              signal,
            });

            const data = (await response.json()) as SearchToolResponse | { error: string };

            if (!response.ok) {
              throw new Error("error" in data ? data.error : "Search request failed.");
            }

            const result = data as SearchToolResponse;

            if (
              result.candidateFiles.length > 0 &&
              (result.selectionRequired ||
                result.selectedFiles.length > 0 ||
                result.recommendedFiles.length > 0)
            ) {
              pushPlannerSearch({
                candidateFiles: result.candidateFiles,
                query: params.query,
                recommendedFiles: result.recommendedFiles,
                selectedFiles: result.selectedFiles,
                selectionRequired: result.selectionRequired,
              });
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: result.summary,
                },
              ],
              details: result,
            };
          },
        };

        const braveSearchTool = {
          name: "brave_search",
          label: "Web Search",
          description:
            "Web search via Brave Search API. Returns snippets and can optionally fetch page content.",
          parameters: Type.Object({
            query: Type.String({
              description: "Search query.",
              minLength: 1,
            }),
            count: Type.Optional(
              Type.Integer({
                description: "Number of results (1-20).",
                maximum: 20,
                minimum: 1,
              }),
            ),
            country: Type.Optional(
              Type.String({
                description: "Country code, for example US.",
                minLength: 2,
              }),
            ),
            freshness: Type.Optional(
              Type.Union([
                Type.Literal("pd"),
                Type.Literal("pw"),
                Type.Literal("pm"),
                Type.Literal("py"),
              ]),
            ),
            fetchContent: Type.Optional(Type.Boolean()),
            format: Type.Optional(
              Type.Union([
                Type.Literal("one_line"),
                Type.Literal("short"),
                Type.Literal("raw_json"),
              ]),
            ),
          }),
          async execute(
            _runtimeToolCallId: string,
            params: {
              count?: number;
              country?: string;
              fetchContent?: boolean;
              format?: "one_line" | "raw_json" | "short";
              freshness?: "pd" | "pm" | "pw" | "py";
              query: string;
            },
            signal?: AbortSignal,
          ) {
            const response = await fetch("/api/brave/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(params),
              signal,
            });
            const data = (await response.json()) as BraveSearchToolResponse | { error: string };

            if (!response.ok) {
              throw new Error(getErrorMessage(data, "Brave search failed."));
            }

            const result = data as BraveSearchToolResponse;

            return {
              content: [
                {
                  type: "text" as const,
                  text: result.text,
                },
              ],
              details: result,
            };
          },
        };

        const braveGroundingTool = {
          name: "brave_grounding",
          label: "Brave Grounding",
          description: "Grounded answer from Brave Search with optional citations.",
          parameters: Type.Object({
            question: Type.String({
              description: "Question to answer.",
              minLength: 1,
            }),
            enableResearch: Type.Optional(Type.Boolean()),
            enableCitations: Type.Optional(Type.Boolean()),
            enableEntities: Type.Optional(Type.Boolean()),
            maxAnswerChars: Type.Optional(
              Type.Integer({
                maximum: 10_000,
                minimum: 200,
              }),
            ),
          }),
          async execute(
            _runtimeToolCallId: string,
            params: {
              enableCitations?: boolean;
              enableEntities?: boolean;
              enableResearch?: boolean;
              maxAnswerChars?: number;
              question: string;
            },
            signal?: AbortSignal,
          ) {
            const response = await fetch("/api/brave/grounding", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(params),
              signal,
            });
            const data = (await response.json()) as BraveGroundingToolResponse | { error: string };

            if (!response.ok) {
              throw new Error(getErrorMessage(data, "Brave grounding failed."));
            }

            const result = data as BraveGroundingToolResponse;

            return {
              content: [
                {
                  type: "text" as const,
                  text: result.text,
                },
              ],
              details: result,
            };
          },
        };

        const askUserTool = {
          name: "ask_user",
          label: "Ask User",
          description:
            "Ask the user a question with optional multiple-choice options to resolve ambiguity.",
          parameters: Type.Object({
            question: Type.String({
              description: "The question to ask the user.",
              minLength: 1,
            }),
            context: Type.Optional(
              Type.String({
                description: "Relevant context summary to show before the question.",
              }),
            ),
            options: Type.Optional(
              Type.Array(
                Type.Union([
                  Type.String(),
                  Type.Object({
                    title: Type.String(),
                    description: Type.Optional(Type.String()),
                  }),
                ]),
              ),
            ),
            allowMultiple: Type.Optional(Type.Boolean()),
            allowFreeform: Type.Optional(Type.Boolean()),
            timeout: Type.Optional(Type.Number()),
          }),
          async execute(
            _runtimeToolCallId: string,
            params: {
              allowFreeform?: boolean;
              allowMultiple?: boolean;
              context?: string;
              options?: AskUserOptionInput[];
              question: string;
              timeout?: number;
            },
            signal?: AbortSignal,
          ) {
            const question = typeof params.question === "string" ? params.question.trim() : "";
            const context = typeof params.context === "string" ? params.context.trim() : "";
            const options = normalizeAskUserOptions(Array.isArray(params.options) ? params.options : []);
            const allowMultiple = Boolean(params.allowMultiple ?? false);
            const allowFreeform = Boolean(params.allowFreeform ?? true);
            const timeout =
              typeof params.timeout === "number" && Number.isFinite(params.timeout)
                ? Math.max(0, Math.trunc(params.timeout))
                : undefined;

            if (!question) {
              return {
                content: [{ type: "text" as const, text: "Error: question is required." }],
                details: {
                  answer: null,
                  cancelled: true,
                  context: context || undefined,
                  options,
                  question,
                } satisfies AskUserToolResponse,
                isError: true,
              };
            }

            if (options.length === 0 && !allowFreeform) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "ask_user requires options or allowFreeform=true.",
                  },
                ],
                details: {
                  answer: null,
                  cancelled: true,
                  context: context || undefined,
                  options,
                  question,
                } satisfies AskUserToolResponse,
                isError: true,
              };
            }

            const selection = await requestAskUserInput(
              {
                allowFreeform,
                allowMultiple,
                context: context || undefined,
                options,
                question,
                timeout,
              },
              signal,
            );
            const answer = selection.answer?.trim() ?? "";

            if (!answer) {
              return {
                content: [{ type: "text" as const, text: "User cancelled the question." }],
                details: {
                  answer: null,
                  cancelled: true,
                  context: context || undefined,
                  options,
                  question,
                } satisfies AskUserToolResponse,
              };
            }

            return {
              content: [{ type: "text" as const, text: `User answered: ${answer}` }],
              details: {
                answer,
                cancelled: false,
                context: context || undefined,
                options,
                question,
                wasCustom: selection.wasCustom,
              } satisfies AskUserToolResponse,
            };
          },
        };

        const runDataAnalysisTool = createSandboxTool<
          { code: string; inputFiles?: string[] },
          DataAnalysisToolResponse
        >({
          buildRequestBody: (runtimeToolCallId, params) => ({
            code: params.code,
            inputFiles: params.inputFiles ?? [],
            runtimeToolCallId,
          }),
          name: "run_data_analysis",
          label: "Run Data Analysis",
          description:
            "Execute short Python snippets in the isolated sandbox. Use this for calculations, Polars analysis, and deterministic computed answers. inputs/ is read-only staged data; never write there. Do not rely on print(df) for full tables because Polars display truncates; save full tabular output to outputs/result.csv (or outputs/result.json / outputs/result.txt) and print a compact summary. Save at most one structured file and only at outputs/result.csv, outputs/result.json, or outputs/result.txt. If you want reusable chart-ready data instead of a PNG, print exactly one JSON object under chart, using json.dumps(...) and chart.series for multi-line or grouped charts when needed.",
          parameters: sandboxToolParameters,
          route: "/api/data-analysis/run",
          attachDataAnalysisTextOutput: true,
        });

        const generateVisualGraphTool = createSandboxTool<
          {
            analysisResultId?: string;
            chartType?: "bar" | "line" | "scatter";
            code?: string;
            inputFiles?: string[];
            title?: string;
            xLabel?: string;
            yLabel?: string;
          },
          GeneratedAssetToolResponse
        >({
          buildRequestBody: (runtimeToolCallId, params) => ({
            analysisResultId: params.analysisResultId,
            chartType: params.chartType,
            code: params.code,
            inputFiles: params.inputFiles ?? [],
            runtimeToolCallId,
            title: params.title,
            xLabel: params.xLabel,
            yLabel: params.yLabel,
          }),
          name: "generate_visual_graph",
          label: "Generate Visual Graph",
          description:
            "Generate exactly one PNG chart inside outputs/. This can either render a stored chart via analysisResultId or run arbitrary matplotlib code directly against staged company files passed in inputFiles.",
          parameters: generateVisualGraphParameters,
          route: "/api/visual-graph/run",
          attachGraphImageForReview: true,
        });

        const generateDocumentTool = createSandboxTool<
          { code: string; inputFiles?: string[] },
          GeneratedAssetToolResponse
        >({
          buildRequestBody: (runtimeToolCallId, params) => ({
            code: params.code,
            inputFiles: params.inputFiles ?? [],
            runtimeToolCallId,
          }),
          name: "generate_document",
          label: "Generate Document",
          description:
            "Execute Python in the isolated sandbox to generate exactly one PDF document inside outputs/. Use reportlab and print a one-line summary after writing the file.",
          parameters: sandboxToolParameters,
          route: "/api/document/generate",
        });

        agent = new Agent({
          initialState: {
            systemPrompt: buildChatSystemPrompt(role),
            model:
              initialConversation.initialSessionData?.model ??
              getModel("openai", DEFAULT_CHAT_MODEL_ID),
            thinkingLevel:
              initialConversation.initialSessionData?.thinkingLevel ??
              DEFAULT_CHAT_THINKING_LEVEL,
            messages: initialConversation.initialSessionData?.messages ?? [],
            tools: [
              searchCompanyKnowledgeTool,
              braveSearchTool,
              braveGroundingTool,
              askUserTool,
              runDataAnalysisTool,
              generateVisualGraphTool,
              generateDocumentTool,
            ],
          },
          convertToLlm: (messages) =>
            critjectureConvertToLlm(messages, webUi.defaultConvertToLlm),
          streamFn: async (model, context, options) => {
            const pendingChatTurn = pendingChatTurnRef.current;

            if (pendingChatTurn) {
              pendingChatTurnRef.current = null;

              if (!pendingChatTurn.synthetic) {
                try {
                  await saveConversationSnapshot(options?.signal);

                  const auditResponse = await postAuditJson<CreateChatTurnResponse>(
                    "/api/audit/chat-turns",
                    {
                      conversationId: bootstrapConversationId,
                      chatSessionId: browserSessionIdRef.current,
                      userPromptText: pendingChatTurn.userPromptText,
                    },
                    options?.signal,
                  );

                  activeTurnIdRef.current = auditResponse.turnId;
                  messageIndexRef.current = 0;
                } catch (caughtError) {
                  console.error("Failed to create chat turn before streaming.", caughtError);
                  activeTurnIdRef.current = null;
                  messageIndexRef.current = 0;
                }
              }
            }

            const useDataAnalysisModel = shouldUseDataAnalysisModel(context);
            const routedModel = useDataAnalysisModel
              ? getModel("openai", DATA_ANALYSIS_CHAT_MODEL_ID)
              : model;
            const effectiveReasoning = useDataAnalysisModel
              ? getDataAnalysisReasoning(
                  options?.reasoning,
                  runDataAnalysisFailureStreakRef.current,
                )
              : options?.reasoning;

            return streamProxy(routedModel, context, {
              ...(options ?? {}),
              reasoning: effectiveReasoning,
              authToken: "local-dev",
              proxyUrl: "",
            });
          },
        });
        agent.sessionId = browserSessionIdRef.current;

        const originalPrompt = agent.prompt.bind(agent);
        const auditedPrompt = (async (
          input: string | AgentMessage | AgentMessage[],
          images?: unknown[],
        ) => {
          await runPromptWithAudit(originalPrompt, input, false, images);
        }) as typeof agent.prompt;

        agent.prompt = auditedPrompt;
        agent.setBeforeToolCall(async ({ args, toolCall }) => {
          const turnId = activeTurnIdRef.current;

          if (!turnId) {
            return undefined;
          }

          try {
            await postAuditJson<{ ok: true }>("/api/audit/tool-calls/start", {
              runtimeToolCallId: toolCall.id,
              toolName: toolCall.name,
              toolParametersJson: stringifyToolArgs(args),
              turnId,
            });
          } catch (caughtError) {
            console.error("Failed to audit tool call start.", caughtError);
          }

          return undefined;
        });
        agent.setAfterToolCall(async ({ args, isError, result, toolCall }) => {
          if (toolCall.name === "run_data_analysis") {
            runDataAnalysisFailureStreakRef.current = isError
              ? runDataAnalysisFailureStreakRef.current + 1
              : 0;
          }

          const turnId = activeTurnIdRef.current;

          if (!turnId) {
            return undefined;
          }

          const resultSummary = getToolResultSummary(result);
          const accessedFiles = extractAccessedFiles(args, result);
          const sandboxRunId = isError
            ? extractSandboxRunId(result)
            : extractSandboxRunId(result.details);
          const status: ToolCallStatus = isError ? "error" : "completed";
          const errorMessage = isError ? resultSummary || "Tool execution failed." : null;

          try {
            await postAuditJson<{ ok: true }>("/api/audit/tool-calls/finish", {
              accessedFiles,
              errorMessage,
              resultSummary: resultSummary || null,
              sandboxRunId,
              runtimeToolCallId: toolCall.id,
              status,
              turnId,
            });
          } catch (caughtError) {
            console.error("Failed to audit tool call completion.", caughtError);
          }

          return undefined;
        });

        const element = document.createElement("agent-interface") as HTMLElement & {
          session: unknown;
          enableAttachments: boolean;
          enableModelSelector: boolean;
          enableThinkingSelector: boolean;
          showThemeToggle: boolean;
          onApiKeyRequired: (provider: string) => Promise<boolean>;
        };

        element.session = agent;
        element.enableAttachments = false;
        element.enableModelSelector = false;
        element.enableThinkingSelector = false;
        element.showThemeToggle = false;
        // The browser never talks to OpenAI directly in Step 1, so we bypass the UI prompt.
        element.onApiKeyRequired = async () => true;

        if (!mounted || !hostRef.current) {
          agent.abort();
          return;
        }

        const unsubscribe = agent.subscribe((event) => {
          if (event.type === "agent_start") {
            setIsStreaming(true);
          }

          if ((event as { type: string }).type === "state-update") {
            scheduleConversationSave();
          }

          if (event.type === "message_end" && activeTurnIdRef.current) {
            const turnId = activeTurnIdRef.current;
            const assistantMessages = extractAssistantMessages(event.message);
            const messageType: AssistantMessageType = hasPendingPlannerSelection()
              ? "planner-selection"
              : "final-response";

            if (assistantMessages.length > 0) {
              void Promise.all(
                assistantMessages.map((assistantMessage) => {
                  const messageIndex = messageIndexRef.current;
                  messageIndexRef.current += 1;

                  return postAuditJson<{ ok: true }>("/api/audit/assistant-messages", {
                    messageIndex,
                    messageText: assistantMessage.messageText,
                    messageType,
                    modelName: getActiveModelId(agent?.state.model),
                    turnId,
                  }).catch((caughtError) => {
                    console.error("Failed to audit assistant message.", caughtError);
                  });
                }),
              );
            }
          }

          if (event.type === "agent_end") {
            setIsStreaming(false);

            if (flushPendingPlannerSelection()) {
              return;
            }

            if (pendingSelectionRef.current) {
              void flushPendingSelection();
              return;
            }

            if (awaitingFileSelectionRef.current) {
              return;
            }

            if (syntheticContinuationRef.current) {
              syntheticContinuationRef.current = false;
            }

            const turnId = activeTurnIdRef.current;

            if (turnId) {
              lastCompletedTurnIdRef.current = turnId;
            }

            activeTurnIdRef.current = null;
            messageIndexRef.current = 0;
            plannerSearchesRef.current = [];

            if (turnId) {
              void postAuditJson<FinishChatTurnResponse>("/api/audit/chat-turns/finish", {
                status: "completed",
                turnId,
              }).catch((caughtError) => {
                console.error("Failed to mark chat turn as completed.", caughtError);
              });
            }

            scheduleConversationSave(true);
          }
        });
        const handleFileSelection = (event: Event) => {
          if (!(event instanceof CustomEvent) || !agent) {
            return;
          }

          const selection = event.detail as FileSelectionEventDetail;

          agent.replaceMessages(
            markFileSelectionSelected(
              agent.state.messages as AgentMessage[],
              selection.selectionId,
              selection.files,
            ),
          );
          scheduleConversationSave(true);

          if (agent.state.isStreaming) {
            pendingSelectionRef.current = selection;
            return;
          }

          awaitingFileSelectionRef.current = false;
          void runPromptWithAudit(
            originalPrompt,
            buildFileSelectionPrompt(selection.files),
            true,
          );
        };

        const handleAskUserSelection = (event: Event) => {
          if (!(event instanceof CustomEvent) || !agent) {
            return;
          }

          const selection = event.detail as AskUserSelectionEventDetail;

          if (!activeAskUserSelectionId || selection.selectionId !== activeAskUserSelectionId) {
            return;
          }

          agent.replaceMessages(
            markAskUserSelectionSubmitted(
              agent.state.messages as AgentMessage[],
              selection.selectionId,
              selection.answer,
              selection.wasCustom,
            ),
          );
          scheduleConversationSave(true);
          finalizeAskUserSelection({
            answer: selection.answer,
            wasCustom: selection.wasCustom,
          });
        };

        window.addEventListener(FILE_SELECTION_EVENT, handleFileSelection as EventListener);
        window.addEventListener(ASK_USER_EVENT, handleAskUserSelection as EventListener);
        agent.setTools([
          searchCompanyKnowledgeTool,
          braveSearchTool,
          braveGroundingTool,
          askUserTool,
          runDataAnalysisTool,
          generateVisualGraphTool,
          generateDocumentTool,
        ]);
        hostRef.current.replaceChildren(element);
        cleanup = () => {
          window.removeEventListener(
            FILE_SELECTION_EVENT,
            handleFileSelection as EventListener,
          );
          window.removeEventListener(ASK_USER_EVENT, handleAskUserSelection as EventListener);
          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          finalizeAskUserSelection({ answer: null, wasCustom: false });
          unsubscribe();
          agent?.abort();
          element.remove();
        };

        setState({ error: null, ready: true });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load the Step 5 chat shell.";

        if (mounted) {
          setState({ error: message, ready: false });
        }
      }
    }

    bootstrap();

    return () => {
      mounted = false;
      activeTurnIdRef.current = null;
      awaitingFileSelectionRef.current = false;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      messageIndexRef.current = 0;
      lastCompletedTurnIdRef.current = null;
      pendingChatTurnRef.current = null;
      plannerSearchesRef.current = [];
      pendingSelectionRef.current = null;
      syntheticContinuationRef.current = false;
      setIsStreaming(false);
      cleanup?.();
    };
  }, [conversationBootstrap, organizationSlug, role, userId]);

  const loadConversationHistory = useCallback(async (query: string) => {
    const requestId = historyRequestIdRef.current + 1;
    historyRequestIdRef.current = requestId;
    setHistoryLoading(true);

    const normalizedQuery = query.trim();
    const params = new URLSearchParams();

    if (normalizedQuery) {
      params.set("q", normalizedQuery);
    }

    const requestUrl = params.size > 0 ? `/api/conversations?${params.toString()}` : "/api/conversations";

    try {
      const response = await fetch(requestUrl);
      const data = (await response.json()) as
        | ListConversationsResponse
        | {
            error: string;
          };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to load conversation history."));
      }

      if (!("conversations" in data)) {
        throw new Error("Conversation list payload was missing from the response.");
      }

      if (requestId === historyRequestIdRef.current) {
        setHistoryConversations(data.conversations);
      }
    } catch (caughtError) {
      if (requestId === historyRequestIdRef.current) {
        console.error("Failed to load conversation history.", caughtError);
      }
    } finally {
      if (requestId === historyRequestIdRef.current) {
        setHistoryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadConversationHistory(historyQuery);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [historyQuery, loadConversationHistory]);

  const canSaveAsWorkflow = role === "admin" || role === "owner";

  function handleCloseWorkflowBuilder() {
    if (workflowSaving) {
      return;
    }

    setWorkflowBuilderOpen(false);
    setWorkflowSaveError(null);
  }

  async function handleOpenWorkflowBuilder() {
    if (!canSaveAsWorkflow || isStreaming) {
      return;
    }

    setWorkflowDraftLoading(true);
    setWorkflowDraftError(null);
    setWorkflowSaveError(null);
    setWorkflowSaveSuccess(null);

    const turnId = lastCompletedTurnIdRef.current;
    const conversationId = conversationIdRef.current;
    const requestBody: Record<string, string> = {};

    if (turnId) {
      requestBody.turnId = turnId;
    }

    if (conversationId) {
      requestBody.conversationId = conversationId;
    }

    if (Object.keys(requestBody).length === 0) {
      setWorkflowDraftLoading(false);
      setWorkflowDraftError("Start and complete a chat turn before saving as workflow.");
      return;
    }

    try {
      const response = await fetch("/api/workflows/from-chat-turn", {
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as
        | BuildWorkflowFromChatTurnResponse
        | {
            error: string;
          };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to build workflow draft."));
      }

      if (!("draft" in data)) {
        throw new Error("Workflow draft payload was missing from the response.");
      }

      setWorkflowDraft(data.draft);
      setWorkflowBuilderOpen(true);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to build workflow draft.";
      setWorkflowDraftError(message);
      setWorkflowBuilderOpen(false);
    } finally {
      setWorkflowDraftLoading(false);
    }
  }

  async function handleSaveWorkflowDraft(input: SaveWorkflowDraftInput) {
    setWorkflowSaving(true);
    setWorkflowSaveError(null);

    try {
      const response = await fetch("/api/workflows", {
        body: JSON.stringify({
          description: input.description,
          name: input.name,
          status: input.status,
          version: input.version,
          visibility: input.visibility,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as CreateWorkflowResponse | { error: string };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to save workflow draft."));
      }

      const savedName =
        "workflow" in data &&
        typeof data.workflow?.workflow?.name === "string" &&
        data.workflow.workflow.name.trim()
          ? data.workflow.workflow.name.trim()
          : input.name;

      setWorkflowSaveSuccess(`Saved workflow “${savedName}”.`);
      setWorkflowBuilderOpen(false);
      setWorkflowDraft(null);
      setWorkflowDraftError(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Failed to save workflow draft.";
      setWorkflowSaveError(message);
    } finally {
      setWorkflowSaving(false);
    }
  }

  function handleOpenHistory() {
    if (isStreaming) {
      return;
    }

    setHistoryOpen(true);
    void loadConversationHistory(historyQuery);
  }

  async function handleSelectConversation(conversationId: string) {
    if (isStreaming || conversationId === conversationIdRef.current) {
      setHistoryOpen(false);
      return;
    }

    setState({ error: null, ready: false });

    try {
      const response = await fetch(`/api/conversations/${conversationId}`);
      const data = (await response.json()) as
        | GetConversationResponse
        | {
            error: string;
          };

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Failed to load conversation."));
      }

      if (!("conversation" in data)) {
        throw new Error("Conversation payload was missing from the response.");
      }

      conversationIdRef.current = data.conversation.id;
      conversationCreatedAtRef.current = data.conversation.createdAt;
      conversationPersistedRef.current = true;
      lastCompletedTurnIdRef.current = null;
      setWorkflowBuilderOpen(false);
      setWorkflowDraft(null);
      setWorkflowDraftError(null);
      setWorkflowSaveError(null);
      setWorkflowSaveSuccess(null);
      setActiveConversationTitle(data.conversation.title);
      setConversationBootstrap({
        createdAt: data.conversation.createdAt,
        id: data.conversation.id,
        initialSessionData: data.conversation,
      });
      setHistoryOpen(false);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Failed to load conversation.";
      setState({ error: message, ready: false });
    }
  }

  function handleNewChat() {
    if (isStreaming) {
      return;
    }

    const draft = createDraftConversation();
    const url = new URL(window.location.href);
    url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url.toString());
    conversationIdRef.current = draft.id;
    conversationCreatedAtRef.current = draft.createdAt;
    conversationPersistedRef.current = false;
    lastCompletedTurnIdRef.current = null;
    setWorkflowBuilderOpen(false);
    setWorkflowDraft(null);
    setWorkflowDraftError(null);
    setWorkflowSaveError(null);
    setWorkflowSaveSuccess(null);
    setActiveConversationTitle("");
    setHistoryOpen(false);
    setConversationBootstrap(draft);
  }

  if (error) {
    return (
      <div className="chat-shell">
        <div className="chat-error">Failed to initialize chat: {error}</div>
      </div>
    );
  }

  return (
    <div className="chat-shell">
      <ChatHistorySidebar
        activeConversationId={conversationIdRef.current}
        conversations={historyConversations}
        loading={historyLoading}
        onNewChat={handleNewChat}
        onQueryChange={setHistoryQuery}
        onSelect={(conversationId) => {
          void handleSelectConversation(conversationId);
        }}
        query={historyQuery}
        streaming={isStreaming}
      />
      <div className="chat-main">
        <div className="chat-toolbar">
          <details
            className="chat-toolbar__menu"
            data-dismiss-on-outside="true"
            ref={toolbarMenuRef}
          >
            <summary className="chat-toolbar__summary">
              <span className="chat-toolbar__title">
                {activeConversationTitle || "New conversation"}
              </span>
              <span aria-hidden="true" className="chat-toolbar__caret">
                ⌄
              </span>
            </summary>

            <div className="chat-toolbar__actions">
              <button
                className="chat-toolbar__button chat-toolbar__button--mobile-only"
                disabled={isStreaming || !conversationBootstrap}
                onClick={() => {
                  toolbarMenuRef.current?.removeAttribute("open");
                  handleOpenHistory();
                }}
                type="button"
              >
                History
              </button>
              {canSaveAsWorkflow ? (
                <button
                  className="chat-toolbar__button"
                  disabled={
                    isStreaming ||
                    !conversationBootstrap ||
                    workflowDraftLoading ||
                    workflowSaving
                  }
                  onClick={() => {
                    toolbarMenuRef.current?.removeAttribute("open");
                    void handleOpenWorkflowBuilder();
                  }}
                  type="button"
                >
                  {workflowDraftLoading ? "Compiling workflow draft…" : "Save as workflow"}
                </button>
              ) : null}
              <button
                className="chat-toolbar__button chat-toolbar__button--primary"
                disabled={isStreaming || !conversationBootstrap}
                onClick={() => {
                  toolbarMenuRef.current?.removeAttribute("open");
                  handleNewChat();
                }}
                type="button"
              >
                New chat
              </button>
            </div>
          </details>
        </div>
        {workflowDraftError ? (
          <p className="chat-toolbar__status chat-toolbar__status--error">{workflowDraftError}</p>
        ) : null}
        {workflowSaveSuccess ? (
          <p className="chat-toolbar__status chat-toolbar__status--success">{workflowSaveSuccess}</p>
        ) : null}
        <div className="chat-host" ref={hostRef} />
        {!ready ? (
          <div className="chat-fallback chat-fallback-overlay">
            Loading chat shell...
          </div>
        ) : null}
      </div>
      {workflowBuilderOpen && workflowDraft ? (
        <WorkflowBuilderModal
          key={workflowDraft.turnId}
          draft={workflowDraft}
          error={workflowSaveError}
          onClose={handleCloseWorkflowBuilder}
          onSave={(input) => {
            void handleSaveWorkflowDraft(input);
          }}
          saving={workflowSaving}
        />
      ) : null}
      {historyOpen ? (
        <ChatHistoryDialog
          activeConversationId={conversationIdRef.current}
          conversations={historyConversations}
          loading={historyLoading}
          onClose={() => setHistoryOpen(false)}
          onQueryChange={setHistoryQuery}
          onSelect={(conversationId) => {
            void handleSelectConversation(conversationId);
          }}
          query={historyQuery}
          streaming={isStreaming}
        />
      ) : null}
    </div>
  );
}
