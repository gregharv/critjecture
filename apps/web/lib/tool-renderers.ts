import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { html, nothing } from "lit";

type SandboxToolResponse = {
  exitCode: number;
  pythonExecutable: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
  stderr: string;
  stdout: string;
  workspaceDir: string;
};

type ToolRendererRegistry = {
  registerToolRenderer: (
    toolName: string,
    renderer: {
      render: (
        params: unknown,
        result?: ToolResultMessage<SandboxToolResponse>,
        isStreaming?: boolean,
      ) => { content: ReturnType<typeof html>; isCustom: boolean };
    },
  ) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseToolParams(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { code: value };
    }
  }

  return value;
}

function formatBlockContent(value: string | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return {
      code: "",
      empty: true,
      language: "text",
    };
  }

  try {
    const parsed = JSON.parse(trimmed);

    return {
      code: JSON.stringify(parsed, null, 2),
      empty: false,
      language: "json",
    };
  } catch {
    return {
      code: trimmed,
      empty: false,
      language: "text",
    };
  }
}

function getCodeParam(params: unknown) {
  const parsed = parseToolParams(params);

  if (!isRecord(parsed) || typeof parsed.code !== "string") {
    return "";
  }

  return parsed.code.trim();
}

export function registerCritjectureToolRenderers(registry: ToolRendererRegistry) {
  registry.registerToolRenderer("run_data_analysis", {
    render(params, result, isStreaming) {
      const code = getCodeParam(params);
      const details = isRecord(result?.details)
        ? (result.details as SandboxToolResponse)
        : undefined;
      const stdout = formatBlockContent(details?.stdout);
      const stderr = formatBlockContent(details?.stderr);
      const state = result
        ? result.isError
          ? "error"
          : "complete"
        : isStreaming
          ? "running"
          : "pending";
      const summary =
        result?.content
          ?.filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("\n")
          .trim() ?? "";

      return {
        content: html`
          <div class="crit-tool crit-tool--python">
            <div class="crit-tool__header">
              <div class="crit-tool__heading">
                <span class="crit-tool__eyebrow">Python Sandbox</span>
                <div class="crit-tool__title">Run Data Analysis</div>
              </div>
              <span class="crit-tool__status crit-tool__status--${state}">
                ${state === "complete"
                  ? "Complete"
                  : state === "error"
                    ? "Error"
                    : state === "running"
                      ? "Running"
                      : "Queued"}
              </span>
            </div>

            ${
              code
                ? html`
                    <section class="crit-tool__section">
                      <div class="crit-tool__label">Python Code</div>
                      <code-block .code=${code} language="python"></code-block>
                    </section>
                  `
                : nothing
            }

            ${
              result
                ? html`
                    ${
                      details?.stagedFiles?.length
                        ? html`
                            <section class="crit-tool__section">
                              <div class="crit-tool__label">Staged Input Files</div>
                              <div class="crit-tool__files">
                                ${details.stagedFiles.map(
                                  (file) => html`
                                    <div class="crit-tool__file">
                                      <div class="crit-tool__file-source">${file.sourcePath}</div>
                                      <div class="crit-tool__file-stage">${file.stagedPath}</div>
                                    </div>
                                  `,
                                )}
                              </div>
                            </section>
                          `
                        : nothing
                    }

                    <div class="crit-tool__split">
                      <section class="crit-tool__section">
                        <div class="crit-tool__label">stdout</div>
                        ${
                          stdout.empty
                            ? html`<div class="crit-tool__empty">
                                No stdout captured. The Python code should use
                                <code>print(...)</code> for the final answer.
                              </div>`
                            : html`<code-block
                                .code=${stdout.code}
                                language=${stdout.language}
                              ></code-block>`
                        }
                      </section>

                      ${
                        !stderr.empty || result.isError
                          ? html`
                              <section class="crit-tool__section">
                                <div class="crit-tool__label">stderr</div>
                                ${
                                  stderr.empty
                                    ? html`<div class="crit-tool__empty">No stderr output.</div>`
                                    : html`<code-block
                                        .code=${stderr.code}
                                        language=${stderr.language}
                                      ></code-block>`
                                }
                              </section>
                            `
                          : nothing
                      }
                    </div>
                  `
                : html`
                    <div class="crit-tool__empty">
                      Preparing the Python sandbox call and waiting for output.
                    </div>
                  `
            }

            ${
              summary
                ? html`
                    <section class="crit-tool__section">
                      <div class="crit-tool__label">Summary</div>
                      <p class="crit-tool__summary">${summary}</p>
                    </section>
                  `
                : nothing
            }

            ${
              details
                ? html`
                    <div class="crit-tool__meta">
                      <span>exit ${details.exitCode}</span>
                      <span>${details.stagedFiles.length} staged file${details.stagedFiles.length === 1 ? "" : "s"}</span>
                      <span>${details.workspaceDir}</span>
                    </div>
                  `
                : nothing
            }
          </div>
        `,
        isCustom: false,
      };
    },
  });
}
