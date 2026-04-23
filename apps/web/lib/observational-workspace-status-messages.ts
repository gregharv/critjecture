import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { html, nothing } from "lit";

import {
  formatObservationalHorizon,
  parseObservationalMetricHighlights,
  type ObservationalChatReturn,
  type ObservationalChatReturnStatus,
} from "@/lib/observational-handoff";

export interface ObservationalWorkspaceStatusMessage extends ObservationalChatReturn {
  role: "observational-workspace-status";
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "observational-workspace-status": ObservationalWorkspaceStatusMessage;
  }
}

type MessageRendererRegistry = {
  registerMessageRenderer: (
    role: "observational-workspace-status",
    renderer: MessageRenderer<ObservationalWorkspaceStatusMessage>,
  ) => void;
};

function getStatusLabel(status: ObservationalChatReturnStatus) {
  return status === "run_completed" ? "Run completed" : "Workspace ready";
}

function formatHorizon(message: Pick<ObservationalChatReturn, "forecastHorizonUnit" | "forecastHorizonValue">) {
  return formatObservationalHorizon(message);
}

function getStatusCopy(message: ObservationalWorkspaceStatusMessage) {
  if (message.status === "run_completed") {
    if (message.claimLabel && message.targetColumn) {
      return `The observational run for ${message.targetColumn} completed with claim label ${message.claimLabel}.`;
    }

    return "An observational run completed and the result is available for follow-up discussion in chat.";
  }

  if (message.targetColumn) {
    return `The observational setup for ${message.targetColumn} is ready to execute in the observational workspace.`;
  }

  return "The observational setup is ready to execute in the observational workspace.";
}

export function buildObservationalWorkspaceNextStepRecommendation(input: ObservationalChatReturn) {
  if (input.status !== "run_completed") {
    return "Run the observational analysis if the setup is ready, or keep refining the target, horizon, drivers, and success metric in chat if the setup still feels underspecified.";
  }

  const metrics = parseObservationalMetricHighlights(input.metricHighlights);

  if (input.taskKind === "classification") {
    const signal = metrics.roc_auc ?? metrics.accuracy ?? metrics.f1 ?? null;

    if (signal !== null && signal >= 0.8) {
      return "The model shows useful ranking signal. Next best step: decide the business threshold for action, validate on an additional holdout slice, and use it for prioritization rather than as proof of causality.";
    }

    if (signal !== null && signal >= 0.65) {
      return "The model shows some directional signal, but it is not yet strong enough for confident automation. Next best step: refine the target definition, add better drivers, and test whether the decision threshold is acceptable for the business.";
    }

    if (signal !== null) {
      return "The predictive signal looks weak. Next best step: revisit the target, horizon, feature set, and data quality before relying on this result operationally.";
    }
  }

  if (input.taskKind === "regression") {
    const mape = metrics.mape ?? null;
    const r2 = metrics.r2 ?? null;

    if ((mape !== null && mape <= 0.15) || (r2 !== null && r2 >= 0.6)) {
      return "The forecast quality looks useful for planning. Next best step: validate on another recent period, define action thresholds, and use the forecast as an operational aid rather than a causal claim.";
    }

    if ((mape !== null && mape <= 0.3) || (r2 !== null && r2 >= 0.3)) {
      return "The forecast has some useful signal, but it still needs refinement. Next best step: tighten the horizon, improve the feature set, and confirm whether this error level is acceptable for the business decision.";
    }

    if (mape !== null || r2 !== null) {
      return "The forecast quality looks weak for operational use. Next best step: revisit the target, horizon, and candidate drivers before depending on this output.";
    }
  }

  return "Next best step: interpret the result in business terms, then decide whether to refine the observational setup or to move into the analysis study workspace only if the real question is about the effect of an intervention.";
}

export function buildObservationalWorkspaceStatusAssistantSummary(input: ObservationalChatReturn) {
  const horizon = formatHorizon(input);
  const leadLabel = input.status === "run_completed" ? input.claimLabel ?? "DESCRIPTIVE" : "DESCRIPTIVE";
  const lines = [leadLabel];

  if (input.status === "run_completed") {
    const opening = input.targetColumn
      ? `Your observational run for ${input.targetColumn} has completed.`
      : "Your observational run has completed.";
    lines.push(opening);

    if (input.summary) {
      lines.push(input.summary);
    }

    if (input.metricHighlights.length > 0) {
      lines.push(`Metric highlights: ${input.metricHighlights.join("; ")}.`);
    }

    lines.push(
      "Use this as an instrumental forecasting or prioritization aid, not as a causal conclusion about what would happen under an intervention.",
    );
    lines.push(buildObservationalWorkspaceNextStepRecommendation(input));
    lines.push(
      "If your next question becomes what would happen if you changed a policy, treatment, price, or intervention, that follow-up belongs in the analysis study workspace.",
    );

    return lines.join("\n\n");
  }

  const setupParts = [
    input.targetColumn ? `target ${input.targetColumn}` : null,
    input.taskKind ? `task ${input.taskKind}` : null,
    horizon ? `horizon ${horizon}` : null,
  ].filter((value): value is string => Boolean(value));

  if (setupParts.length > 0) {
    lines.push(`Your observational setup is ready in the workspace with ${setupParts.join(", ")}.`);
  } else {
    lines.push("Your observational setup is ready in the workspace.");
  }

  if (input.featureColumns.length > 0) {
    lines.push(`Current feature candidates: ${input.featureColumns.join(", ")}.`);
  }

  lines.push(buildObservationalWorkspaceNextStepRecommendation(input));

  return lines.join("\n\n");
}

export function renderObservationalWorkspaceStatusPanel(
  message: ObservationalWorkspaceStatusMessage,
) {
  const runHref = message.runId ? `/analysis/observational/runs/${message.runId}` : null;
  const horizon = formatHorizon(message);
  const nextStepRecommendation = buildObservationalWorkspaceNextStepRecommendation(message);

  return html`
    <div class="crit-sync">
      <div class="crit-sync__header">
        <div>
          <div class="crit-sync__eyebrow">Observational workspace sync</div>
          <div class="crit-sync__title">${getStatusLabel(message.status)}</div>
        </div>
        <span class="crit-sync__status crit-sync__status--${message.status === "run_completed" ? "complete" : "ready"}">
          ${getStatusLabel(message.status)}
        </span>
      </div>

      <p class="crit-sync__copy">${getStatusCopy(message)}</p>

      ${message.targetColumn || message.taskKind || message.preset || horizon || message.timeColumn
        ? html`
            <div class="crit-sync__meta">
              ${message.targetColumn ? html`<span><strong>Target:</strong> ${message.targetColumn}</span>` : nothing}
              ${message.taskKind ? html`<span><strong>Task:</strong> ${message.taskKind}</span>` : nothing}
              ${message.preset ? html`<span><strong>Preset:</strong> ${message.preset}</span>` : nothing}
              ${horizon ? html`<span><strong>Horizon:</strong> ${horizon}</span>` : nothing}
              ${message.timeColumn ? html`<span><strong>Time column:</strong> ${message.timeColumn}</span>` : nothing}
            </div>
          `
        : nothing}

      ${message.featureColumns.length > 0
        ? html`
            <section class="crit-sync__section">
              <div class="crit-sync__label">Feature candidates</div>
              <p class="crit-sync__copy crit-sync__copy--tight">${message.featureColumns.join(", ")}</p>
            </section>
          `
        : nothing}

      ${message.metricHighlights.length > 0
        ? html`
            <section class="crit-sync__section">
              <div class="crit-sync__label">Metric highlights</div>
              <ul class="crit-sync__list">
                ${message.metricHighlights.map((metric) => html`<li>${metric}</li>`)}
              </ul>
            </section>
          `
        : nothing}

      ${message.summary
        ? html`
            <section class="crit-sync__section">
              <div class="crit-sync__label">Summary</div>
              <p class="crit-sync__copy crit-sync__copy--tight">${message.summary}</p>
            </section>
          `
        : nothing}

      ${message.planningNote
        ? html`
            <section class="crit-sync__section">
              <div class="crit-sync__label">Planning note</div>
              <p class="crit-sync__copy crit-sync__copy--tight">${message.planningNote}</p>
            </section>
          `
        : nothing}

      <section class="crit-sync__section">
        <div class="crit-sync__label">Recommended next step</div>
        <p class="crit-sync__copy crit-sync__copy--tight">${nextStepRecommendation}</p>
      </section>

      ${message.workspaceHref || runHref
        ? html`
            <div class="crit-sync__actions">
              ${message.workspaceHref
                ? html`
                    <a
                      class="crit-tool__download-button"
                      href=${message.workspaceHref}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open Observational Workspace
                    </a>
                  `
                : nothing}
              ${runHref
                ? html`
                    <a class="crit-tool__asset-link" href=${runHref}>
                      Open Observational Run
                    </a>
                  `
                : nothing}
            </div>
          `
        : nothing}
    </div>
  `;
}

const observationalWorkspaceStatusRenderer: MessageRenderer<ObservationalWorkspaceStatusMessage> = {
  render(message) {
    return renderObservationalWorkspaceStatusPanel(message);
  },
};

export function registerObservationalWorkspaceStatusMessageRenderers(
  registry: MessageRendererRegistry,
) {
  registry.registerMessageRenderer(
    "observational-workspace-status",
    observationalWorkspaceStatusRenderer,
  );
}

export function createObservationalWorkspaceStatusMessage(
  input: ObservationalChatReturn,
): ObservationalWorkspaceStatusMessage {
  return {
    ...input,
    role: "observational-workspace-status",
    timestamp: Date.now(),
  };
}

export function appendObservationalWorkspaceStatusMessage(
  messages: AgentMessage[],
  input: ObservationalChatReturn,
) {
  return [...messages, createObservationalWorkspaceStatusMessage(input) as AgentMessage];
}
