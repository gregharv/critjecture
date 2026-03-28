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
  type FileSelectionEventDetail,
} from "@/lib/file-selection-messages";
import { registerCritjectureToolRenderers } from "@/lib/tool-renderers";
import { getRoleLabel, type UserRole } from "@/lib/roles";

type ChatShellState = {
  error: string | null;
  ready: boolean;
};

type SearchToolResponse = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  matches: CompanyKnowledgeMatch[];
  role: UserRole;
  selectedFile?: string;
  selectionReason:
    | "single-candidate"
    | "unique-year-match"
    | "multiple-candidates"
    | "no-match";
  selectionRequired: boolean;
  scopeDescription: string;
  summary: string;
};

type SandboxToolResponse = {
  exitCode: number;
  pythonExecutable: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
  stderr: string;
  stdout: string;
  summary: string;
  workspaceDir: string;
};

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
    "Use the run_data_analysis tool whenever the user asks for calculations, Python execution, tabular analysis, or anything that should be computed rather than guessed.",
    "When you use run_data_analysis on company files, pass those relative paths in inputFiles. Each file will be staged into the sandbox at inputs/<same-relative-path>.",
    "The search tool may return an auto-selected file or require user selection. If selection is required, do not call run_data_analysis. Wait for the user to choose a file first.",
    "When you use run_data_analysis, write complete Python 3.13 code that prints the final answer to stdout.",
    "Never rely on a trailing expression like `mean, median`; use print(...).",
    "If you need to return multiple analytical values, print a single JSON object so the UI can render it clearly.",
    "For CSV analysis, use Polars only. You must use pl.scan_csv(...) and a final .collect(). Never use pandas, pd.read_csv(...), or pl.read_csv(...).",
    "Never claim that you cannot execute Python. You can execute Python through the available tool.",
    scopeRule,
    "If the tool returns no matches, say you could not find that information in the current access scope.",
  ].join(" ");
}

export function ChatShell() {
  return <ChatShellWithRole role="intern" />;
}

type ChatShellProps = {
  role: UserRole;
};

export function ChatShellWithRole({ role }: ChatShellProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingSelectionRef = useRef<FileSelectionEventDetail | null>(null);
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
          dbName: "critjecture-step-4",
          version: 4,
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

        const flushPendingSelection = async () => {
          if (!agent || !pendingSelectionRef.current || agent.state.isStreaming) {
            return;
          }

          const selection = pendingSelectionRef.current;
          pendingSelectionRef.current = null;
          await agent.prompt(buildFileSelectionPrompt(selection.file));
        };

        const searchCompanyKnowledgeTool = {
          name: "search_company_knowledge",
          label: "Search Company Knowledge",
          description:
            "Search company_data using short keywords, filenames, or years. The tool may auto-select one candidate file or require user selection when multiple files match.",
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
                role,
              }),
              signal,
            });

            const data = (await response.json()) as SearchToolResponse | { error: string };

            if (!response.ok) {
              throw new Error("error" in data ? data.error : "Search request failed.");
            }

            const result = data as SearchToolResponse;

            if (result.selectionRequired && result.candidateFiles.length > 0 && agent) {
              agent.appendMessage(
                createFileSelectionMessage(params.query, result.candidateFiles),
              );
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

        const runDataAnalysisTool = {
          name: "run_data_analysis",
          label: "Run Data Analysis",
          description:
            "Execute short Python snippets in the isolated sandbox. Use this for calculations, Polars analysis, and deterministic computed answers.",
          parameters: Type.Object({
            code: Type.String({
              description:
                "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path>. Use Polars for tabular work and use pl.scan_csv(...).collect() for CSV inputs. Always print the final answer to stdout. For multiple values, print a single JSON object.",
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
          }),
          async execute(
            _toolCallId: string,
            params: { code: string; inputFiles?: string[] },
            signal?: AbortSignal,
          ) {
            const response = await fetch("/api/data-analysis/run", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                code: params.code,
                inputFiles: params.inputFiles ?? [],
                role,
              }),
              signal,
            });

            const data = (await response.json()) as SandboxToolResponse | { error: string };

            if (!response.ok) {
              throw new Error(
                "error" in data ? data.error : "Sandbox execution request failed.",
              );
            }

            const result = data as SandboxToolResponse;

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

        agent = new Agent({
          initialState: {
            systemPrompt: getSystemPrompt(role),
            model: getModel("openai", "gpt-4o-mini"),
            thinkingLevel: "off",
            messages: [],
            tools: [searchCompanyKnowledgeTool, runDataAnalysisTool],
          },
          convertToLlm: (messages) =>
            critjectureConvertToLlm(messages, webUi.defaultConvertToLlm),
          streamFn: (model, context, options) =>
            streamProxy(model, context, {
              ...options,
              authToken: "local-dev",
              proxyUrl: "",
            }),
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
          if (event.type === "agent_end") {
            void flushPendingSelection();
          }
        });
        const handleFileSelection = (event: Event) => {
          if (!(event instanceof CustomEvent) || !agent) {
            return;
          }

          const selection = event.detail as FileSelectionEventDetail;

          agent.replaceMessages(
            markFileSelectionSelected(agent.state.messages as AgentMessage[], selection.selectionId, selection.file),
          );

          if (agent.state.isStreaming) {
            pendingSelectionRef.current = selection;
            return;
          }

          void agent.prompt(buildFileSelectionPrompt(selection.file));
        };

        window.addEventListener(FILE_SELECTION_EVENT, handleFileSelection as EventListener);
        agent.setTools([searchCompanyKnowledgeTool, runDataAnalysisTool]);
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
            : "Failed to load the Step 4 chat shell.";

        if (mounted) {
          setState({ error: message, ready: false });
        }
      }
    }

    bootstrap();

    return () => {
      mounted = false;
      pendingSelectionRef.current = null;
      cleanup?.();
    };
  }, [role]);

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
