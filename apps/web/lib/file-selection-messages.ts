import type { Message } from "@mariozechner/pi-ai";
import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

import type { CompanyKnowledgeCandidateFile } from "@/lib/company-knowledge-types";

export const FILE_SELECTION_EVENT = "critjecture:file-selection";

export type FileSelectionEventDetail = {
  file: string;
  query: string;
  selectionId: string;
};

export interface FileSelectionMessage {
  role: "file-selection";
  candidates: CompanyKnowledgeCandidateFile[];
  query: string;
  selectedFile?: string;
  selectionId: string;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "file-selection": FileSelectionMessage;
  }
}

function renderPreview(candidate: CompanyKnowledgeCandidateFile) {
  if (candidate.preview.kind === "csv") {
    return html`
      <div class="crit-selection__table-wrap">
        <table class="crit-selection__table">
          <thead>
            <tr>
              ${candidate.preview.columns.map(
                (column) => html`<th>${column}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${candidate.preview.rows.map(
              (row) => html`
                <tr>
                  ${row.map((cell) => html`<td>${cell}</td>`)}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  return html`
    <div class="crit-selection__snippet">
      ${candidate.preview.lines.map((line) => html`<div>${line}</div>`)}
    </div>
  `;
}

const fileSelectionRenderer: MessageRenderer<FileSelectionMessage> = {
  render(message) {
    const hasSelection = Boolean(message.selectedFile);

    return html`
      <div class="crit-selection">
        <div class="crit-selection__header">
          <div class="crit-selection__eyebrow">File Selection</div>
          <div class="crit-selection__title">Choose A File For Analysis</div>
          <p class="crit-selection__copy">
            Multiple company files matched <code>${message.query}</code>. Pick the
            file to use before analysis continues.
          </p>
        </div>

        <div class="crit-selection__list">
          ${message.candidates.map((candidate) => {
            const isSelected = message.selectedFile === candidate.file;

            return html`
              <section class="crit-selection__card">
                <div class="crit-selection__card-header">
                  <div>
                    <div class="crit-selection__path">${candidate.file}</div>
                    <div class="crit-selection__terms">
                      Matched: ${candidate.matchedTerms.join(", ") || "preview only"}
                    </div>
                  </div>
                  <button
                    class="crit-selection__button"
                    ?disabled=${hasSelection}
                    type="button"
                    @click=${(event: Event) => {
                      const card = (event.currentTarget as HTMLElement | null)?.closest(
                        ".crit-selection",
                      );

                      if (card) {
                        card
                          .querySelectorAll<HTMLButtonElement>(".crit-selection__button")
                          .forEach((button) => {
                            button.disabled = true;
                          });
                      }

                      window.dispatchEvent(
                        new CustomEvent<FileSelectionEventDetail>(FILE_SELECTION_EVENT, {
                          detail: {
                            file: candidate.file,
                            query: message.query,
                            selectionId: message.selectionId,
                          },
                        }),
                      );
                    }}
                  >
                    ${isSelected ? "Selected" : "Use This File"}
                  </button>
                </div>

                ${renderPreview(candidate)}
              </section>
            `;
          })}
        </div>
      </div>
    `;
  },
};

type MessageRendererRegistry = {
  registerMessageRenderer: (
    role: "file-selection",
    renderer: MessageRenderer<FileSelectionMessage>,
  ) => void;
};

export function registerCritjectureMessageRenderers(registry: MessageRendererRegistry) {
  registry.registerMessageRenderer("file-selection", fileSelectionRenderer);
}

export function createFileSelectionMessage(
  query: string,
  candidates: CompanyKnowledgeCandidateFile[],
): FileSelectionMessage {
  return {
    role: "file-selection",
    candidates,
    query,
    selectionId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `selection-${Date.now()}`,
    timestamp: Date.now(),
  };
}

export function markFileSelectionSelected(
  messages: AgentMessage[],
  selectionId: string,
  selectedFile: string,
) {
  return messages.map((message) => {
    if (message.role !== "file-selection" || message.selectionId !== selectionId) {
      return message;
    }

    return {
      ...message,
      selectedFile,
    };
  });
}

export function buildFileSelectionPrompt(file: string) {
  return `Use company file ${file} for the pending request. If analysis is needed, use that exact path in run_data_analysis inputFiles.`;
}

export function critjectureConvertToLlm(
  messages: AgentMessage[],
  defaultConvertToLlm: (messages: AgentMessage[]) => Message[],
): Message[] {
  return defaultConvertToLlm(
    messages.filter((message) => message.role !== "file-selection"),
  );
}
