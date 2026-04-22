import type {
  CompanyKnowledgeCandidateFile,
  CompanyKnowledgeMatch,
} from "@/lib/company-knowledge-types";
import type { AskUserOption } from "@/lib/ask-user-messages";
import {
  createAskUserSelectionMessage,
} from "@/lib/ask-user-messages";
import type { UserRole } from "@/lib/roles";

type TypeboxLike = any;

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

type CreateInformationToolDependencies = {
  Type: TypeboxLike;
  getErrorMessage: (value: unknown, fallbackMessage: string) => string;
  pushPlannerSearch: (search: {
    candidateFiles: CompanyKnowledgeCandidateFile[];
    query: string;
    recommendedFiles: string[];
    selectedFiles: string[];
    selectionRequired: boolean;
  }) => void;
  requestAskUserInput: (
    prompt: {
      allowFreeform: boolean;
      allowMultiple: boolean;
      context?: string;
      options: AskUserOption[];
      question: string;
      timeout?: number;
    },
    signal?: AbortSignal,
  ) => Promise<{ answer: string | null; wasCustom: boolean }>;
};

export function createInformationAndDecisionTools(
  deps: CreateInformationToolDependencies,
) {
  const searchCompanyKnowledgeTool = {
    name: "search_company_knowledge",
    label: "Search Company Knowledge",
    description:
      "Search the current organization's company_data using short keywords, filenames, or years. The tool may auto-select files or trigger a planner-level multi-select picker when multiple files are relevant.",
    parameters: deps.Type.Object({
      query: deps.Type.String({
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
        deps.pushPlannerSearch({
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
    parameters: deps.Type.Object({
      query: deps.Type.String({
        description: "Search query.",
        minLength: 1,
      }),
      count: deps.Type.Optional(
        deps.Type.Integer({
          description: "Number of results (1-20).",
          maximum: 20,
          minimum: 1,
        }),
      ),
      country: deps.Type.Optional(
        deps.Type.String({
          description: "Country code, for example US.",
          minLength: 2,
        }),
      ),
      freshness: deps.Type.Optional(
        deps.Type.Union([
          deps.Type.Literal("pd"),
          deps.Type.Literal("pw"),
          deps.Type.Literal("pm"),
          deps.Type.Literal("py"),
        ]),
      ),
      fetchContent: deps.Type.Optional(deps.Type.Boolean()),
      format: deps.Type.Optional(
        deps.Type.Union([
          deps.Type.Literal("one_line"),
          deps.Type.Literal("short"),
          deps.Type.Literal("raw_json"),
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
        throw new Error(deps.getErrorMessage(data, "Brave search failed."));
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
    parameters: deps.Type.Object({
      question: deps.Type.String({
        description: "Question to answer.",
        minLength: 1,
      }),
      enableResearch: deps.Type.Optional(deps.Type.Boolean()),
      enableCitations: deps.Type.Optional(deps.Type.Boolean()),
      enableEntities: deps.Type.Optional(deps.Type.Boolean()),
      maxAnswerChars: deps.Type.Optional(
        deps.Type.Integer({
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
        throw new Error(deps.getErrorMessage(data, "Brave grounding failed."));
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
    parameters: deps.Type.Object({
      question: deps.Type.String({
        description: "The question to ask the user.",
        minLength: 1,
      }),
      context: deps.Type.Optional(
        deps.Type.String({
          description: "Relevant context summary to show before the question.",
        }),
      ),
      options: deps.Type.Optional(
        deps.Type.Array(
          deps.Type.Union([
            deps.Type.String(),
            deps.Type.Object({
              title: deps.Type.String(),
              description: deps.Type.Optional(deps.Type.String()),
            }),
          ]),
        ),
      ),
      allowMultiple: deps.Type.Optional(deps.Type.Boolean()),
      allowFreeform: deps.Type.Optional(deps.Type.Boolean()),
      timeout: deps.Type.Optional(deps.Type.Number()),
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

      const selection = await deps.requestAskUserInput(
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

  return {
    askUserTool,
    braveGroundingTool,
    braveSearchTool,
    searchCompanyKnowledgeTool,
  };
}
