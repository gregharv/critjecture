"use client";

import { useEffect, useRef, useState } from "react";

import { registerCritjectureToolRenderers } from "@/lib/tool-renderers";
import { getRoleLabel, type UserRole } from "@/lib/roles";

type ChatShellState = {
  error: string | null;
  ready: boolean;
};

type SearchToolResponse = {
  matches: Array<{
    file: string;
    line: number;
    text: string;
  }>;
  role: UserRole;
  scopeDescription: string;
  summary: string;
};

type SandboxToolResponse = {
  exitCode: number;
  pythonExecutable: string;
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
    "Use the search_company_knowledge tool whenever the user asks about company files, schedules, profits, ledgers, notices, or any internal records.",
    "Use the run_data_analysis tool whenever the user asks for calculations, Python execution, tabular analysis, or anything that should be computed rather than guessed.",
    "When you use run_data_analysis, write complete Python 3.13 code that prints the final answer to stdout.",
    "Never rely on a trailing expression like `mean, median`; use print(...).",
    "If you need to return multiple analytical values, print a single JSON object so the UI can render it clearly.",
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
  const [{ error, ready }, setState] = useState<ChatShellState>({
    error: null,
    ready: false,
  });

  useEffect(() => {
    let mounted = true;
    let cleanup: (() => void) | undefined;

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
          dbName: "critjecture-step-3",
          version: 3,
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

        const searchCompanyKnowledgeTool = {
          name: "search_company_knowledge",
          label: "Search Company Knowledge",
          description:
            "Search the local company_data files for exact keywords or short phrases and return cited matches.",
          parameters: Type.Object({
            query: Type.String({
              description:
                "The exact keyword or short phrase to search for, such as profit, schedule, tenant name, or contractor payout.",
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
                "The Python code to execute inside the sandbox. Use polars for tabular work when relevant. Always print the final answer to stdout. For multiple values, print a single JSON object.",
              minLength: 1,
            }),
          }),
          async execute(_toolCallId: string, params: { code: string }, signal?: AbortSignal) {
            const response = await fetch("/api/data-analysis/run", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                code: params.code,
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

        const agent = new Agent({
          initialState: {
            systemPrompt: getSystemPrompt(role),
            model: getModel("openai", "gpt-4o-mini"),
            thinkingLevel: "off",
            messages: [],
            tools: [searchCompanyKnowledgeTool, runDataAnalysisTool],
          },
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

        agent.setTools([searchCompanyKnowledgeTool, runDataAnalysisTool]);
        hostRef.current.replaceChildren(element);
        cleanup = () => {
          agent.abort();
          element.remove();
        };

        setState({ error: null, ready: true });
      } catch (caughtError) {
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load the Step 2 chat shell.";

        if (mounted) {
          setState({ error: message, ready: false });
        }
      }
    }

    bootstrap();

    return () => {
      mounted = false;
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
