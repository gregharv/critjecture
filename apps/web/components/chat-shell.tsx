"use client";

import { useEffect, useRef, useState } from "react";

import type { Agent, AgentMessage, SessionData } from "@mariozechner/pi-web-ui";

import type {
  CompanyKnowledgeCandidateFile,
  CompanyKnowledgeMatch,
} from "@/lib/company-knowledge-types";
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
  GeneratedAssetToolResponse,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";
import { registerCritjectureToolRenderers } from "@/lib/tool-renderers";
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

const AUDIT_MODEL_NAME = "gpt-4o-mini";

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

function getUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

function getSystemPrompt(role: UserRole) {
  const roleLabel = getRoleLabel(role);
  const scopeRule =
    role === "owner"
      ? "You may search all files inside the current organization's company_data when needed."
      : "You may search only public files inside the current organization's company_data/public. Never imply access to admin-only data.";

  return [
    "You are a concise, reliable assistant for a property management workflow prototype.",
    `Current user role: ${roleLabel}.`,
    "Use the search_company_knowledge tool first whenever the user asks about company files, schedules, profits, ledgers, notices, or any internal records.",
    "Search with short keywords, filenames, or years such as payout, contractor, 2026, or contractors_new.csv.",
    "Use the run_data_analysis tool whenever the user asks for calculations, Python execution, tabular analysis, or anything that should be computed rather than guessed without creating a file.",
    "Use the generate_visual_graph tool whenever the user asks for a chart, graph, plot, or other visual. Use matplotlib only, build the dataset with Polars when CSV input files are staged, save exactly one PNG file inside outputs/chart.png, and print a short summary.",
    "Use the generate_document tool whenever the user asks for a PDF, notice, letter, or downloadable document. Use reportlab, save exactly one PDF file inside outputs/notice.pdf, and print a short summary.",
    "When you use run_data_analysis on company files, pass those relative paths in inputFiles. Each file will be staged into the sandbox at inputs/<same-relative-path>.",
    "When you use generate_visual_graph or generate_document on company files, pass those same relative paths in inputFiles.",
    "The search tool may return auto-selected files or trigger a planner-level multi-select picker after the assistant finishes gathering candidates. If selection is pending, do not call any Python sandbox tool yet. Wait for the user to confirm the picker first.",
    "When you use any Python sandbox tool, write complete Python 3.13 code and print the final answer to stdout.",
    "Never rely on a trailing expression like `mean, median`; use print(...).",
    "If you need to return multiple analytical values, print a single JSON object so the UI can render it clearly.",
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

        const sandboxToolParameters = Type.Object({
          code: Type.String({
            description:
              "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path> for the current organization. Use Polars for staged CSV inputs and use pl.scan_csv(...).collect(). Always print the final answer to stdout.",
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

        const createSandboxTool = <TResponse extends SandboxToolResponse>(
          options: {
            description: string;
            label: string;
            name: string;
            route: string;
          },
        ) => ({
          name: options.name,
          label: options.label,
          description: options.description,
          parameters: sandboxToolParameters,
          async execute(
            _runtimeToolCallId: string,
            params: { code: string; inputFiles?: string[] },
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
                code: params.code,
                inputFiles: params.inputFiles ?? [],
              }),
              signal,
            });

            const data = (await response.json()) as TResponse | { error: string };

            if (!response.ok) {
              throw new Error(
                "error" in data ? data.error : `${options.label} request failed.`,
              );
            }

            const result = data as TResponse;

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

        const runDataAnalysisTool = createSandboxTool<SandboxToolResponse>({
          name: "run_data_analysis",
          label: "Run Data Analysis",
          description:
            "Execute short Python snippets in the isolated sandbox. Use this for calculations, Polars analysis, and deterministic computed answers.",
          route: "/api/data-analysis/run",
        });

        const generateVisualGraphTool = createSandboxTool<GeneratedAssetToolResponse>({
          name: "generate_visual_graph",
          label: "Generate Visual Graph",
          description:
            "Execute Python in the isolated sandbox to generate exactly one PNG chart inside outputs/. Use matplotlib, read staged CSV files with Polars scan_csv(...).collect(), plot plain Python lists, and print a one-line summary.",
          route: "/api/visual-graph/run",
        });

        const generateDocumentTool = createSandboxTool<GeneratedAssetToolResponse>({
          name: "generate_document",
          label: "Generate Document",
          description:
            "Execute Python in the isolated sandbox to generate exactly one PDF document inside outputs/. Use reportlab and print a one-line summary after writing the file.",
          route: "/api/document/generate",
        });

        agent = new Agent({
          initialState: {
            systemPrompt: getSystemPrompt(role),
            model:
              initialConversation.initialSessionData?.model ??
              getModel("openai", "gpt-4o-mini"),
            thinkingLevel:
              initialConversation.initialSessionData?.thinkingLevel ?? "off",
            messages: initialConversation.initialSessionData?.messages ?? [],
            tools: [
              searchCompanyKnowledgeTool,
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
          const status: ToolCallStatus = isError ? "error" : "completed";
          const errorMessage = isError ? resultSummary || "Tool execution failed." : null;

          try {
            await postAuditJson<{ ok: true }>("/api/audit/tool-calls/finish", {
              accessedFiles,
              errorMessage,
              resultSummary: resultSummary || null,
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
                    modelName: AUDIT_MODEL_NAME,
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

        window.addEventListener(FILE_SELECTION_EVENT, handleFileSelection as EventListener);
        agent.setTools([
          searchCompanyKnowledgeTool,
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
          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
          }
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
        <div className="chat-toolbar__title-group">
          <span className="chat-toolbar__eyebrow">Conversation</span>
          <span className="chat-toolbar__title">
            {activeConversationTitle || "New conversation"}
          </span>
        </div>
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
