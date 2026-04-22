import type { MessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

export interface AnalyticalClarificationMessage {
  role: "analytical-clarification";
  assistantQuestion: string;
  lead?: string;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "analytical-clarification": AnalyticalClarificationMessage;
  }
}

export function createAnalyticalClarificationMessage(input: {
  assistantQuestion: string;
  lead?: string;
}): AnalyticalClarificationMessage {
  return {
    role: "analytical-clarification",
    assistantQuestion: input.assistantQuestion.trim(),
    lead: input.lead?.trim() || "Before I analyze this, I want to pin down the framing a bit.",
    timestamp: Date.now(),
  };
}

const analyticalClarificationRenderer: MessageRenderer<AnalyticalClarificationMessage> = {
  render(message) {
    return html`
      <div class="mx-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div style="font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; opacity: 0.75; margin-bottom: 0.35rem; text-transform: uppercase;">
          Clarifying the request
        </div>
        <div style="margin-bottom: 0.5rem; opacity: 0.8;">${message.lead}</div>
        <div>${message.assistantQuestion}</div>
      </div>
    `;
  },
};

type MessageRendererRegistry = {
  registerMessageRenderer: (
    role: "analytical-clarification",
    renderer: MessageRenderer<AnalyticalClarificationMessage>,
  ) => void;
};

export function registerAnalyticalClarificationMessageRenderers(
  registry: MessageRendererRegistry,
) {
  registry.registerMessageRenderer("analytical-clarification", analyticalClarificationRenderer);
}
