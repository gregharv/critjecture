import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { html, nothing } from "lit";

import {
  formatPredictiveHorizon,
  normalizePredictivePositiveInteger,
  normalizePredictiveStringArray,
  type PredictiveHandoffPreset,
  type PredictiveHandoffTaskKind,
} from "@/lib/predictive-handoff";

export interface PredictivePlanningMessage {
  role: "predictive-planning";
  candidateDrivers: string[];
  constraints: string[];
  datasetVersionId: string | null;
  featureColumns: string[];
  forecastHorizonUnit: string | null;
  forecastHorizonValue: number | null;
  nextQuestion: string | null;
  objective: string | null;
  planningNote: string | null;
  predictiveWorkspaceHref: string | null;
  preset: PredictiveHandoffPreset | null;
  readyForPredictiveWorkspace: boolean;
  successMetric: string | null;
  targetColumn: string | null;
  taskKind: PredictiveHandoffTaskKind | null;
  timeColumn: string | null;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "predictive-planning": PredictivePlanningMessage;
  }
}

type PredictivePlanningUpdate = {
  candidateDrivers?: string[];
  constraints?: string[];
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  nextQuestion?: string | null;
  objective?: string | null;
  planningNote?: string | null;
  predictiveWorkspaceHref?: string | null;
  preset?: PredictiveHandoffPreset | null;
  readyForPredictiveWorkspace?: boolean;
  successMetric?: string | null;
  targetColumn?: string | null;
  taskKind?: PredictiveHandoffTaskKind | null;
  timeColumn?: string | null;
};

type MessageRendererRegistry = {
  registerMessageRenderer: (
    role: "predictive-planning",
    renderer: MessageRenderer<PredictivePlanningMessage>,
  ) => void;
};

function normalizeString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function formatHorizon(message: PredictivePlanningMessage) {
  return formatPredictiveHorizon(message);
}

const predictivePlanningRenderer: MessageRenderer<PredictivePlanningMessage> = {
  render(message) {
    const candidateDrivers =
      message.candidateDrivers.length > 0 ? message.candidateDrivers : message.featureColumns;
    const horizon = formatHorizon(message);
    const statusLabel = message.readyForPredictiveWorkspace ? "Ready" : "Planning";

    return html`
      <div class="crit-plan">
        <div class="crit-plan__header">
          <div>
            <div class="crit-plan__eyebrow">Predictive Planning</div>
            <div class="crit-plan__title">Business modeling setup</div>
          </div>
          <span class="crit-plan__status crit-plan__status--${message.readyForPredictiveWorkspace ? "ready" : "draft"}">
            ${statusLabel}
          </span>
        </div>

        <div class="crit-plan__grid">
          <section class="crit-plan__section">
            <div class="crit-plan__label">Objective</div>
            <p class="crit-plan__value">${message.objective ?? "Still being defined"}</p>
          </section>

          <section class="crit-plan__section">
            <div class="crit-plan__label">Target</div>
            <p class="crit-plan__value">${message.targetColumn ?? "Still being defined"}</p>
          </section>

          <section class="crit-plan__section">
            <div class="crit-plan__label">Horizon</div>
            <p class="crit-plan__value">${horizon ?? "Still being defined"}</p>
          </section>

          <section class="crit-plan__section">
            <div class="crit-plan__label">Candidate Drivers</div>
            ${candidateDrivers.length > 0
              ? html`<ul class="crit-plan__list">${candidateDrivers.map((value) => html`<li>${value}</li>`)}</ul>`
              : html`<p class="crit-plan__value">Still being defined</p>`}
          </section>

          <section class="crit-plan__section">
            <div class="crit-plan__label">Constraints</div>
            ${message.constraints.length > 0
              ? html`<ul class="crit-plan__list">${message.constraints.map((value) => html`<li>${value}</li>`)}</ul>`
              : html`<p class="crit-plan__value">No explicit constraints captured yet</p>`}
          </section>

          <section class="crit-plan__section">
            <div class="crit-plan__label">Success Metric</div>
            <p class="crit-plan__value">${message.successMetric ?? "Still being defined"}</p>
          </section>

          ${(message.taskKind || message.preset || message.timeColumn || message.datasetVersionId)
            ? html`
                <section class="crit-plan__section crit-plan__section--wide">
                  <div class="crit-plan__label">Workspace Setup</div>
                  <div class="crit-plan__meta">
                    ${message.taskKind ? html`<span><strong>Task:</strong> ${message.taskKind}</span>` : nothing}
                    ${message.preset ? html`<span><strong>Preset:</strong> ${message.preset}</span>` : nothing}
                    ${message.timeColumn ? html`<span><strong>Time column:</strong> ${message.timeColumn}</span>` : nothing}
                    ${message.datasetVersionId
                      ? html`<span><strong>Dataset version:</strong> ${message.datasetVersionId}</span>`
                      : nothing}
                  </div>
                </section>
              `
            : nothing}

          ${message.planningNote
            ? html`
                <section class="crit-plan__section crit-plan__section--wide">
                  <div class="crit-plan__label">Planning Note</div>
                  <p class="crit-plan__value">${message.planningNote}</p>
                </section>
              `
            : nothing}

          <section class="crit-plan__section crit-plan__section--wide">
            <div class="crit-plan__label">Ready for Predictive Workspace</div>
            <p class="crit-plan__value">
              ${message.readyForPredictiveWorkspace
                ? "Yes — the setup is ready to hand off into the predictive workspace."
                : "Not yet — keep refining the setup in chat before running the predictive workspace."}
            </p>
          </section>

          ${message.nextQuestion
            ? html`
                <section class="crit-plan__section crit-plan__section--wide">
                  <div class="crit-plan__label">Next Planning Question</div>
                  <p class="crit-plan__value">${message.nextQuestion}</p>
                </section>
              `
            : nothing}
        </div>

        ${message.predictiveWorkspaceHref
          ? html`
              <div class="crit-plan__actions">
                <a
                  class="crit-tool__download-button"
                  href=${message.predictiveWorkspaceHref}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Predictive Workspace
                </a>
              </div>
            `
          : nothing}
      </div>
    `;
  },
};

export function registerPredictivePlanningMessageRenderers(registry: MessageRendererRegistry) {
  registry.registerMessageRenderer("predictive-planning", predictivePlanningRenderer);
}

export function createPredictivePlanningMessage(
  input: PredictivePlanningUpdate,
): PredictivePlanningMessage {
  return {
    role: "predictive-planning",
    candidateDrivers: normalizePredictiveStringArray(input.candidateDrivers),
    constraints: normalizePredictiveStringArray(input.constraints),
    datasetVersionId: normalizeString(input.datasetVersionId),
    featureColumns: normalizePredictiveStringArray(input.featureColumns),
    forecastHorizonUnit: normalizeString(input.forecastHorizonUnit),
    forecastHorizonValue: normalizePredictivePositiveInteger(input.forecastHorizonValue),
    nextQuestion: normalizeString(input.nextQuestion),
    objective: normalizeString(input.objective),
    planningNote: normalizeString(input.planningNote),
    predictiveWorkspaceHref: normalizeString(input.predictiveWorkspaceHref),
    preset: input.preset ?? null,
    readyForPredictiveWorkspace: Boolean(input.readyForPredictiveWorkspace),
    successMetric: normalizeString(input.successMetric),
    targetColumn: normalizeString(input.targetColumn),
    taskKind: input.taskKind ?? null,
    timeColumn: normalizeString(input.timeColumn),
    timestamp: Date.now(),
  };
}

export function upsertPredictivePlanningMessage(
  messages: AgentMessage[],
  update: PredictivePlanningUpdate,
) {
  let lastIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "predictive-planning") {
      lastIndex = index;
      break;
    }
  }

  const previous = lastIndex >= 0 ? (messages[lastIndex] as PredictivePlanningMessage) : null;
  const nextMessage = createPredictivePlanningMessage({
    candidateDrivers: "candidateDrivers" in update ? update.candidateDrivers : previous?.candidateDrivers,
    constraints: "constraints" in update ? update.constraints : previous?.constraints,
    datasetVersionId:
      "datasetVersionId" in update ? update.datasetVersionId : previous?.datasetVersionId,
    featureColumns: "featureColumns" in update ? update.featureColumns : previous?.featureColumns,
    forecastHorizonUnit:
      "forecastHorizonUnit" in update
        ? update.forecastHorizonUnit
        : previous?.forecastHorizonUnit,
    forecastHorizonValue:
      "forecastHorizonValue" in update
        ? update.forecastHorizonValue
        : previous?.forecastHorizonValue,
    nextQuestion: "nextQuestion" in update ? update.nextQuestion : previous?.nextQuestion,
    objective: "objective" in update ? update.objective : previous?.objective,
    planningNote: "planningNote" in update ? update.planningNote : previous?.planningNote,
    predictiveWorkspaceHref:
      "predictiveWorkspaceHref" in update
        ? update.predictiveWorkspaceHref
        : previous?.predictiveWorkspaceHref,
    preset: "preset" in update ? update.preset : previous?.preset,
    readyForPredictiveWorkspace:
      "readyForPredictiveWorkspace" in update
        ? update.readyForPredictiveWorkspace
        : previous?.readyForPredictiveWorkspace,
    successMetric:
      "successMetric" in update ? update.successMetric : previous?.successMetric,
    targetColumn: "targetColumn" in update ? update.targetColumn : previous?.targetColumn,
    taskKind: "taskKind" in update ? update.taskKind : previous?.taskKind,
    timeColumn: "timeColumn" in update ? update.timeColumn : previous?.timeColumn,
  });

  if (lastIndex < 0) {
    return [...messages, nextMessage as AgentMessage];
  }

  return messages.map((message, index) =>
    index === lastIndex ? (nextMessage as AgentMessage) : message,
  );
}
