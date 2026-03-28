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
    "The search tool may return an auto-selected file or require user selection. If selection is required, do not call any Python sandbox tool yet. Wait for the user to choose a file first.",
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
          dbName: "critjecture-step-5",
          version: 5,
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
            const response = await fetch(options.route, {
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
