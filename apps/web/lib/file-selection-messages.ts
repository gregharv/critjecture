import type { Message } from "@mariozechner/pi-ai";
import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

import type { CompanyKnowledgeCandidateFile } from "@/lib/company-knowledge-types";

export const FILE_SELECTION_EVENT = "critjecture:file-selection";

export type FileSelectionEventDetail = {
  files: string[];
  selectionId: string;
};

export type FileSelectionCandidate = CompanyKnowledgeCandidateFile & {
  matchedQueries: string[];
  recommendedByQueries: string[];
  selectedByQueries: string[];
};

export interface FileSelectionMessage {
  role: "file-selection";
  candidates: FileSelectionCandidate[];
  confirmed: boolean;
  queries: string[];
  selectedFiles: string[];
  selectionId: string;
  timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
  interface CustomAgentMessages {
    "file-selection": FileSelectionMessage;
  }
}

function renderPreview(candidate: FileSelectionCandidate) {
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

function getConfirmedSelectionFiles(root: HTMLElement | null) {
  if (!root) {
    return [];
  }

  return [...root.querySelectorAll<HTMLInputElement>(".crit-selection__checkbox")]
    .filter((input) => input.checked)
    .map((input) => input.value.trim())
    .filter(Boolean);
}

const fileSelectionRenderer: MessageRenderer<FileSelectionMessage> = {
  render(message) {
    const confirmedSelection = message.confirmed;

    return html`
      <div class="crit-selection" data-selection-id=${message.selectionId}>
        <div class="crit-selection__header">
          <div class="crit-selection__eyebrow">File Planner</div>
          <div class="crit-selection__title">Review Files For Analysis</div>
          <p class="crit-selection__copy">
            The assistant found overlapping candidate files while gathering evidence.
            Confirm one or more files before analysis continues.
          </p>
          <div class="crit-selection__query-list">
            ${message.queries.map(
              (query) => html`<span class="crit-selection__query-chip">${query}</span>`,
            )}
          </div>
        </div>

        <div class="crit-selection__actions">
          <button
            class="crit-selection__confirm"
            ?disabled=${confirmedSelection}
            type="button"
            @click=${(event: Event) => {
              const root =
                ((event.currentTarget as HTMLElement | null)?.closest(
                  ".crit-selection",
                ) as HTMLElement | null) ?? null;
              const files = getConfirmedSelectionFiles(root);

              if (files.length === 0) {
                return;
              }

              if (root) {
                root
                  .querySelectorAll<HTMLInputElement>(
                    ".crit-selection__checkbox, .crit-selection__confirm",
                  )
                  .forEach((element) => {
                    element.disabled = true;
                  });
              }

              window.dispatchEvent(
                new CustomEvent<FileSelectionEventDetail>(FILE_SELECTION_EVENT, {
                  detail: {
                    files,
                    selectionId: message.selectionId,
                  },
                }),
              );
            }}
          >
            ${confirmedSelection ? "Files Confirmed" : "Use Selected Files"}
          </button>
        </div>

        <div class="crit-selection__list">
          ${message.candidates.map((candidate) => {
            const isSelected = message.selectedFiles.includes(candidate.file);

            return html`
              <section class="crit-selection__card">
                <label class="crit-selection__card-header">
                  <div class="crit-selection__toggle">
                    <input
                      class="crit-selection__checkbox"
                      ?checked=${isSelected}
                      ?disabled=${confirmedSelection}
                      type="checkbox"
                      value=${candidate.file}
                    />
                  </div>

                  <div class="crit-selection__card-copy">
                    <div class="crit-selection__path">${candidate.file}</div>
                    <div class="crit-selection__terms">
                      Matched terms: ${candidate.matchedTerms.join(", ") || "preview only"}
                    </div>
                    <div class="crit-selection__meta-row">
                      ${candidate.matchedQueries.map(
                        (query) =>
                          html`<span class="crit-selection__meta-chip">${query}</span>`,
                      )}
                    </div>
                    ${
                      candidate.selectedByQueries.length > 0 ||
                      candidate.recommendedByQueries.length > 0
                        ? html`
                            <div class="crit-selection__meta-row">
                              ${candidate.selectedByQueries.map(
                                (query) =>
                                  html`
                                    <span
                                      class="crit-selection__meta-chip crit-selection__meta-chip--selected"
                                    >
                                      Auto-selected by ${query}
                                    </span>
                                  `,
                              )}
                              ${candidate.recommendedByQueries.map(
                                (query) =>
                                  html`
                                    <span
                                      class="crit-selection__meta-chip crit-selection__meta-chip--recommended"
                                    >
                                      Recommended by ${query}
                                    </span>
                                  `,
                              )}
                            </div>
                          `
                        : null
                    }
                  </div>
                </label>

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
  input: Pick<FileSelectionMessage, "candidates" | "queries" | "selectedFiles">,
): FileSelectionMessage {
  return {
    role: "file-selection",
    candidates: input.candidates,
    confirmed: false,
    queries: input.queries,
    selectedFiles: input.selectedFiles,
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
  selectedFiles: string[],
) {
  return messages.map((message) => {
    if (message.role !== "file-selection" || message.selectionId !== selectionId) {
      return message;
    }

    return {
      ...message,
      confirmed: true,
      selectedFiles,
    };
  });
}

export function buildFileSelectionPrompt(files: string[]) {
  const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];

  return `Use these company files for the pending request: ${uniqueFiles.join(", ")}. If a Python sandbox tool is needed next, pass the exact same paths in inputFiles.`;
}

export function critjectureConvertToLlm(
  messages: AgentMessage[],
  defaultConvertToLlm: (messages: AgentMessage[]) => Message[],
): Message[] {
  return defaultConvertToLlm(
    messages.filter((message) => message.role !== "file-selection"),
  );
}
