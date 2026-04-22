import type { AgentMessage } from "@mariozechner/pi-web-ui";

import {
  buildPredictiveWorkspaceHref,
  clearPredictiveChatReturnParams,
  parsePredictiveChatReturn,
  summarizePredictiveWorkspaceHandoff,
} from "@/lib/predictive-handoff";
import { upsertPredictivePlanningMessage } from "@/lib/predictive-planning-messages";
import {
  appendPredictiveWorkspaceStatusMessage,
  buildPredictiveWorkspaceStatusAssistantSummary,
} from "@/lib/predictive-workspace-status-messages";

type TypeboxLike = any;

type PredictivePlanningToolParams = {
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
  readyForPredictiveWorkspace?: boolean;
  successMetric?: string;
  targetColumn?: string;
  taskKind?: "classification" | "regression";
  timeColumn?: string;
};

type OpenPredictiveWorkspaceToolParams = {
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

type PredictiveChatToolDependencies = {
  Type: TypeboxLike;
  getConversationReturnToChatHref: () => string;
  getMessages: () => AgentMessage[];
  replaceMessages: (messages: AgentMessage[]) => void;
  scheduleConversationSave: (immediate?: boolean) => void;
};

function normalizeStringArray(values: string[] | undefined) {
  return Array.isArray(values) ? values : [];
}

export function createPredictiveChatTools(deps: PredictiveChatToolDependencies) {
  const updatePredictivePlanTool = {
    name: "update_predictive_plan",
    label: "Update Predictive Plan",
    description:
      "Update the live predictive planning panel in chat while the business problem is still being framed.",
    parameters: deps.Type.Object({
      objective: deps.Type.Optional(deps.Type.String()),
      targetColumn: deps.Type.Optional(deps.Type.String()),
      candidateDrivers: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      featureColumns: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      constraints: deps.Type.Optional(deps.Type.Array(deps.Type.String())),
      successMetric: deps.Type.Optional(deps.Type.String()),
      nextQuestion: deps.Type.Optional(deps.Type.String()),
      readyForPredictiveWorkspace: deps.Type.Optional(deps.Type.Boolean()),
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
    async execute(_runtimeToolCallId: string, params: PredictivePlanningToolParams) {
      const predictiveWorkspaceHref = buildPredictiveWorkspaceHref({
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
        upsertPredictivePlanningMessage(deps.getMessages(), {
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
          planningNote: params.planningNote,
          predictiveWorkspaceHref: params.readyForPredictiveWorkspace
            ? predictiveWorkspaceHref
            : null,
          preset: params.preset,
          readyForPredictiveWorkspace: params.readyForPredictiveWorkspace,
          successMetric: params.successMetric,
          targetColumn: params.targetColumn,
          taskKind: params.taskKind,
          timeColumn: params.timeColumn,
        }),
      );

      deps.scheduleConversationSave(true);

      const readyForPredictiveWorkspace = Boolean(params.readyForPredictiveWorkspace);
      const targetColumn = params.targetColumn?.trim() || "still being defined";
      const nextQuestion = params.nextQuestion?.trim() || "None";

      return {
        content: [
          {
            type: "text" as const,
            text: readyForPredictiveWorkspace
              ? `Updated predictive planning panel. The setup is ready for the predictive workspace with target ${targetColumn}.`
              : `Updated predictive planning panel. The setup is still being framed in chat. Next question: ${nextQuestion}`,
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
          planningNote: params.planningNote ?? null,
          predictiveWorkspaceHref: readyForPredictiveWorkspace ? predictiveWorkspaceHref : null,
          preset: params.preset ?? null,
          readyForPredictiveWorkspace,
          successMetric: params.successMetric ?? null,
          targetColumn: params.targetColumn ?? null,
          taskKind: params.taskKind ?? null,
          timeColumn: params.timeColumn ?? null,
        },
      };
    },
  };

  const openPredictiveWorkspaceTool = {
    name: "open_predictive_workspace",
    label: "Open Predictive Workspace",
    description:
      "Open the predictive workspace with a prefilled modeling setup after chat has clarified the target, horizon, feature candidates, and task framing.",
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
    async execute(_runtimeToolCallId: string, params: OpenPredictiveWorkspaceToolParams) {
      const returnToChat = params.returnToChat ?? deps.getConversationReturnToChatHref();
      const href = buildPredictiveWorkspaceHref({
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
            text: summarizePredictiveWorkspaceHandoff({
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
    openPredictiveWorkspaceTool,
    updatePredictivePlanTool,
  };
}

type ApplyPredictiveChatReturnDependencies = {
  getCurrentUrl: () => URL;
  getMessages: () => AgentMessage[];
  replaceHistoryUrl: (url: URL) => void;
  replaceMessages: (messages: AgentMessage[]) => void;
  scheduleConversationSave: (immediate?: boolean) => void;
};

export function applyPredictiveChatReturnFromUrl(
  deps: ApplyPredictiveChatReturnDependencies,
) {
  const url = deps.getCurrentUrl();
  const predictiveReturn = parsePredictiveChatReturn(url.searchParams);

  if (!predictiveReturn) {
    return false;
  }

  const nextMessages = upsertPredictivePlanningMessage(
    appendPredictiveWorkspaceStatusMessage(deps.getMessages(), predictiveReturn),
    {
      datasetVersionId: predictiveReturn.datasetVersionId,
      featureColumns: predictiveReturn.featureColumns,
      forecastHorizonUnit: predictiveReturn.forecastHorizonUnit,
      forecastHorizonValue: predictiveReturn.forecastHorizonValue,
      nextQuestion: null,
      planningNote: predictiveReturn.planningNote,
      predictiveWorkspaceHref: predictiveReturn.workspaceHref,
      preset: predictiveReturn.preset,
      readyForPredictiveWorkspace: true,
      targetColumn: predictiveReturn.targetColumn,
      taskKind: predictiveReturn.taskKind,
      timeColumn: predictiveReturn.timeColumn,
    },
  );

  deps.replaceMessages([
    ...nextMessages,
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: buildPredictiveWorkspaceStatusAssistantSummary(predictiveReturn),
        },
      ],
    } as AgentMessage,
  ]);

  clearPredictiveChatReturnParams(url);
  deps.replaceHistoryUrl(url);
  deps.scheduleConversationSave(true);
  return true;
}
