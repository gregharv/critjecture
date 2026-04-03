import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { html, nothing } from "lit";

import type {
  GeneratedAssetToolResponse,
  SandboxGeneratedAsset,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";

type SandboxToolDetails = SandboxToolResponse | GeneratedAssetToolResponse;

type ToolRendererRegistry = {
  registerToolRenderer: (
    toolName: string,
    renderer: {
      render: (
        params: unknown,
        result?: ToolResultMessage<SandboxToolDetails>,
        isStreaming?: boolean,
      ) => { content: ReturnType<typeof html>; isCustom: boolean };
    },
  ) => void;
};

type SandboxCardOptions = {
  assetKind?: "image" | "pdf";
  emptyCopy: string;
  eyebrow: string;
  title: string;
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

function getToolState(
  result: ToolResultMessage<SandboxToolDetails> | undefined,
  isStreaming: boolean | undefined,
) {
  if (result) {
    return result.isError ? "error" : "complete";
  }

  return isStreaming ? "running" : "pending";
}

function getToolSummary(result: ToolResultMessage<SandboxToolDetails> | undefined) {
  return (
    result?.content
      ?.filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n")
      .trim() ?? ""
  );
}

function getToolDetails(result: ToolResultMessage<SandboxToolDetails> | undefined) {
  return isRecord(result?.details) ? (result.details as SandboxToolDetails) : undefined;
}

function getToolStagedFiles(details: SandboxToolDetails | undefined) {
  return Array.isArray(details?.stagedFiles) ? details.stagedFiles : [];
}

function getToolExitCode(details: SandboxToolDetails | undefined) {
  return typeof details?.exitCode === "number" ? details.exitCode : undefined;
}

function getToolSandboxRunId(details: SandboxToolDetails | undefined) {
  return typeof details?.sandboxRunId === "string" ? details.sandboxRunId : "";
}

function getToolRunner(details: SandboxToolDetails | undefined) {
  return typeof details?.runner === "string" ? details.runner : "";
}

function getToolLimits(details: SandboxToolDetails | undefined) {
  return details?.limits;
}

function getGeneratedAsset(details: SandboxToolDetails | undefined) {
  if (!details || !("generatedAsset" in details)) {
    return undefined;
  }

  return details.generatedAsset;
}

function renderGeneratedAsset(asset: SandboxGeneratedAsset, kind: "image" | "pdf") {
  if (kind === "image") {
    return html`
      <section class="crit-tool__section">
        <div class="crit-tool__label">Generated Graph</div>
        <div class="crit-tool__asset-card crit-tool__asset-card--image">
          <img
            alt=${asset.fileName}
            class="crit-tool__image"
            loading="lazy"
            src=${asset.downloadUrl}
          />
          <div class="crit-tool__asset-footer">
            <div class="crit-tool__asset-copy">
              <div class="crit-tool__asset-name">${asset.fileName}</div>
              <div class="crit-tool__asset-path">${asset.relativePath}</div>
            </div>
            <a
              class="crit-tool__asset-link"
              href=${asset.downloadUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open Image
            </a>
          </div>
        </div>
      </section>
    `;
  }

  return html`
    <section class="crit-tool__section">
      <div class="crit-tool__label">Generated Document</div>
      <div class="crit-tool__asset-card crit-tool__asset-card--document">
        <div class="crit-tool__asset-copy">
          <div class="crit-tool__asset-name">${asset.fileName}</div>
          <div class="crit-tool__asset-path">${asset.relativePath}</div>
        </div>
        <a class="crit-tool__download-button" href=${asset.downloadUrl}>
          Download Document
        </a>
      </div>
    </section>
  `;
}

function renderSandboxToolCard(
  options: SandboxCardOptions,
  params: unknown,
  result: ToolResultMessage<SandboxToolDetails> | undefined,
  isStreaming?: boolean,
) {
  const code = getCodeParam(params);
  const details = getToolDetails(result);
  const stagedFiles = getToolStagedFiles(details);
  const exitCode = getToolExitCode(details);
  const stdout = formatBlockContent(details?.stdout);
  const stderr = formatBlockContent(details?.stderr);
  const state = getToolState(result, isStreaming);
  const summary = getToolSummary(result);
  const generatedAsset = getGeneratedAsset(details);
  const sandboxRunId = getToolSandboxRunId(details);
  const runner = getToolRunner(details);
  const limits = getToolLimits(details);
  const shouldCollapseLogsByDefault =
    state === "complete" && (Boolean(generatedAsset) || Boolean(summary));
  const hasLogOutput = !stdout.empty || !stderr.empty || result?.isError;

  return {
    content: html`
      <div class="crit-tool crit-tool--python">
        <div class="crit-tool__header">
          <div class="crit-tool__heading">
            <span class="crit-tool__eyebrow">${options.eyebrow}</span>
            <div class="crit-tool__title">${options.title}</div>
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
                  stagedFiles.length
                    ? html`
                        <section class="crit-tool__section">
                          <div class="crit-tool__label">Staged Input Files</div>
                          <div class="crit-tool__files">
                            ${stagedFiles.map(
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

                ${
                  generatedAsset && options.assetKind
                    ? renderGeneratedAsset(generatedAsset, options.assetKind)
                    : nothing
                }

                ${
                  hasLogOutput
                    ? html`
                        <details
                          class="crit-tool__disclosure"
                          ?open=${!shouldCollapseLogsByDefault}
                        >
                          <summary class="crit-tool__disclosure-summary">
                            <span class="crit-tool__label">Execution Logs</span>
                          </summary>

                          <div class="crit-tool__split">
                            <section class="crit-tool__section">
                              <div class="crit-tool__label">stdout</div>
                              ${
                                stdout.empty
                                  ? html`<div class="crit-tool__empty">${options.emptyCopy}</div>`
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
                        </details>
                      `
                    : nothing
                }
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
          typeof exitCode === "number" || stagedFiles.length || sandboxRunId || runner || limits
            ? html`
                <div class="crit-tool__meta">
                  ${typeof exitCode === "number"
                    ? html`<span>exit ${exitCode}</span>`
                    : nothing}
                  ${stagedFiles.length || details
                    ? html`<span>${stagedFiles.length} staged file${stagedFiles.length === 1 ? "" : "s"}</span>`
                    : nothing}
                  ${runner ? html`<span>${runner}</span>` : nothing}
                  ${sandboxRunId ? html`<span>run ${sandboxRunId}</span>` : nothing}
                  ${limits
                    ? html`<span>${Math.round(limits.memoryLimitBytes / (1024 * 1024))} MiB</span>`
                    : nothing}
                  ${limits ? html`<span>${Math.round(limits.timeoutMs / 1000)}s timeout</span>` : nothing}
                </div>
              `
            : nothing
        }
      </div>
    `,
    isCustom: false,
  };
}

export function registerCritjectureToolRenderers(registry: ToolRendererRegistry) {
  registry.registerToolRenderer("run_data_analysis", {
    render(params, result, isStreaming) {
      return renderSandboxToolCard(
        {
          emptyCopy:
            "No stdout captured. The Python code should use print(...) for the final answer.",
          eyebrow: "Python Sandbox",
          title: "Run Data Analysis",
        },
        params,
        result,
        isStreaming,
      );
    },
  });

  registry.registerToolRenderer("generate_visual_graph", {
    render(params, result, isStreaming) {
      return renderSandboxToolCard(
        {
          assetKind: "image",
          emptyCopy:
            "No stdout captured. Save the PNG to outputs/chart.png and print a short summary.",
          eyebrow: "Chart Generator",
          title: "Generate Visual Graph",
        },
        params,
        result,
        isStreaming,
      );
    },
  });

  registry.registerToolRenderer("generate_document", {
    render(params, result, isStreaming) {
      return renderSandboxToolCard(
        {
          assetKind: "pdf",
          emptyCopy:
            "No stdout captured. Save the PDF to outputs/notice.pdf and print a short summary.",
          eyebrow: "Document Generator",
          title: "Generate Document",
        },
        params,
        result,
        isStreaming,
      );
    },
  });
}
