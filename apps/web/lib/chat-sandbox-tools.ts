import type {
  DataAnalysisToolResponse,
  GeneratedAssetToolResponse,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";

type TypeboxLike = any;

type ToolContentPart =
  | {
      text: string;
      type: "text";
    }
  | {
      data: string;
      mimeType: string;
      type: "image";
    };

type SandboxToolFactoryDependencies = {
  Type: TypeboxLike;
  buildDataAnalysisTextAssetContent: (
    result: DataAnalysisToolResponse,
    signal?: AbortSignal,
  ) => Promise<ToolContentPart | null>;
  buildGraphReviewImageContent: (
    result: GeneratedAssetToolResponse,
    signal?: AbortSignal,
  ) => Promise<ToolContentPart | null>;
  createToolRouteError: (value: unknown, fallbackMessage: string) => Error;
  getActiveTurnId: () => string | null;
  hasPendingFileSelection: () => boolean;
};

export function createSandboxTools(deps: SandboxToolFactoryDependencies) {
  const sandboxToolParameters = deps.Type.Object({
    code: deps.Type.String({
      description:
        "The Python code to execute inside the sandbox. Read staged company files from inputs/<company_data-relative-path> for the current organization. inputs/ is read-only; never write or overwrite files there. Use Polars for staged CSV inputs and use pl.scan_csv(...).collect(). Always print the final answer to stdout. Do not rely on print(df) for full tables because Polars display truncates; save full tabular output to outputs/result.csv (or outputs/result.json / outputs/result.txt) and print a short summary. Save at most one structured file and only at outputs/result.csv, outputs/result.json, or outputs/result.txt. If you are preparing reusable chart-ready data instead of saving a PNG, print exactly one JSON object under a chart key, preferably via json.dumps(...). Multi-series charts may use chart.series with items shaped like {name, x, y}.",
      minLength: 1,
    }),
    inputFiles: deps.Type.Optional(
      deps.Type.Array(
        deps.Type.String({
          description:
            "A company_data-relative file path for the current organization discovered via search_company_knowledge, such as admin/quarterly_report_2026.csv.",
          minLength: 1,
        }),
      ),
    ),
  });

  const generateVisualGraphParameters = deps.Type.Object({
    analysisResultId: deps.Type.Optional(
      deps.Type.String({
        description:
          "Optional analysisResultId returned by run_data_analysis for chart-ready data. Use this only when the same already-computed data still answers the current chart request. If the follow-up adds a new year, date range, metric, group, comparison, or file, omit this and gather fresh inputFiles instead.",
        minLength: 1,
      }),
    ),
    chartType: deps.Type.Optional(
      deps.Type.Union([
        deps.Type.Literal("bar"),
        deps.Type.Literal("line"),
        deps.Type.Literal("scatter"),
      ]),
    ),
    code: deps.Type.Optional(
      deps.Type.String({
        description:
          "Python plotting code to execute inside the sandbox. This may read staged company CSV files from inputs/<same-relative-path> or render a manual/synthetic chart. Save exactly one PNG to outputs/chart.png and print a short summary.",
        minLength: 1,
      }),
    ),
    inputFiles: deps.Type.Optional(
      deps.Type.Array(
        deps.Type.String({
          description:
            "Optional company_data-relative paths to stage for plotting code, such as admin/quarterly_report_2026.csv. If code or inputFiles are provided, the server runs fresh plotting against those files instead of reusing stored analysisResultId.",
          minLength: 1,
        }),
      ),
    ),
    title: deps.Type.Optional(deps.Type.String({ minLength: 1 })),
    xLabel: deps.Type.Optional(deps.Type.String({ minLength: 1 })),
    yLabel: deps.Type.Optional(deps.Type.String({ minLength: 1 })),
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
    async execute(runtimeToolCallId: string, params: TParams, signal?: AbortSignal) {
      if (deps.hasPendingFileSelection()) {
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
          turnId: deps.getActiveTurnId(),
        }),
        signal,
      });

      const data = (await response.json()) as TResponse | { error: string };

      if (!response.ok) {
        throw deps.createToolRouteError(data, `${options.label} request failed.`);
      }

      const result = data as TResponse;
      const content: ToolContentPart[] = [
        {
          type: "text",
          text: result.summary,
        },
      ];

      if (options.attachDataAnalysisTextOutput) {
        const textAssetContent = await deps.buildDataAnalysisTextAssetContent(
          result as unknown as DataAnalysisToolResponse,
          signal,
        );

        if (textAssetContent) {
          content.push(textAssetContent);
        }
      }

      if (options.attachGraphImageForReview) {
        const imageContent = await deps.buildGraphReviewImageContent(
          result as unknown as GeneratedAssetToolResponse,
          signal,
        );

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
      "Generate exactly one PNG chart inside outputs/. Use analysisResultId only for same-scope restyling of already-computed chart data. When a follow-up needs new years, files, groups, metrics, or comparisons, pass fresh code and inputFiles instead.",
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

  return {
    generateDocumentTool,
    generateVisualGraphTool,
    runDataAnalysisTool,
  };
}
