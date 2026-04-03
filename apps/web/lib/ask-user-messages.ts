import type { AgentMessage } from "@mariozechner/pi-web-ui";
import type { MessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

export const ASK_USER_EVENT = "critjecture:ask-user-selection";

export type AskUserOption = {
  description?: string;
  title: string;
};

export type AskUserSelectionEventDetail = {
  answer: string;
  selectionId: string;
  wasCustom: boolean;
};

export interface AskUserSelectionMessage {
  role: "ask-user-selection";
  allowFreeform: boolean;
  allowMultiple: boolean;
  answer: string | null;
  confirmed: boolean;
  context?: string;
  options: AskUserOption[];
  question: string;
  selectionId: string;
  timestamp: number;
  wasCustom?: boolean;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "ask-user-selection": AskUserSelectionMessage;
  }
}

function getSelectedOptionTitles(root: HTMLElement | null, allowMultiple: boolean) {
  if (!root) {
    return [];
  }

  if (allowMultiple) {
    return [...root.querySelectorAll<HTMLInputElement>(".crit-ask__option-input")]
      .filter((input) => input.checked)
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  const selected = root.querySelector<HTMLInputElement>(".crit-ask__option-input:checked");

  return selected?.value?.trim() ? [selected.value.trim()] : [];
}

function getCustomAnswer(root: HTMLElement | null) {
  if (!root) {
    return "";
  }

  const textarea = root.querySelector<HTMLTextAreaElement>(".crit-ask__custom-answer");

  return textarea?.value?.trim() ?? "";
}

const askUserRenderer: MessageRenderer<AskUserSelectionMessage> = {
  render(message) {
    const isConfirmed = message.confirmed;

    return html`
      <div class="crit-selection crit-ask" data-selection-id=${message.selectionId}>
        <div class="crit-selection__header">
          <div class="crit-selection__eyebrow">User Decision</div>
          <div class="crit-selection__title">${message.question}</div>
          ${message.context
            ? html`<p class="crit-selection__copy">${message.context}</p>`
            : null}
        </div>

        ${message.options.length > 0
          ? html`
              <div class="crit-selection__list">
                ${message.options.map(
                  (option, index) => html`
                    <label class="crit-selection__card crit-ask__option" for=${`${message.selectionId}-${index}`}>
                      <input
                        class="crit-ask__option-input"
                        id=${`${message.selectionId}-${index}`}
                        name=${`ask-user-${message.selectionId}`}
                        ?disabled=${isConfirmed}
                        type=${message.allowMultiple ? "checkbox" : "radio"}
                        value=${option.title}
                      />
                      <span>
                        <strong>${option.title}</strong>
                        ${option.description
                          ? html`<span class="crit-ask__option-description">${option.description}</span>`
                          : null}
                      </span>
                    </label>
                  `,
                )}
              </div>
            `
          : null}

        ${message.allowFreeform
          ? html`
              <label class="crit-ask__custom-label">
                <span>Custom response</span>
                <textarea
                  class="crit-ask__custom-answer"
                  ?disabled=${isConfirmed}
                  placeholder="Type your response..."
                  rows="4"
                ></textarea>
              </label>
            `
          : null}

        ${isConfirmed && message.answer
          ? html`<p class="crit-selection__copy">
              <strong>Selected:</strong>
              ${message.answer}
              ${message.wasCustom ? html`<em>(custom)</em>` : null}
            </p>`
          : null}

        <div class="crit-selection__actions">
          <button
            class="crit-selection__confirm"
            ?disabled=${isConfirmed}
            type="button"
            @click=${(event: Event) => {
              const root =
                ((event.currentTarget as HTMLElement | null)?.closest(
                  ".crit-ask",
                ) as HTMLElement | null) ?? null;
              const customAnswer = getCustomAnswer(root);

              if (customAnswer) {
                window.dispatchEvent(
                  new CustomEvent<AskUserSelectionEventDetail>(ASK_USER_EVENT, {
                    detail: {
                      answer: customAnswer,
                      selectionId: message.selectionId,
                      wasCustom: true,
                    },
                  }),
                );
                return;
              }

              const selectedOptionTitles = getSelectedOptionTitles(root, message.allowMultiple);

              if (selectedOptionTitles.length === 0) {
                return;
              }

              window.dispatchEvent(
                new CustomEvent<AskUserSelectionEventDetail>(ASK_USER_EVENT, {
                  detail: {
                    answer: message.allowMultiple
                      ? selectedOptionTitles.join(", ")
                      : selectedOptionTitles[0] ?? "",
                    selectionId: message.selectionId,
                    wasCustom: false,
                  },
                }),
              );
            }}
          >
            ${isConfirmed ? "Answered" : "Submit answer"}
          </button>
        </div>
      </div>
    `;
  },
};

type MessageRendererRegistry = {
  registerMessageRenderer: (
    role: "ask-user-selection",
    renderer: MessageRenderer<AskUserSelectionMessage>,
  ) => void;
};

export function registerAskUserMessageRenderers(registry: MessageRendererRegistry) {
  registry.registerMessageRenderer("ask-user-selection", askUserRenderer);
}

export function createAskUserSelectionMessage(input: {
  allowFreeform: boolean;
  allowMultiple: boolean;
  context?: string;
  options: AskUserOption[];
  question: string;
}): AskUserSelectionMessage {
  return {
    role: "ask-user-selection",
    allowFreeform: input.allowFreeform,
    allowMultiple: input.allowMultiple,
    answer: null,
    confirmed: false,
    context: input.context,
    options: input.options,
    question: input.question,
    selectionId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ask-user-selection-${Date.now()}`,
    timestamp: Date.now(),
  };
}

export function markAskUserSelectionSubmitted(
  messages: AgentMessage[],
  selectionId: string,
  answer: string,
  wasCustom: boolean,
) {
  return messages.map((message) => {
    if (message.role !== "ask-user-selection" || message.selectionId !== selectionId) {
      return message;
    }

    return {
      ...message,
      answer,
      confirmed: true,
      wasCustom,
    };
  });
}
