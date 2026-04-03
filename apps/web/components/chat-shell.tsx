"use client";

import { useEffect, useRef, useState } from "react";

import type { Agent, AgentMessage, SessionData } from "@mariozechner/pi-web-ui";

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
  DataAnalysisToolResponse,
  GeneratedAssetToolResponse,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";
import { registerCritjectureToolRenderers } from "@/lib/tool-renderers";
import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_CHAT_THINKING_LEVEL,
  getSessionModelId,
} from "@/lib/chat-models";
import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { getRoleLabel, type UserRole } from "@/lib/roles";

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

const GRAPH_REVIEW_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

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

function getSystemPrompt(role: UserRole) {
  const roleLabel = getRoleLabel(role);
  const scopeRule =
    canRoleAccessKnowledgeScope(role, "admin")
      ? "You may search all files inside the current organization's company_data when needed."
      : "You may search only public files inside the current organization's company_data/public. Never imply access to admin-only data.";

  return [
    "You are a concise, reliable assistant for a property management workflow prototype.",
    `Current user role: ${roleLabel}.`,
    "Use the search_company_knowledge tool first whenever the user asks about company files, schedules, profits, ledgers, notices, or any internal records.",
    "Search with short keywords, filenames, or years such as payout, contractor, 2026, or contractors_new.csv.",
    "Use brave_search for public web lookups, documentation checks, or current external context that is not inside company_data.",
    "If the user explicitly asks for grounded web citations, use brave_grounding.",
    "Use ask_user when requirements are ambiguous, a decision must be confirmed, or multiple valid options exist.",
    "Use the run_data_analysis tool whenever the user asks for calculations, Python execution, tabular analysis, or anything that should be computed rather than guessed without creating a file.",
    "Use the generate_visual_graph tool whenever the user asks for a chart, graph, plot, or other visual. It can either render a stored chart via analysisResultId or run full matplotlib code directly against staged company files.",
    "After generate_visual_graph returns, inspect the tool result image before finalizing your response. If readability, labels, or chart choice are weak, run generate_visual_graph one more time with improved plotting code; limit this self-revision to one extra pass.",
    "For most CSV-backed charts, prefer a single generate_visual_graph call with inputFiles and complete matplotlib code that reads inputs/<same-relative-path> with Polars and saves outputs/chart.png.",
    "Use run_data_analysis before generate_visual_graph only when you first need a non-visual computed answer, schema inspection, or reusable chart-ready JSON. If you do that, print exactly one JSON object via json.dumps(...). Use either {\"chart\":{\"type\":\"bar\",\"x\":[...],\"y\":[...],\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\"}} for one series or {\"chart\":{\"type\":\"line\",\"series\":[{\"name\":\"Queue A\",\"x\":[...],\"y\":[...]}],\"title\":\"...\",\"xLabel\":\"...\",\"yLabel\":\"...\"}} for multiple colored series.",
    "Use the generate_document tool whenever the user asks for a PDF, notice, letter, or downloadable document. Use reportlab, save exactly one PDF file inside outputs/notice.pdf, and print a short summary.",
    "When you use run_data_analysis on company files, pass those relative paths in inputFiles. Each file will be staged into the sandbox at inputs/<same-relative-path>.",
    "When you use generate_document on company files, pass those same relative paths in inputFiles.",
    "The search tool may return auto-selected files or trigger a planner-level multi-select picker after the assistant finishes gathering candidates. If selection is pending, do not call any Python sandbox tool yet. Wait for the user to confirm the picker first.",
    "When you use any Python sandbox tool, write complete Python 3.13 code and print the final answer to stdout.",
    "Never rely on a trailing expression like `mean, median`; use print(...).",
    "If you need to return multiple analytical values or prepare chart data, print a single JSON object so the UI can render it clearly.",
    "For any staged CSV input, use Polars only. You must use pl.scan_csv(...) and a final .collect(). Never use pandas, pd.read_csv(...), or pl.read_csv(...).",
    "Polars cheat sheet: use DataFrame.group_by(...), not groupby(...). Use df.sort('column', descending=True), not reverse=True or 'desc'. Use exact CSV headers in pl.col(...), for example ledger_year instead of inventing year. Convert plot columns with series.to_list() before passing them to matplotlib.",
    "matplotlib is available for PNG charts. Convert chart columns to plain Python lists before plotting.",
    "reportlab is available for PDFs. For a simple notice, use reportlab.pdfgen.canvas.Canvas with outputs/notice.pdf.",
    "Never claim that you cannot execute Python. You can execute Python through the available tool.",
    scopeRule,
    "If the tool returns no matches, say you could not find that information in the current access scope.",
  ].join(" ");
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

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days <= 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  if (days < 7) {
    return `${days} days ago`;
  }

  return date.toLocaleDateString();
}

type ChatHistoryDialogProps = {
  activeConversationId: string | null;
  conversations: ConversationMetadata[];
  loading: boolean;
  onClose: () => void;
  onSelect: (conversationId: string) => void;
};

function ChatHistoryDialog({
  activeConversationId,
  conversations,
  loading,
  onClose,
  onSelect,
}: ChatHistoryDialogProps) {
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
        <div className="chat-history-dialog__list">
          {loading ? (
            <div className="chat-history-empty">Loading conversation history...</div>
          ) : conversations.length === 0 ? (
            <div className="chat-history-empty">No saved conversations yet.</div>
          ) : (
            conversations.map((conversation) => (
              <button
                className={`chat-history-card ${
                  conversation.id === activeConversationId ? "is-active" : ""
                }`}
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
                type="button"
              >
                <div className="chat-history-card__header">
                  <span className="chat-history-card__title">
                    {conversation.title || "Untitled conversation"}
                  </span>
                  <span className="chat-history-card__date">
                    {formatRelativeDate(conversation.lastModified)}
                  </span>
                </div>
                <p className="chat-history-card__preview">
                  {conversation.preview || "No preview available yet."}
                </p>
                <div className="chat-history-card__meta">
                  <span>{conversation.messageCount} messages</span>
                  <span>${conversation.usage.cost.total.toFixed(4)}</span>
                </div>
              </button>
            ))
          )}
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const messageIndexRef = useRef(0);
  const pendingChatTurnRef = useRef<PendingChatTurn | null>(null);
  const plannerSearchesRef = useRef<PendingPlannerSearch[]>([]);
  const pendingSelectionRef = useRef<FileSelectionEventDetail | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const syntheticContinuationRef = useRef(false);
  const [activeConversationTitle, setActiveConversationTitle] = useState("");
  const [conversationBootstrap, setConversationBootstrap] =
    useState<ConversationBootstrapState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyConversations, setHistoryConversations] = useState<ConversationMetadata[]>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [{ error, ready }, setState] = useState<ChatShellState>({
    error: null,
    ready: false,
  });

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
            setHistoryConversations((current) =>
              upsertConversationMetadata(current, result.metadata),
            );

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
                "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path> for the current organization. Use Polars for staged CSV inputs and use pl.scan_csv(...).collect(). Always print the final answer to stdout. If you are preparing reusable chart-ready data instead of saving a PNG, print exactly one JSON object under a chart key, preferably via json.dumps(...). Multi-series charts may use chart.series with items shaped like {name, x, y}.",
            minLength: 1,
          }),
          inputFiles: Type.Optional(
            Type.Array(
              Type.String({
                description:
                  "A company_data-relative file path for the current organization discovered via search_company_knowledge, such as admin/contractors_new.csv.",
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
                  "Optional company_data-relative paths to stage for plotting code, such as admin/contractors_new.csv. These are ignored when analysisResultId is used.",
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
                "A short keyword, filename, or year such as profit, payout, contractor, contractors.csv, or 2026.",
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
            "Execute short Python snippets in the isolated sandbox. Use this for calculations, Polars analysis, and deterministic computed answers. If you want reusable chart-ready data instead of a PNG, print exactly one JSON object under chart, using json.dumps(...) and chart.series for multi-line or grouped charts when needed.",
          parameters: sandboxToolParameters,
          route: "/api/data-analysis/run",
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
            systemPrompt: getSystemPrompt(role),
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

            return streamProxy(model, context, {
              ...options,
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
      pendingChatTurnRef.current = null;
      plannerSearchesRef.current = [];
      pendingSelectionRef.current = null;
      syntheticContinuationRef.current = false;
      setIsStreaming(false);
      cleanup?.();
    };
  }, [conversationBootstrap, organizationSlug, role, userId]);

  async function loadConversationHistory() {
    setHistoryLoading(true);

    try {
      const response = await fetch("/api/conversations");
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

      setHistoryConversations(data.conversations);
    } catch (caughtError) {
      console.error("Failed to load conversation history.", caughtError);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleOpenHistory() {
    if (isStreaming) {
      return;
    }

    setHistoryOpen(true);
    await loadConversationHistory();
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
      <div className="chat-toolbar">
        <details className="chat-toolbar__menu">
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
              className="chat-toolbar__button"
              disabled={isStreaming || !conversationBootstrap}
              onClick={() => {
                void handleOpenHistory();
              }}
              type="button"
            >
              History
            </button>
            <button
              className="chat-toolbar__button chat-toolbar__button--primary"
              disabled={isStreaming || !conversationBootstrap}
              onClick={handleNewChat}
              type="button"
            >
              New chat
            </button>
          </div>
        </details>
      </div>
      <div className="chat-host" ref={hostRef} />
      {!ready ? (
        <div className="chat-fallback chat-fallback-overlay">
          Loading chat shell...
        </div>
      ) : null}
      {historyOpen ? (
        <ChatHistoryDialog
          activeConversationId={conversationIdRef.current}
          conversations={historyConversations}
          loading={historyLoading}
          onClose={() => setHistoryOpen(false)}
          onSelect={(conversationId) => {
            void handleSelectConversation(conversationId);
          }}
        />
      ) : null}
    </div>
  );
}
