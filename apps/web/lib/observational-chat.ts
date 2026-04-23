import type { AgentMessage } from "@mariozechner/pi-web-ui";

import {
  buildObservationalWorkspaceHref,
  clearObservationalChatReturnParams,
  parseObservationalChatReturn,
  summarizeObservationalWorkspaceHandoff,
} from "@/lib/observational-handoff";
import { upsertObservationalPlanningMessage } from "@/lib/observational-planning-messages";
import {
  appendObservationalWorkspaceStatusMessage,
  buildObservationalWorkspaceStatusAssistantSummary,
} from "@/lib/observational-workspace-status-messages";

type TypeboxLike = any;

type ObservationalPlanningToolParams = {
  candidateDrivers?: string[];
  constraints?: string[];
  datasetVersionId?: string;
  featureColumns?: string[];
  forecastHorizonUnit?: string;
  forecastHorizonValue?: number;
  nextQuestion?: string;
  objective?: string;
  planningNote?: string;
  preset?: "forecast" | "standard";
  readyForObservationalWorkspace?: boolean;
  successMetric?: string;
  targetColumn?: string;
  taskKind?: "classification" | "regression";
  timeColumn?: string;
};

type OpenObservationalWorkspaceToolParams = {
  datasetVersionId?: string;
  featureColumns?: string[];
  forecastHorizonUnit?: string;
  forecastHorizonValue?: number;
  openInNewTab?: boolean;
  planningNote?: string;
  preset?: "forecast" | "standard";
  returnToChat?: string;
  targetColumn?: string;
  taskKind?: "classification" | "regression";
  timeColumn?: string;
};

type ObservationalChatToolDependencies = {
  Type: TypeboxLike;
  getConversationReturnToChatHref: () => string;
  getMessages: () => AgentMessage[];
  replaceMessages: (messages: AgentMessage[]) => void;
  scheduleConversationSave: (immediate?: boolean) => void;
};

function normalizeStringArray(values: string[] | undefined) {
  return Array.isArray(values) ? values : [];
}

export function createObservationalChatTools(deps: ObservationalChatToolDependencies) {
  const updateObservationalPlanTool = {
    name: "update_observational_plan",
    label: "Update Observational Plan",
    description:
      "Update the live observational planning panel in chat while the rung-1 business problem is still being framed.",
    parameters: deps.Type.Object({
      objective: deps.Type.Optional(deps.Type.String()),
      targetColumn: deps.Type.Optional(deps.Type.String()),
      candidateDrivers: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      featureColumns: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      constraints: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      successMetric: deps.Type.Optional(deps.Type.String()),
      nextQuestion: deps.Type.Optional(deps.Type.String()),
      readyForObservationalWorkspace: deps.Type.Optional(deps.Type.Boolean()),
      datasetVersionId: deps.Type.Optional(deps.Type.String()),
      taskKind: deps.Type.Optional(
        deps.Type.Union([
          deps.Type.Literal("classification"),
          deps.Type.Literal("regression"),
        ]),
      ),
      preset: deps.Type.Optional(
        deps.Type.Union([deps.Type.Literal("standard"), deps.Type.Literal("forecast")]),
      ),
      timeColumn: deps.Type.Optional(deps.Type.String()),
      forecastHorizonValue: deps.Type.Optional(deps.Type.Integer({ minimum: 1 })),
      forecastHorizonUnit: deps.Type.Optional(deps.Type.String()),
      planningNote: deps.Type.Optional(deps.Type.String()),
    }),
    async execute(_runtimeToolCallId: string, params: ObservationalPlanningToolParams) {
      const observationalWorkspaceHref = buildObservationalWorkspaceHref({
        datasetVersionId: params.datasetVersionId,
        featureColumns: normalizeStringArray(params.featureColumns),
        forecastHorizonUnit: params.forecastHorizonUnit,
        forecastHorizonValue: params.forecastHorizonValue,
        planningNote: params.planningNote,
        preset: params.preset,
        returnToChat: deps.getConversationReturnToChatHref(),
        targetColumn: params.targetColumn,
        taskKind: params.taskKind,
        timeColumn: params.timeColumn,
      });

      deps.replaceMessages(
        upsertObservationalPlanningMessage(deps.getMessages(), {
          candidateDrivers: Array.isArray(params.candidateDrivers)
            ? params.candidateDrivers
            : undefined,
          constraints: Array.isArray(params.constraints) ? params.constraints : undefined,
          datasetVersionId: params.datasetVersionId,
          featureColumns: Array.isArray(params.featureColumns) ? params.featureColumns : undefined,
          forecastHorizonUnit: params.forecastHorizonUnit,
          forecastHorizonValue: params.forecastHorizonValue,
          nextQuestion: params.nextQuestion,
          objective: params.objective,
          observationalWorkspaceHref: params.readyForObservationalWorkspace
            ? observationalWorkspaceHref
            : null,
          planningNote: params.planningNote,
          preset: params.preset,
          readyForObservationalWorkspace: params.readyForObservationalWorkspace,
          successMetric: params.successMetric,
          targetColumn: params.targetColumn,
          taskKind: params.taskKind,
          timeColumn: params.timeColumn,
        }),
      );

      deps.scheduleConversationSave(true);

      const readyForObservationalWorkspace = Boolean(params.readyForObservationalWorkspace);
      const targetColumn = params.targetColumn?.trim() || "still being defined";
      const nextQuestion = params.nextQuestion?.trim() || "None";

      return {
        content: [
          {
            type: "text" as const,
            text: readyForObservationalWorkspace
              ? `Updated observational planning panel. The setup is ready for the observational workspace with target ${targetColumn}.`
              : `Updated observational planning panel. The setup is still being framed in chat. Next question: ${nextQuestion}`,
          },
        ],
        details: {
          candidateDrivers: normalizeStringArray(params.candidateDrivers),
          constraints: normalizeStringArray(params.constraints),
          datasetVersionId: params.datasetVersionId ?? null,
          featureColumns: normalizeStringArray(params.featureColumns),
          forecastHorizonUnit: params.forecastHorizonUnit ?? null,
          forecastHorizonValue: params.forecastHorizonValue ?? null,
          nextQuestion: params.nextQuestion ?? null,
          objective: params.objective ?? null,
          observationalWorkspaceHref: readyForObservationalWorkspace ? observationalWorkspaceHref : null,
          planningNote: params.planningNote ?? null,
          preset: params.preset ?? null,
          readyForObservationalWorkspace,
          successMetric: params.successMetric ?? null,
          targetColumn: params.targetColumn ?? null,
          taskKind: params.taskKind ?? null,
          timeColumn: params.timeColumn ?? null,
        },
      };
    },
  };

  const openObservationalWorkspaceTool = {
    name: "open_observational_workspace",
    label: "Open Observational Workspace",
    description:
      "Open the observational workspace with a prefilled rung-1 modeling setup after chat has clarified the target, horizon, feature candidates, and task framing.",
    parameters: deps.Type.Object({
      datasetVersionId: deps.Type.Optional(deps.Type.String()),
      targetColumn: deps.Type.Optional(deps.Type.String()),
      featureColumns: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      taskKind: deps.Type.Optional(
        deps.Type.Union([
          deps.Type.Literal("classification"),
          deps.Type.Literal("regression"),
        ]),
      ),
      preset: deps.Type.Optional(
        deps.Type.Union([deps.Type.Literal("standard"), deps.Type.Literal("forecast")]),
      ),
      timeColumn: deps.Type.Optional(deps.Type.String()),
      forecastHorizonValue: deps.Type.Optional(deps.Type.Integer({ minimum: 1 })),
      forecastHorizonUnit: deps.Type.Optional(deps.Type.String()),
      planningNote: deps.Type.Optional(deps.Type.String()),
      returnToChat: deps.Type.Optional(deps.Type.String()),
      openInNewTab: deps.Type.Optional(deps.Type.Boolean()),
    }),
    async execute(_runtimeToolCallId: string, params: OpenObservationalWorkspaceToolParams) {
      const returnToChat = params.returnToChat ?? deps.getConversationReturnToChatHref();
      const href = buildObservationalWorkspaceHref({
        datasetVersionId: params.datasetVersionId,
        featureColumns: normalizeStringArray(params.featureColumns),
        forecastHorizonUnit: params.forecastHorizonUnit,
        forecastHorizonValue: params.forecastHorizonValue,
        planningNote: params.planningNote,
        preset: params.preset,
        returnToChat,
        targetColumn: params.targetColumn,
        taskKind: params.taskKind,
        timeColumn: params.timeColumn,
      });

      deps.scheduleConversationSave(true);

      const openInNewTab = params.openInNewTab ?? true;

      if (openInNewTab) {
        window.open(href, "_blank", "noopener,noreferrer");
      } else {
        window.location.assign(href);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: summarizeObservationalWorkspaceHandoff({
              datasetVersionId: params.datasetVersionId,
              featureColumns: normalizeStringArray(params.featureColumns),
              forecastHorizonUnit: params.forecastHorizonUnit,
              forecastHorizonValue: params.forecastHorizonValue,
              openInNewTab,
              planningNote: params.planningNote,
              preset: params.preset,
              targetColumn: params.targetColumn,
              taskKind: params.taskKind,
              timeColumn: params.timeColumn,
            }),
          },
        ],
        details: {
          datasetVersionId: params.datasetVersionId ?? null,
          featureColumns: normalizeStringArray(params.featureColumns),
          forecastHorizonUnit: params.forecastHorizonUnit ?? null,
          forecastHorizonValue: params.forecastHorizonValue ?? null,
          href,
          observationalWorkspaceHref: href,
          openInNewTab,
          planningNote: params.planningNote ?? null,
          preset: params.preset ?? null,
          returnToChat,
          targetColumn: params.targetColumn ?? null,
          taskKind: params.taskKind ?? null,
          timeColumn: params.timeColumn ?? null,
        },
      };
    },
  };

  return {
    openObservationalWorkspaceTool,
    updateObservationalPlanTool,
  };
}

type ApplyObservationalChatReturnDependencies = {
  getCurrentUrl: () => URL;
  getMessages: () => AgentMessage[];
  replaceHistoryUrl: (url: URL) => void;
  replaceMessages: (messages: AgentMessage[]) => void;
  scheduleConversationSave: (immediate?: boolean) => void;
};

export function applyObservationalChatReturnFromUrl(
  deps: ApplyObservationalChatReturnDependencies,
) {
  const url = deps.getCurrentUrl();
  const observationalReturn = parseObservationalChatReturn(url.searchParams);

  if (!observationalReturn) {
    return false;
  }

  const nextMessages = upsertObservationalPlanningMessage(
    appendObservationalWorkspaceStatusMessage(deps.getMessages(), observationalReturn),
    {
      datasetVersionId: observationalReturn.datasetVersionId,
      featureColumns: observationalReturn.featureColumns,
      forecastHorizonUnit: observationalReturn.forecastHorizonUnit,
      forecastHorizonValue: observationalReturn.forecastHorizonValue,
      nextQuestion: null,
      observationalWorkspaceHref: observationalReturn.workspaceHref,
      planningNote: observationalReturn.planningNote,
      preset: observationalReturn.preset,
      readyForObservationalWorkspace: true,
      targetColumn: observationalReturn.targetColumn,
      taskKind: observationalReturn.taskKind,
      timeColumn: observationalReturn.timeColumn,
    },
  );

  deps.replaceMessages([
    ...nextMessages,
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: buildObservationalWorkspaceStatusAssistantSummary(observationalReturn),
        },
      ],
    } as AgentMessage,
  ]);

  clearObservationalChatReturnParams(url);
  deps.replaceHistoryUrl(url);
  deps.scheduleConversationSave(true);
  return true;
}
