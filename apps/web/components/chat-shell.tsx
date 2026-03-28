"use client";

import { useEffect, useRef, useState } from "react";

import type { Agent, AgentMessage } from "@mariozechner/pi-web-ui";

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
  AuditToolCallStatus,
  CreateAuditPromptResponse,
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

type PendingAuditPrompt = {
  promptText: string;
  synthetic: boolean;
};

type PendingPlannerSearch = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  query: string;
  recommendedFiles: string[];
  selectedFiles: string[];
  selectionRequired: boolean;
};

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

function extractAssistantTraceEntries(message: AgentMessage) {
  if (!isAssistantAgentMessage(message) || !Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap<{
    content: string;
    kind: "assistant-text";
    title: string;
  }>((entry) => {
    if (typeof entry !== "object" || entry === null || !("type" in entry)) {
      return [];
    }

    if (entry.type === "text") {
      const content = getContentString(entry, "text");

      return content
        ? [
            {
              content,
              kind: "assistant-text" as const,
              title: "Assistant Response",
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
      ? "You may search all files inside company_data when needed."
      : "You may search only public files inside company_data/public. Never imply access to admin-only data.";

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
    "matplotlib is available for PNG charts. Convert chart columns to plain Python lists before plotting.",
    "reportlab is available for PDFs. For a simple notice, use reportlab.pdfgen.canvas.Canvas with outputs/notice.pdf.",
    "Never claim that you cannot execute Python. You can execute Python through the available tool.",
    scopeRule,
    "If the tool returns no matches, say you could not find that information in the current access scope.",
  ].join(" ");
}

type ChatShellProps = {
  role: UserRole;
  userId: string;
};

export function ChatShellWithRole({ role, userId }: ChatShellProps) {
  const activePromptIdRef = useRef<string | null>(null);
  const awaitingFileSelectionRef = useRef(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingAuditPromptRef = useRef<PendingAuditPrompt | null>(null);
  const plannerSearchesRef = useRef<PendingPlannerSearch[]>([]);
  const pendingSelectionRef = useRef<FileSelectionEventDetail | null>(null);
  const syntheticContinuationRef = useRef(false);
  const [{ error, ready }, setState] = useState<ChatShellState>({
    error: null,
    ready: false,
  });

  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;
    let agent: Agent | null = null;

    setState({ error: null, ready: false });

    async function bootstrap() {
      try {
        const sessionId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `critjecture-${Date.now()}`;

        const [{ Agent, streamProxy }, { Type, getModel }, webUi] = await Promise.all([
          import("@mariozechner/pi-agent-core"),
          import("@mariozechner/pi-ai"),
          import("@mariozechner/pi-web-ui"),
        ]);

        const settings = new webUi.SettingsStore();
        const providerKeys = new webUi.ProviderKeysStore();
        const sessions = new webUi.SessionsStore();
        const customProviders = new webUi.CustomProvidersStore();

        const backend = new webUi.IndexedDBStorageBackend({
          dbName: `critjecture-user-${userId}`,
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

        const queueAuditPrompt = (
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
        ) => {
          const promptText = extractPromptText(input);

          if (!synthetic) {
            plannerSearchesRef.current = [];
          }

          if (!promptText) {
            return;
          }

          pendingAuditPromptRef.current = {
            promptText,
            synthetic,
          };
        };

        const runPromptWithAudit = async (
          originalPrompt: Agent["prompt"],
          input: string | AgentMessage | AgentMessage[],
          synthetic: boolean,
          images?: unknown[],
        ) => {
          queueAuditPrompt(input, synthetic);

          if (synthetic) {
            syntheticContinuationRef.current = true;
          }

          if (typeof input === "string") {
            await originalPrompt(input, images as never);
            return;
          }

          await originalPrompt(input as never);
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
              "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path>. Use Polars for staged CSV inputs and use pl.scan_csv(...).collect(). Always print the final answer to stdout.",
            minLength: 1,
          }),
          inputFiles: Type.Optional(
            Type.Array(
              Type.String({
                description:
                  "A company_data-relative file path discovered via search_company_knowledge, such as admin/contractors_new.csv.",
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
            _toolCallId: string,
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
            "Search company_data using short keywords, filenames, or years. The tool may auto-select files or trigger a planner-level multi-select picker when multiple files are relevant.",
          parameters: Type.Object({
            query: Type.String({
              description:
                "A short keyword, filename, or year such as profit, payout, contractor, contractors.csv, or 2026.",
              minLength: 1,
            }),
          }),
          async execute(_toolCallId: string, params: { query: string }, signal?: AbortSignal) {
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
            model: getModel("openai", "gpt-4o-mini"),
            thinkingLevel: "off",
            messages: [],
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
            const pendingAuditPrompt = pendingAuditPromptRef.current;

            if (pendingAuditPrompt) {
              pendingAuditPromptRef.current = null;

              if (!pendingAuditPrompt.synthetic) {
                try {
                  const auditResponse = await postAuditJson<CreateAuditPromptResponse>(
                    "/api/audit/prompts",
                    {
                      chatSessionId: sessionId,
                      promptText: pendingAuditPrompt.promptText,
                    },
                    options?.signal,
                  );

                  activePromptIdRef.current = auditResponse.promptId;
                } catch (caughtError) {
                  console.error("Failed to audit prompt before streaming.", caughtError);
                  activePromptIdRef.current = null;
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
        agent.sessionId = sessionId;

        const originalPrompt = agent.prompt.bind(agent);
        const auditedPrompt = (async (
          input: string | AgentMessage | AgentMessage[],
          images?: unknown[],
        ) => {
          await runPromptWithAudit(originalPrompt, input, false, images);
        }) as typeof agent.prompt;

        agent.prompt = auditedPrompt;
        agent.setBeforeToolCall(async ({ args, toolCall }) => {
          const promptId = activePromptIdRef.current;

          if (!promptId) {
            return undefined;
          }

          try {
            await postAuditJson<{ ok: true }>("/api/audit/tool-calls/start", {
              parametersJson: stringifyToolArgs(args),
              promptId,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            });
          } catch (caughtError) {
            console.error("Failed to audit tool call start.", caughtError);
          }

          return undefined;
        });
        agent.setAfterToolCall(async ({ args, isError, result, toolCall }) => {
          const promptId = activePromptIdRef.current;

          if (!promptId) {
            return undefined;
          }

          const resultSummary = getToolResultSummary(result);
          const accessedFiles = extractAccessedFiles(args, result);
          const status: AuditToolCallStatus = isError ? "error" : "completed";
          const errorMessage = isError ? resultSummary || "Tool execution failed." : null;

          try {
            await postAuditJson<{ ok: true }>("/api/audit/tool-calls/finish", {
              accessedFiles,
              errorMessage,
              promptId,
              resultSummary: resultSummary || null,
              status,
              toolCallId: toolCall.id,
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
          if (event.type === "message_end" && activePromptIdRef.current) {
            const promptId = activePromptIdRef.current;
            const traceEntries = extractAssistantTraceEntries(event.message);

            if (traceEntries.length > 0) {
              void Promise.all(
                traceEntries.map((traceEntry) =>
                  postAuditJson<{ ok: true }>("/api/audit/trace-events", {
                    content: traceEntry.content,
                    kind: traceEntry.kind,
                    promptId,
                    title: traceEntry.title,
                  }).catch((caughtError) => {
                    console.error("Failed to audit assistant trace event.", caughtError);
                  }),
                ),
              );
            }
          }

          if (event.type === "agent_end") {
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

            activePromptIdRef.current = null;
            plannerSearchesRef.current = [];
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
      activePromptIdRef.current = null;
      awaitingFileSelectionRef.current = false;
      pendingAuditPromptRef.current = null;
      plannerSearchesRef.current = [];
      pendingSelectionRef.current = null;
      syntheticContinuationRef.current = false;
      cleanup?.();
    };
  }, [role, userId]);

  if (error) {
    return (
      <div className="chat-shell">
        <div className="chat-error">Failed to initialize chat: {error}</div>
      </div>
    );
  }

  return (
    <div className="chat-shell">
      <div className="chat-host" ref={hostRef} />
      {!ready ? (
        <div className="chat-fallback chat-fallback-overlay">
          Loading chat shell...
        </div>
      ) : null}
    </div>
  );
}
