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
import { createInformationAndDecisionTools } from "@/lib/chat-information-tools";
import { createSandboxTools } from "@/lib/chat-sandbox-tools";
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
  DeleteConversationResponse,
  GetConversationResponse,
  ListConversationsResponse,
  UpdateConversationResponse,
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
import {
  getFileMentionMatch,
  replaceFileMention,
} from "@/lib/chat-file-mentions";
import {
  buildAnalyticalClarificationBannerEyebrow,
  buildAnalyticalClarificationBannerLead,
  buildEffectiveAnalyticalPrompt,
} from "@/lib/analytical-clarification";
import { buildChatSystemPrompt } from "@/lib/chat-system-prompt";
import type { CausalIntakeResponse, EpistemicPosture } from "@/lib/causal-intent-types";
import type {
  GetKnowledgeFilePreviewResponse,
  KnowledgeFilePreview,
  KnowledgeFileRecord,
  ListKnowledgeFilesResponse,
} from "@/lib/knowledge-types";
import {
  applyPredictiveChatReturnFromUrl,
  createPredictiveChatTools,
} from "@/lib/predictive-chat";
import { registerPredictivePlanningMessageRenderers } from "@/lib/predictive-planning-messages";
import { registerPredictiveWorkspaceStatusMessageRenderers } from "@/lib/predictive-workspace-status-messages";
import type { UserRole } from "@/lib/roles";

type ChatShellState = {
  error: string | null;
  ready: boolean;
};

type MentionableKnowledgeFile = Pick<
  KnowledgeFileRecord,
  "accessScope" | "displayName" | "id" | "sourcePath"
>;

type FileMentionMenuState = {
  files: MentionableKnowledgeFile[];
  highlightedIndex: number;
  left: number;
  loading: boolean;
  query: string;
  top: number;
  width: number;
};

type FileMentionPreviewState = {
  error: string | null;
  file: MentionableKnowledgeFile;
  left: number;
  loading: boolean;
  preview: KnowledgeFilePreview | null;
  top: number;
  width: number;
};

const FILE_MENTION_PREVIEW_HIDE_DELAY_MS = 300;



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

type AnalyticalClarificationBannerState = {
  conversationId: string | null;
  eyebrow: string;
  lead: string;
  question: string;
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

async function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }

  await navigator.clipboard.writeText(value);
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

function sortConversationHistory(conversations: ConversationMetadata[]) {
  return [...conversations].sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    return right.lastModified.localeCompare(left.lastModified);
  });
}

function upsertConversationMetadata(
  conversations: ConversationMetadata[],
  metadata: ConversationMetadata,
) {
  const next = conversations.filter((conversation) => conversation.id !== metadata.id);
  next.unshift(metadata);

  return sortConversationHistory(next);
}

function removeConversationMetadata(
  conversations: ConversationMetadata[],
  conversationId: string,
) {
  return sortConversationHistory(
    conversations.filter((conversation) => conversation.id !== conversationId),
  );
}

function updateConversationMetadata(
  conversations: ConversationMetadata[],
  metadata: ConversationMetadata,
) {
  return sortConversationHistory(
    conversations.map((conversation) =>
      conversation.id === metadata.id ? metadata : conversation,
    ),
  );
}

function matchesConversationHistoryQuery(
  conversation: ConversationMetadata,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = `${conversation.title}\n${conversation.preview}`.trim().toLowerCase();
  return searchableText.includes(normalizedQuery);
}

type ConversationHistoryGroupId = "pinned" | "today" | "yesterday" | "last7" | "older";

type ConversationHistoryGroup = {
  conversations: ConversationMetadata[];
  id: ConversationHistoryGroupId;
  label: string;
};

function groupConversationHistory(conversations: ConversationMetadata[]) {
  const grouped: Record<ConversationHistoryGroupId, ConversationMetadata[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    last7: [],
    older: [],
  };

  const now = Date.now();

  sortConversationHistory(conversations).forEach((conversation) => {
    if (conversation.isPinned) {
      grouped.pinned.push(conversation);
      return;
    }

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
    { id: "pinned", label: "Pinned", conversations: grouped.pinned },
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
  onDelete: (conversation: ConversationMetadata) => void;
  onPinToggle: (conversation: ConversationMetadata) => void;
  onRename: (conversation: ConversationMetadata) => void;
  onSelect: (conversationId: string) => void;
  onShareToggle: (conversation: ConversationMetadata) => void;
};

function ConversationHistoryList({
  activeConversationId,
  conversations,
  disabled,
  emptyMessage,
  loading,
  onDelete,
  onPinToggle,
  onRename,
  onSelect,
  onShareToggle,
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
            {group.conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;

              return (
                <div
                  className={`chat-history-card ${isActive ? "is-active" : ""}`}
                  key={conversation.id}
                >
                  <button
                    className="chat-history-card__body"
                    disabled={disabled}
                    onClick={() => onSelect(conversation.id)}
                    type="button"
                  >
                    <span className="chat-history-card__title-row">
                      <span className="chat-history-card__title">
                        {conversation.title || "Untitled conversation"}
                      </span>
                      {conversation.visibility === "organization" ? (
                        <span className="chat-history-card__badge">Shared</span>
                      ) : null}
                      {!conversation.canManage ? (
                        <span className="chat-history-card__badge">Read-only</span>
                      ) : null}
                    </span>
                  </button>
                  <details className="chat-history-card__menu" data-dismiss-on-outside="true">
                    <summary
                      aria-label={`Conversation options for ${conversation.title || "Untitled conversation"}`}
                      className="chat-history-card__menu-trigger"
                    >
                      <span aria-hidden="true">⋮</span>
                    </summary>
                    <div className="chat-history-card__menu-items">
                      <button
                        className="chat-history-card__action"
                        disabled={disabled}
                        onClick={(event) => {
                          onPinToggle(conversation);
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                        type="button"
                      >
                        {conversation.isPinned ? "Unpin" : "Pin"}
                      </button>
                      {conversation.canManage ? (
                        <>
                          <button
                            className="chat-history-card__action"
                            disabled={disabled}
                            onClick={(event) => {
                              onShareToggle(conversation);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            type="button"
                          >
                            {conversation.visibility === "organization" ? "Unshare" : "Share"}
                          </button>
                          <button
                            className="chat-history-card__action"
                            disabled={disabled}
                            onClick={(event) => {
                              onRename(conversation);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="chat-history-card__action is-danger"
                            disabled={disabled}
                            onClick={(event) => {
                              onDelete(conversation);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </details>
                </div>
              );
            })}
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
  onDelete: (conversation: ConversationMetadata) => void;
  onNewChat: () => void;
  onPinToggle: (conversation: ConversationMetadata) => void;
  onQueryChange: (query: string) => void;
  onRename: (conversation: ConversationMetadata) => void;
  onSelect: (conversationId: string) => void;
  onShareToggle: (conversation: ConversationMetadata) => void;
  query: string;
  statusMessage: string | null;
  streaming: boolean;
};

function ChatHistorySidebar({
  activeConversationId,
  conversations,
  loading,
  onDelete,
  onNewChat,
  onPinToggle,
  onQueryChange,
  onRename,
  onSelect,
  onShareToggle,
  query,
  statusMessage,
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
      {statusMessage ? <p className="chat-history-status">{statusMessage}</p> : null}
      <div className="chat-history-sidebar__list">
        <ConversationHistoryList
          activeConversationId={activeConversationId}
          conversations={conversations}
          disabled={streaming}
          emptyMessage={emptyMessage}
          loading={loading}
          onDelete={onDelete}
          onPinToggle={onPinToggle}
          onRename={onRename}
          onSelect={onSelect}
          onShareToggle={onShareToggle}
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
  onDelete: (conversation: ConversationMetadata) => void;
  onPinToggle: (conversation: ConversationMetadata) => void;
  onQueryChange: (query: string) => void;
  onRename: (conversation: ConversationMetadata) => void;
  onSelect: (conversationId: string) => void;
  onShareToggle: (conversation: ConversationMetadata) => void;
  query: string;
  statusMessage: string | null;
  streaming: boolean;
};

function ChatHistoryDialog({
  activeConversationId,
  conversations,
  loading,
  onClose,
  onDelete,
  onPinToggle,
  onQueryChange,
  onRename,
  onSelect,
  onShareToggle,
  query,
  statusMessage,
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
        {statusMessage ? <p className="chat-history-status">{statusMessage}</p> : null}
        <div className="chat-history-dialog__list">
          <ConversationHistoryList
            activeConversationId={activeConversationId}
            conversations={conversations}
            disabled={streaming}
            emptyMessage={emptyMessage}
            loading={loading}
            onDelete={onDelete}
            onPinToggle={onPinToggle}
            onRename={onRename}
            onSelect={onSelect}
            onShareToggle={onShareToggle}
          />
        </div>
      </div>
    </div>
  );
}

function renderFileMentionPreviewBody(preview: KnowledgeFilePreview) {
  if (preview.kind === "csv") {
    return (
      <>
        <div className="chat-file-preview__eyebrow">
          CSV preview · {preview.rows.length} sample row{preview.rows.length === 1 ? "" : "s"}
          {preview.truncated ? " · truncated" : ""} · use the horizontal scrollbar or shift-scroll to view more columns
        </div>
        <div className="chat-file-preview__table-wrap">
          <table className="chat-file-preview__table">
            <thead>
              <tr>
                {preview.columns.map((column, columnIndex) => (
                  <th key={`${column}-${columnIndex}`}>{column || `Column ${columnIndex + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row.join("|")}`}>
                  {preview.columns.map((_, columnIndex) => (
                    <td key={`${rowIndex}-${columnIndex}`}>{row[columnIndex] ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (preview.kind === "text") {
    return (
      <>
        <div className="chat-file-preview__eyebrow">
          Text preview{preview.truncated ? " · truncated" : ""}
        </div>
        <div className="chat-file-preview__text">
          {preview.lines.slice(0, 8).map((line, index) => (
            <div key={`${index}-${line}`}>{line || " "}</div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="chat-file-preview__eyebrow">Preview unavailable</div>
      <div className="chat-file-preview__empty">{preview.message}</div>
    </>
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
  const conversationCanManageRef = useRef(true);
  const conversationPersistedRef = useRef(false);
  const fileMentionFilesRef = useRef<MentionableKnowledgeFile[] | null>(null);
  const fileMentionMenuRef = useRef<HTMLDivElement | null>(null);
  const fileMentionPreviewRef = useRef<HTMLDivElement | null>(null);
  const fileMentionPreviewCacheRef = useRef(new Map<string, KnowledgeFilePreview>());
  const fileMentionPreviewHideTimeoutRef = useRef<number | null>(null);
  const fileMentionPreviewRequestIdRef = useRef(0);
  const fileMentionStateRef = useRef<FileMentionMenuState | null>(null);
  const fileMentionRequestRef = useRef<Promise<MentionableKnowledgeFile[]> | null>(null);
  const historyQueryRef = useRef("");
  const historyRequestIdRef = useRef(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const messageIndexRef = useRef(0);
  const lastCompletedTurnIdRef = useRef<string | null>(null);
  const runDataAnalysisFailureStreakRef = useRef(0);
  const pendingChatTurnRef = useRef<PendingChatTurn | null>(null);
  const pendingAnalyticalClarificationRef = useRef<{
    conversationId: string | null;
    posture: EpistemicPosture | null;
    question: string | null;
    text: string | null;
  }>({ conversationId: null, posture: null, question: null, text: null });
  const plannerSearchesRef = useRef<PendingPlannerSearch[]>([]);
  const pendingSelectionRef = useRef<FileSelectionEventDetail | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const syntheticContinuationRef = useRef(false);
  const toolbarMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState("");
  const [analyticalClarificationBanner, setAnalyticalClarificationBanner] =
    useState<AnalyticalClarificationBannerState | null>(null);
  const [fileMentionMenu, setFileMentionMenu] = useState<FileMentionMenuState | null>(null);
  const [fileMentionPreview, setFileMentionPreview] = useState<FileMentionPreviewState | null>(
    null,
  );
  const [conversationBootstrap, setConversationBootstrap] =
    useState<ConversationBootstrapState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatusMessage, setHistoryStatusMessage] = useState<string | null>(null);
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

  const cancelScheduledFileMentionPreviewHide = useCallback(() => {
    if (fileMentionPreviewHideTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(fileMentionPreviewHideTimeoutRef.current);
    fileMentionPreviewHideTimeoutRef.current = null;
  }, []);

  const hideFileMentionPreview = useCallback(() => {
    cancelScheduledFileMentionPreviewHide();
    fileMentionPreviewRequestIdRef.current += 1;
    setFileMentionPreview(null);
  }, [cancelScheduledFileMentionPreviewHide]);

  const scheduleFileMentionPreviewHide = useCallback(() => {
    cancelScheduledFileMentionPreviewHide();
    fileMentionPreviewHideTimeoutRef.current = window.setTimeout(() => {
      fileMentionPreviewHideTimeoutRef.current = null;
      fileMentionPreviewRequestIdRef.current += 1;
      setFileMentionPreview(null);
    }, FILE_MENTION_PREVIEW_HIDE_DELAY_MS);
  }, [cancelScheduledFileMentionPreviewHide]);

  useEffect(() => {
    return () => {
      if (fileMentionPreviewHideTimeoutRef.current !== null) {
        window.clearTimeout(fileMentionPreviewHideTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    historyQueryRef.current = historyQuery;
  }, [historyQuery]);

  useEffect(() => {
    fileMentionStateRef.current = fileMentionMenu;
  }, [fileMentionMenu]);

  useEffect(() => {
    if (!fileMentionMenu) {
      hideFileMentionPreview();
    }
  }, [fileMentionMenu, hideFileMentionPreview]);

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
          conversationCanManageRef.current = true;
          conversationPersistedRef.current = false;
          lastCompletedTurnIdRef.current = null;
          setWorkflowBuilderOpen(false);
          setWorkflowDraft(null);
          setWorkflowDraftError(null);
          setWorkflowSaveError(null);
          setWorkflowSaveSuccess(null);
          setActiveConversationTitle("");
          setAnalyticalClarificationBanner(null);
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

        if (!("conversation" in data) || !("metadata" in data)) {
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
        conversationCanManageRef.current = data.metadata.canManage;
        conversationPersistedRef.current = true;
        lastCompletedTurnIdRef.current = null;
        setWorkflowBuilderOpen(false);
        setWorkflowDraft(null);
        setWorkflowDraftError(null);
        setWorkflowSaveError(null);
        setWorkflowSaveSuccess(null);
        setActiveConversationTitle(data.conversation.title);
        setAnalyticalClarificationBanner(null);
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
          conversationCanManageRef.current = true;
          conversationPersistedRef.current = false;
          lastCompletedTurnIdRef.current = null;
          setWorkflowBuilderOpen(false);
          setWorkflowDraft(null);
          setWorkflowDraftError(null);
          setWorkflowSaveError(null);
          setWorkflowSaveSuccess(null);
          setActiveConversationTitle("");
          setAnalyticalClarificationBanner(null);
          setConversationBootstrap(draft);
        }
      }
    }

    void initializeConversation();

    return () => {
      cancelled = true;
    };
  }, []);

  const getComposerTextarea = useCallback(() => {
    const textarea = hostRef.current?.querySelector("textarea");
    return textarea instanceof HTMLTextAreaElement ? textarea : null;
  }, []);

  const loadMentionableKnowledgeFiles = useCallback(async () => {
    if (fileMentionFilesRef.current) {
      return fileMentionFilesRef.current;
    }

    if (fileMentionRequestRef.current) {
      return fileMentionRequestRef.current;
    }

    const request = fetch("/api/knowledge/files?status=ready", {
      cache: "no-store",
    })
      .then(async (response) => {
        const data = (await response.json()) as
          | ListKnowledgeFilesResponse
          | {
              error: string;
            };

        if (!response.ok) {
          throw new Error(getErrorMessage(data, "Failed to load knowledge files."));
        }

        const files = ("files" in data ? data.files : [])
          .map((file) => ({
            accessScope: file.accessScope,
            displayName: file.displayName,
            id: file.id,
            sourcePath: file.sourcePath,
          }))
          .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

        fileMentionFilesRef.current = files;
        return files;
      })
      .finally(() => {
        fileMentionRequestRef.current = null;
      });

    fileMentionRequestRef.current = request;
    return request;
  }, []);

  const applyFileMention = useCallback((file: MentionableKnowledgeFile) => {
    const textarea = getComposerTextarea();

    if (!textarea) {
      setFileMentionMenu(null);
      hideFileMentionPreview();
      return;
    }

    const match = getFileMentionMatch(textarea.value, textarea.selectionStart);

    if (!match) {
      setFileMentionMenu(null);
      hideFileMentionPreview();
      return;
    }

    const nextValue = replaceFileMention(textarea.value, match, file.sourcePath);
    const suffix = textarea.value.slice(match.replaceTo);
    const nextCaret =
      match.replaceFrom +
      file.sourcePath.trim().length +
      1 +
      (suffix.length === 0 || !/^\s/.test(suffix) ? 1 : 0);
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;

    if (valueSetter) {
      valueSetter.call(textarea, nextValue);
    } else {
      textarea.value = nextValue;
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    textarea.focus();
    textarea.setSelectionRange(nextCaret, nextCaret);
    setFileMentionMenu(null);
    hideFileMentionPreview();
  }, [getComposerTextarea, hideFileMentionPreview]);

  const showFileMentionPreview = useCallback(
    async (file: MentionableKnowledgeFile, target: HTMLElement) => {
      cancelScheduledFileMentionPreviewHide();
      const rect = target.getBoundingClientRect();
      const width = Math.min(420, Math.max(320, Math.round(window.innerWidth * 0.28)));
      const preferRight = rect.right + 12 + width <= window.innerWidth - 12;
      const left = preferRight
        ? rect.right + 12
        : Math.max(12, rect.left - width - 12);
      const top = Math.max(12, Math.min(rect.top, window.innerHeight - 280));
      const cachedPreview = fileMentionPreviewCacheRef.current.get(file.id) ?? null;
      const nextRequestId = fileMentionPreviewRequestIdRef.current + 1;

      fileMentionPreviewRequestIdRef.current = nextRequestId;
      setFileMentionPreview({
        error: null,
        file,
        left,
        loading: !cachedPreview,
        preview: cachedPreview,
        top,
        width,
      });

      if (cachedPreview) {
        return;
      }

      try {
        const response = await fetch(`/api/knowledge/files/${file.id}/preview`, {
          cache: "no-store",
        });
        const data = (await response.json()) as
          | GetKnowledgeFilePreviewResponse
          | {
              error: string;
            };

        if (!response.ok) {
          throw new Error(getErrorMessage(data, "Failed to load file preview."));
        }

        if (!("preview" in data)) {
          throw new Error("Preview payload was missing from the response.");
        }

        fileMentionPreviewCacheRef.current.set(file.id, data.preview);

        if (fileMentionPreviewRequestIdRef.current !== nextRequestId) {
          return;
        }

        setFileMentionPreview({
          error: null,
          file,
          left,
          loading: false,
          preview: data.preview,
          top,
          width,
        });
      } catch (caughtError) {
        if (fileMentionPreviewRequestIdRef.current !== nextRequestId) {
          return;
        }

        setFileMentionPreview({
          error:
            caughtError instanceof Error ? caughtError.message : "Failed to load file preview.",
          file,
          left,
          loading: false,
          preview: null,
          top,
          width,
        });
      }
    },
    [cancelScheduledFileMentionPreviewHide],
  );

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
        registerPredictivePlanningMessageRenderers(webUi);
        registerPredictiveWorkspaceStatusMessageRenderers(webUi);

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
            title: activeConversationTitle.trim() || buildConversationTitle(messages),
            model: agent.state.model,
            thinkingLevel: agent.state.thinkingLevel,
            messages,
            createdAt: conversationCreatedAtRef.current || new Date().toISOString(),
            lastModified: new Date().toISOString(),
          } satisfies SessionData;
        };

        const saveConversationSnapshot = async (signal?: AbortSignal) => {
          if (!conversationCanManageRef.current) {
            const fork = createDraftConversation();
            conversationIdRef.current = fork.id;
            conversationCreatedAtRef.current = fork.createdAt;
            conversationCanManageRef.current = true;
            conversationPersistedRef.current = false;
          }

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
              if (!matchesConversationHistoryQuery(result.metadata, historyQueryRef.current)) {
                return removeConversationMetadata(current, result.metadata.id);
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

        const appendChatTextMessage = (role: "assistant" | "user", text: string) => {
          if (!agent || !text.trim()) {
            return;
          }

          agent.replaceMessages([
            ...(agent.state.messages as AgentMessage[]),
            {
              role,
              content: [{ type: "text", text: text.trim() }],
            } as AgentMessage,
          ]);
        };

        const appendUserTextMessage = (text: string) => {
          appendChatTextMessage("user", text);
        };

        const appendAssistantTextMessage = (text: string) => {
          appendChatTextMessage("assistant", text);
          scheduleConversationSave(true);
        };

        const getConversationReturnToChatHref = () =>
          conversationIdRef.current
            ? `/chat?conversation=${encodeURIComponent(conversationIdRef.current)}`
            : "/chat";

        const applyPendingPredictiveChatReturn = () => {
          if (!agent) {
            return;
          }

          const currentAgent = agent;

          applyPredictiveChatReturnFromUrl({
            getCurrentUrl: () => new URL(window.location.href),
            getMessages: () => currentAgent.state.messages as AgentMessage[],
            replaceHistoryUrl: (url) => {
              window.history.replaceState({}, "", url.toString());
            },
            replaceMessages: (messages) => {
              currentAgent.replaceMessages(messages);
            },
            scheduleConversationSave,
          });
        };

        const routePromptIfNeeded = async (
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
        ) => {
          if (synthetic) {
            return {
              continueInChat: true,
              resolvedInput: input,
            };
          }

          const userPromptText = extractPromptText(input);

          if (!userPromptText) {
            return {
              continueInChat: true,
              resolvedInput: input,
            };
          }

          const pendingClarification =
            pendingAnalyticalClarificationRef.current.conversationId === conversationIdRef.current
              ? pendingAnalyticalClarificationRef.current
              : null;
          const effectivePromptText = buildEffectiveAnalyticalPrompt(
            pendingClarification?.text,
            userPromptText,
            pendingClarification?.question,
          );
          const resolvedInput = typeof input === "string" ? effectivePromptText : input;

          try {
            const response = await fetch("/api/causal/intake", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                clarificationState: pendingClarification?.posture
                  ? { epistemicPosture: pendingClarification.posture }
                  : null,
                message: effectivePromptText,
              }),
            });
            const data = (await response.json()) as CausalIntakeResponse | { error: string } | null;

            if (!response.ok || typeof data !== "object" || data === null || !("decision" in data)) {
              pendingAnalyticalClarificationRef.current = {
                conversationId: null,
                posture: null,
                question: null,
                text: null,
              };
              setAnalyticalClarificationBanner(null);
              return {
                continueInChat: true,
                resolvedInput,
              };
            }

            if (data.decision === "open_causal_study") {
              pendingAnalyticalClarificationRef.current = {
                conversationId: null,
                posture: null,
                question: null,
                text: null,
              };
              setAnalyticalClarificationBanner(null);
              window.location.assign(`/causal/studies/${data.studyId}`);
              return {
                continueInChat: false,
                resolvedInput,
              };
            }

            if (data.decision === "open_predictive_analysis") {
              pendingAnalyticalClarificationRef.current = {
                conversationId: null,
                posture: null,
                question: null,
                text: null,
              };
              setAnalyticalClarificationBanner(null);
              return {
                continueInChat: true,
                resolvedInput,
              };
            }

            if (data.decision === "ask_clarification") {
              pendingAnalyticalClarificationRef.current = {
                conversationId: conversationIdRef.current,
                posture: data.clarificationState.epistemicPosture,
                question: data.question,
                text: effectivePromptText,
              };
              setAnalyticalClarificationBanner({
                conversationId: conversationIdRef.current,
                eyebrow:
                  data.ui?.eyebrow?.trim() ||
                  buildAnalyticalClarificationBannerEyebrow(
                    data.clarificationState.epistemicPosture,
                    effectivePromptText,
                  ),
                lead:
                  data.ui?.lead?.trim() ||
                  buildAnalyticalClarificationBannerLead(
                    data.clarificationState.epistemicPosture,
                    effectivePromptText,
                  ),
                question: data.question,
              });
              appendUserTextMessage(userPromptText);
              appendAssistantTextMessage(data.question);
              return {
                continueInChat: false,
                resolvedInput,
              };
            }

            if (data.decision === "blocked") {
              pendingAnalyticalClarificationRef.current = {
                conversationId: null,
                posture: null,
                question: null,
                text: null,
              };
              setAnalyticalClarificationBanner(null);
              appendUserTextMessage(userPromptText);
              appendAssistantTextMessage(data.message);
              return {
                continueInChat: false,
                resolvedInput,
              };
            }

            pendingAnalyticalClarificationRef.current = {
              conversationId: null,
              posture: null,
              question: null,
              text: null,
            };
            setAnalyticalClarificationBanner(null);
            return {
              continueInChat: true,
              resolvedInput,
            };
          } catch (caughtError) {
            console.error("Intent routing failed; continuing in chat.", caughtError);
            pendingAnalyticalClarificationRef.current = {
              conversationId: null,
              posture: null,
              question: null,
              text: null,
            };
            setAnalyticalClarificationBanner(null);
            return {
              continueInChat: true,
              resolvedInput,
            };
          }
        };

        const runPromptWithAudit = async (
          originalPrompt: Agent["prompt"],
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
          images?: unknown[],
        ) => {
          const routeResult = await routePromptIfNeeded(input, synthetic);

          if (!routeResult.continueInChat) {
            return;
          }

          const resolvedInput = routeResult.resolvedInput;
          queueChatTurn(resolvedInput, synthetic);

          if (synthetic) {
            syntheticContinuationRef.current = true;
          }

          try {
            if (typeof resolvedInput === "string") {
              await originalPrompt(resolvedInput, images as never);
              return;
            }

            await originalPrompt(resolvedInput as never);
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

        const {
          askUserTool,
          braveGroundingTool,
          braveSearchTool,
          searchCompanyKnowledgeTool,
        } = createInformationAndDecisionTools({
          Type,
          getErrorMessage,
          pushPlannerSearch,
          requestAskUserInput,
        });
        const { openPredictiveWorkspaceTool, updatePredictivePlanTool } =
          createPredictiveChatTools({
            Type,
            getConversationReturnToChatHref,
            getMessages: () => (agent ? (agent.state.messages as AgentMessage[]) : []),
            replaceMessages: (messages) => {
              if (!agent) {
                return;
              }

              agent.replaceMessages(messages);
            },
            scheduleConversationSave,
          });

        const {
          generateDocumentTool,
          generateVisualGraphTool,
          runDataAnalysisTool,
        } = createSandboxTools({
          Type,
          buildDataAnalysisTextAssetContent,
          buildGraphReviewImageContent,
          createToolRouteError,
          getActiveTurnId: () => activeTurnIdRef.current,
          hasPendingFileSelection: () =>
            awaitingFileSelectionRef.current || hasPendingPlannerSelection(),
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
              updatePredictivePlanTool,
              openPredictiveWorkspaceTool,
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

        const filterMentionableKnowledgeFiles = (query: string) => {
          const files = fileMentionFilesRef.current ?? [];
          const normalizedQuery = query.trim().toLowerCase();

          if (!normalizedQuery) {
            return files.slice(0, 8);
          }

          return files
            .filter((file) => {
              const pathLabel = file.sourcePath.toLowerCase();
              const displayLabel = file.displayName.toLowerCase();
              return (
                pathLabel.includes(normalizedQuery) || displayLabel.includes(normalizedQuery)
              );
            })
            .slice(0, 8);
        };

        const buildFileMentionMenuState = (
          textarea: HTMLTextAreaElement,
          query: string,
          loading: boolean,
        ) => {
          const rect = textarea.getBoundingClientRect();
          const width = Math.min(Math.max(rect.width, 320), 560);
          const left = Math.min(
            Math.max(12, rect.left),
            Math.max(12, window.innerWidth - width - 12),
          );

          return {
            files: filterMentionableKnowledgeFiles(query),
            highlightedIndex: 0,
            left,
            loading,
            query,
            top: Math.max(16, rect.top - 8),
            width,
          } satisfies FileMentionMenuState;
        };

        const refreshFileMentionMenu = async (textarea: HTMLTextAreaElement) => {
          const mentionMatch = getFileMentionMatch(textarea.value, textarea.selectionStart);

          if (!mentionMatch) {
            setFileMentionMenu(null);
            hideFileMentionPreview();
            return;
          }

          if (fileMentionFilesRef.current) {
            setFileMentionMenu(
              buildFileMentionMenuState(textarea, mentionMatch.query, false),
            );
            return;
          }

          setFileMentionMenu(buildFileMentionMenuState(textarea, mentionMatch.query, true));

          try {
            await loadMentionableKnowledgeFiles();
            const activeTextarea = getComposerTextarea();

            if (!activeTextarea) {
              setFileMentionMenu(null);
              hideFileMentionPreview();
              return;
            }

            const activeMentionMatch = getFileMentionMatch(
              activeTextarea.value,
              activeTextarea.selectionStart,
            );

            if (!activeMentionMatch) {
              setFileMentionMenu(null);
              hideFileMentionPreview();
              return;
            }

            setFileMentionMenu(
              buildFileMentionMenuState(activeTextarea, activeMentionMatch.query, false),
            );
          } catch (caughtError) {
            console.error("Failed to load knowledge files for @mentions.", caughtError);
            setFileMentionMenu(null);
            hideFileMentionPreview();
          }
        };

        const handleComposerInput = (event: Event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) {
            return;
          }

          hideFileMentionPreview();
          void refreshFileMentionMenu(event.target);
        };

        const handleComposerKeyDown = (event: Event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) {
            return;
          }

          const keyboardEvent = event as KeyboardEvent;
          const activeMenu = fileMentionStateRef.current;

          if (!activeMenu) {
            return;
          }

          if (keyboardEvent.key === "ArrowDown") {
            keyboardEvent.preventDefault();
            setFileMentionMenu((current) => {
              if (!current || current.files.length === 0) {
                return current;
              }

              return {
                ...current,
                highlightedIndex: Math.min(
                  current.highlightedIndex + 1,
                  current.files.length - 1,
                ),
              };
            });
            return;
          }

          if (keyboardEvent.key === "ArrowUp") {
            keyboardEvent.preventDefault();
            setFileMentionMenu((current) => {
              if (!current || current.files.length === 0) {
                return current;
              }

              return {
                ...current,
                highlightedIndex: Math.max(current.highlightedIndex - 1, 0),
              };
            });
            return;
          }

          if (
            (keyboardEvent.key === "Enter" || keyboardEvent.key === "Tab") &&
            activeMenu.files.length > 0
          ) {
            keyboardEvent.preventDefault();
            const selectedFile =
              activeMenu.files[
                Math.min(activeMenu.highlightedIndex, activeMenu.files.length - 1)
              ];

            if (selectedFile) {
              applyFileMention(selectedFile);
            }
            return;
          }

          if (keyboardEvent.key === "Escape") {
            keyboardEvent.preventDefault();
            setFileMentionMenu(null);
            hideFileMentionPreview();
          }
        };

        const handleComposerSelection = (event: Event) => {
          if (!(event.target instanceof HTMLTextAreaElement)) {
            return;
          }

          hideFileMentionPreview();
          void refreshFileMentionMenu(event.target);
        };

        const handleWindowResize = () => {
          const textarea = getComposerTextarea();

          if (!textarea) {
            setFileMentionMenu(null);
            hideFileMentionPreview();
            return;
          }

          void refreshFileMentionMenu(textarea);
        };

        const handleDocumentPointerDown = (event: Event) => {
          const target = event.target;

          if (!(target instanceof Node)) {
            return;
          }

          if (fileMentionMenuRef.current?.contains(target) || fileMentionPreviewRef.current?.contains(target)) {
            return;
          }

          if (target instanceof HTMLTextAreaElement) {
            return;
          }

          setFileMentionMenu(null);
          hideFileMentionPreview();
        };

        const composerHost = hostRef.current;
        composerHost.addEventListener("input", handleComposerInput);
        composerHost.addEventListener("keydown", handleComposerKeyDown);
        composerHost.addEventListener("click", handleComposerSelection);
        composerHost.addEventListener("keyup", handleComposerSelection);
        window.addEventListener("resize", handleWindowResize);
        document.addEventListener("pointerdown", handleDocumentPointerDown);

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
          updatePredictivePlanTool,
          openPredictiveWorkspaceTool,
          runDataAnalysisTool,
          generateVisualGraphTool,
          generateDocumentTool,
        ]);
        applyPendingPredictiveChatReturn();
        hostRef.current.replaceChildren(element);
        cleanup = () => {
          window.removeEventListener(
            FILE_SELECTION_EVENT,
            handleFileSelection as EventListener,
          );
          window.removeEventListener(ASK_USER_EVENT, handleAskUserSelection as EventListener);
          composerHost.removeEventListener("input", handleComposerInput);
          composerHost.removeEventListener("keydown", handleComposerKeyDown);
          composerHost.removeEventListener("click", handleComposerSelection);
          composerHost.removeEventListener("keyup", handleComposerSelection);
          window.removeEventListener("resize", handleWindowResize);
          document.removeEventListener("pointerdown", handleDocumentPointerDown);
          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
          setFileMentionMenu(null);
          hideFileMentionPreview();
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
      setFileMentionMenu(null);
      hideFileMentionPreview();
      setIsStreaming(false);
      cleanup?.();
    };
  }, [
    applyFileMention,
    conversationBootstrap,
    getComposerTextarea,
    hideFileMentionPreview,
    loadMentionableKnowledgeFiles,
    organizationSlug,
    role,
    userId,
  ]);

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
        setHistoryStatusMessage(null);
      }
    } catch (caughtError) {
      if (requestId === historyRequestIdRef.current) {
        console.error("Failed to load conversation history.", caughtError);
        setHistoryStatusMessage("Failed to load conversation history.");
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

  function applyConversationMetadataResult(metadata: ConversationMetadata) {
    setHistoryConversations((current) => {
      if (!matchesConversationHistoryQuery(metadata, historyQueryRef.current)) {
        return removeConversationMetadata(current, metadata.id);
      }

      const exists = current.some((conversation) => conversation.id === metadata.id);
      return exists
        ? updateConversationMetadata(current, metadata)
        : upsertConversationMetadata(current, metadata);
    });
  }

  async function patchConversation(conversationId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const data = (await response.json()) as UpdateConversationResponse | { error: string };

    if (!response.ok) {
      throw new Error(getErrorMessage(data, "Failed to update conversation."));
    }

    return data as UpdateConversationResponse;
  }

  async function destroyConversation(conversationId: string) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });
    const data = (await response.json()) as DeleteConversationResponse | { error: string };

    if (!response.ok) {
      throw new Error(getErrorMessage(data, "Failed to delete conversation."));
    }

    return data as DeleteConversationResponse;
  }

  async function handleTogglePinConversation(conversation: ConversationMetadata) {
    if (isStreaming) {
      return;
    }

    setHistoryStatusMessage(null);

    try {
      const result = await patchConversation(conversation.id, {
        pinned: !conversation.isPinned,
      });
      applyConversationMetadataResult(result.metadata);
      setHistoryStatusMessage(
        result.metadata.isPinned ? "Conversation pinned." : "Conversation unpinned.",
      );
    } catch (caughtError) {
      setHistoryStatusMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to update pin.",
      );
    }
  }

  async function handleRenameConversation(conversation: ConversationMetadata) {
    if (isStreaming || !conversation.canManage) {
      return;
    }

    const nextTitle = window.prompt("Rename conversation:", conversation.title)?.trim();

    if (!nextTitle || nextTitle === conversation.title) {
      return;
    }

    setHistoryStatusMessage(null);

    try {
      const result = await patchConversation(conversation.id, {
        title: nextTitle,
      });
      applyConversationMetadataResult(result.metadata);

      if (conversation.id === conversationIdRef.current) {
        setActiveConversationTitle(result.metadata.title);
      }

      setHistoryStatusMessage("Conversation renamed.");
    } catch (caughtError) {
      setHistoryStatusMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to rename conversation.",
      );
    }
  }

  async function handleToggleShareConversation(conversation: ConversationMetadata) {
    if (isStreaming || !conversation.canManage) {
      return;
    }

    const nextVisibility =
      conversation.visibility === "organization" ? "private" : "organization";

    setHistoryStatusMessage(null);

    try {
      const result = await patchConversation(conversation.id, {
        visibility: nextVisibility,
      });
      applyConversationMetadataResult(result.metadata);

      if (nextVisibility === "organization") {
        const url = new URL(window.location.href);
        url.searchParams.set("conversation", conversation.id);

        try {
          await copyToClipboard(url.toString());
          setHistoryStatusMessage("Conversation shared. Link copied to clipboard.");
        } catch {
          setHistoryStatusMessage("Conversation shared.");
        }
      } else {
        setHistoryStatusMessage("Conversation is now private.");
      }
    } catch (caughtError) {
      setHistoryStatusMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to update sharing.",
      );
    }
  }

  async function handleDeleteConversation(conversation: ConversationMetadata) {
    if (isStreaming || !conversation.canManage) {
      return;
    }

    const confirmed = window.confirm(
      `Delete \"${conversation.title || "Untitled conversation"}\"? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setHistoryStatusMessage(null);

    try {
      const result = await destroyConversation(conversation.id);
      setHistoryConversations((current) => removeConversationMetadata(current, result.conversationId));

      if (result.conversationId === conversationIdRef.current) {
        handleNewChat();
      }

      setHistoryStatusMessage("Conversation deleted.");
    } catch (caughtError) {
      setHistoryStatusMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to delete conversation.",
      );
    }
  }

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

    setHistoryStatusMessage(null);
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

      if (!("conversation" in data) || !("metadata" in data)) {
        throw new Error("Conversation payload was missing from the response.");
      }

      conversationIdRef.current = data.conversation.id;
      conversationCreatedAtRef.current = data.conversation.createdAt;
      conversationCanManageRef.current = data.metadata.canManage;
      conversationPersistedRef.current = true;
      lastCompletedTurnIdRef.current = null;
      setWorkflowBuilderOpen(false);
      setWorkflowDraft(null);
      setWorkflowDraftError(null);
      setWorkflowSaveError(null);
      setWorkflowSaveSuccess(null);
      setActiveConversationTitle(data.conversation.title);
      setAnalyticalClarificationBanner(null);
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
    conversationCanManageRef.current = true;
    conversationPersistedRef.current = false;
    lastCompletedTurnIdRef.current = null;
    setWorkflowBuilderOpen(false);
    setWorkflowDraft(null);
    setWorkflowDraftError(null);
    setWorkflowSaveError(null);
    setWorkflowSaveSuccess(null);
    setActiveConversationTitle("");
    setAnalyticalClarificationBanner(null);
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
        onDelete={(conversation) => {
          void handleDeleteConversation(conversation);
        }}
        onNewChat={handleNewChat}
        onPinToggle={(conversation) => {
          void handleTogglePinConversation(conversation);
        }}
        onQueryChange={setHistoryQuery}
        onRename={(conversation) => {
          void handleRenameConversation(conversation);
        }}
        onSelect={(conversationId) => {
          void handleSelectConversation(conversationId);
        }}
        onShareToggle={(conversation) => {
          void handleToggleShareConversation(conversation);
        }}
        query={historyQuery}
        statusMessage={historyStatusMessage}
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
        {analyticalClarificationBanner?.conversationId === conversationIdRef.current ? (
          <section aria-live="polite" className="chat-clarification-banner">
            <div className="chat-clarification-banner__meta">
              <span className="chat-clarification-banner__eyebrow">
                {analyticalClarificationBanner.eyebrow}
              </span>
              <span className="chat-clarification-banner__lead">
                {analyticalClarificationBanner.lead}
              </span>
            </div>
            <div className="chat-clarification-banner__question">
              <p>{analyticalClarificationBanner.question}</p>
            </div>
          </section>
        ) : null}
        <div className="chat-host" ref={hostRef} />
        {fileMentionMenu ? (
          <div
            className="chat-file-mentions"
            onMouseEnter={() => {
              cancelScheduledFileMentionPreviewHide();
            }}
            onMouseLeave={() => {
              scheduleFileMentionPreviewHide();
            }}
            ref={fileMentionMenuRef}
            style={{
              left: `${fileMentionMenu.left}px`,
              top: `${fileMentionMenu.top}px`,
              transform: "translateY(-100%)",
              width: `${fileMentionMenu.width}px`,
            }}
          >
            <div className="chat-file-mentions__header">
              <span>@ files</span>
              <span className="chat-file-mentions__query">
                {fileMentionMenu.query ? `“${fileMentionMenu.query}”` : "All files"}
              </span>
            </div>
            <div className="chat-file-mentions__list">
              {fileMentionMenu.loading ? (
                <div className="chat-file-mentions__empty">Loading files…</div>
              ) : fileMentionMenu.files.length > 0 ? (
                fileMentionMenu.files.map((file, index) => (
                  <button
                    className={`chat-file-mentions__item ${
                      index === fileMentionMenu.highlightedIndex
                        ? "chat-file-mentions__item--active"
                        : ""
                    }`}
                    key={file.id}
                    onFocus={(event) => {
                      void showFileMentionPreview(file, event.currentTarget);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyFileMention(file);
                    }}
                    onMouseEnter={(event) => {
                      void showFileMentionPreview(file, event.currentTarget);
                    }}
                    type="button"
                  >
                    <span className="chat-file-mentions__path">@{file.sourcePath}</span>
                    <span className="chat-file-mentions__meta">
                      <span>{file.displayName}</span>
                      <span className="chat-file-mentions__scope">{file.accessScope}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="chat-file-mentions__empty">No matching files.</div>
              )}
            </div>
          </div>
        ) : null}
        {fileMentionPreview ? (
          <div
            className="chat-file-preview"
            onMouseEnter={() => {
              cancelScheduledFileMentionPreviewHide();
            }}
            onMouseLeave={() => {
              scheduleFileMentionPreviewHide();
            }}
            ref={fileMentionPreviewRef}
            style={{
              left: `${fileMentionPreview.left}px`,
              top: `${fileMentionPreview.top}px`,
              width: `${fileMentionPreview.width}px`,
            }}
          >
            <div className="chat-file-preview__header">
              <div className="chat-file-preview__title">@{fileMentionPreview.file.sourcePath}</div>
              <div className="chat-file-preview__scope">{fileMentionPreview.file.accessScope}</div>
            </div>
            {fileMentionPreview.loading ? (
              <div className="chat-file-preview__empty">Loading preview…</div>
            ) : fileMentionPreview.error ? (
              <div className="chat-file-preview__empty">{fileMentionPreview.error}</div>
            ) : fileMentionPreview.preview ? (
              renderFileMentionPreviewBody(fileMentionPreview.preview)
            ) : (
              <div className="chat-file-preview__empty">Preview unavailable.</div>
            )}
          </div>
        ) : null}
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
          onDelete={(conversation) => {
            void handleDeleteConversation(conversation);
          }}
          onPinToggle={(conversation) => {
            void handleTogglePinConversation(conversation);
          }}
          onQueryChange={setHistoryQuery}
          onRename={(conversation) => {
            void handleRenameConversation(conversation);
          }}
          onSelect={(conversationId) => {
            void handleSelectConversation(conversationId);
          }}
          onShareToggle={(conversation) => {
            void handleToggleShareConversation(conversation);
          }}
          query={historyQuery}
          statusMessage={historyStatusMessage}
          streaming={isStreaming}
        />
      ) : null}
    </div>
  );
}
