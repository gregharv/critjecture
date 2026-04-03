import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { html, nothing } from "lit";

import type {
  GeneratedAssetToolResponse,
  SandboxGeneratedAsset,
  SandboxToolResponse,
} from "@/lib/sandbox-tool-types";

type SandboxToolDetails = SandboxToolResponse | GeneratedAssetToolResponse;
type AnyToolDetails = Record<string, unknown>;
type ToolRendererResult = ToolResultMessage<AnyToolDetails>;

type ToolRendererRegistry = {
  registerToolRenderer: (
    toolName: string,
    renderer: {
      render: (
        params: unknown,
        result?: ToolResultMessage<AnyToolDetails>,
        isStreaming?: boolean,
      ) => { content: ReturnType<typeof html>; isCustom: boolean };
    },
  ) => void;
};

type SandboxCardOptions = {
  assetKind?: "image" | "pdf";
  emptyCopy: string;
  eyebrow: string;
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

function getToolState(result: ToolRendererResult | undefined, isStreaming: boolean | undefined) {
  if (result) {
    return result.isError ? "error" : "complete";
  }

  return isStreaming ? "running" : "pending";
}

function renderCollapsedToolError(eyebrow: string) {
  return {
    content: html`
      <div class="crit-tool crit-tool--error-collapsed">
        <div class="crit-tool__empty">Error (${eyebrow})</div>
      </div>
    `,
    isCustom: false,
  };
}

function getToolSummary(result: ToolRendererResult | undefined) {
  return (
    result?.content
      ?.filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n")
      .trim() ?? ""
  );
}

function getToolDetails(result: ToolRendererResult | undefined) {
  return isRecord(result?.details) ? (result.details as AnyToolDetails) : undefined;
}

function getSandboxToolDetails(result: ToolRendererResult | undefined) {
  const details = getToolDetails(result);

  return details ? (details as SandboxToolDetails) : undefined;
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
  result: ToolRendererResult | undefined,
  isStreaming?: boolean,
) {
  if (result?.isError) {
    return renderCollapsedToolError(options.eyebrow);
  }

  const code = getCodeParam(params);
  const details = getSandboxToolDetails(result);
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

function getStringValue(source: unknown, key: string) {
  if (!isRecord(source)) {
    return "";
  }

  const value = source[key];

  return typeof value === "string" ? value : "";
}

function getBooleanValue(source: unknown, key: string) {
  if (!isRecord(source)) {
    return false;
  }

  return Boolean(source[key]);
}

function getStringArrayValue(source: unknown, key: string) {
  if (!isRecord(source) || !Array.isArray(source[key])) {
    return [] as string[];
  }

  return source[key].filter((entry): entry is string => typeof entry === "string");
}

function getBraveResults(source: unknown) {
  if (!isRecord(source) || !Array.isArray(source.results)) {
    return [] as Array<{
      content?: string;
      contentFilePath?: string;
      snippet?: string;
      title?: string;
      url?: string;
    }>;
  }

  return source.results.filter((entry) => isRecord(entry));
}

function renderBraveSearchToolCard(
  params: unknown,
  result: ToolRendererResult | undefined,
  isStreaming?: boolean,
) {
  if (result?.isError) {
    return renderCollapsedToolError("Web Search");
  }

  const parsedParams = parseToolParams(params);
  const details = getToolDetails(result);
  const state = getToolState(result, isStreaming);
  const query = getStringValue(details, "query") || getStringValue(parsedParams, "query");
  const braveResults = getBraveResults(details).slice(0, 6);
  const savedCount = braveResults.filter((entry) => getStringValue(entry, "contentFilePath")).length;

  return {
    content: html`
      <div class="crit-tool">
        <div class="crit-tool__header">
          <div class="crit-tool__heading">
            <span class="crit-tool__eyebrow">Web Search</span>
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

        ${query
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Query</div>
              <p class="crit-tool__summary">${query}</p>
            </section>`
          : nothing}

        ${braveResults.length > 0
          ? html`<details class="crit-tool__disclosure">
              <summary class="crit-tool__disclosure-summary">
                <span class="crit-tool__label">Top Results (${braveResults.length})</span>
              </summary>
              <div class="crit-tool__files">
                ${braveResults.map((entry) => {
                  const title = getStringValue(entry, "title");
                  const url = getStringValue(entry, "url");
                  const snippet = getStringValue(entry, "snippet");
                  const savedPath = getStringValue(entry, "contentFilePath");

                  return html`
                    <div class="crit-tool__file">
                      <div class="crit-tool__file-source">
                        ${url
                          ? html`<a href=${url} rel="noreferrer" target="_blank">${title || url}</a>`
                          : title || "Untitled result"}
                      </div>
                      ${snippet
                        ? html`<div class="crit-tool__file-stage">${snippet}</div>`
                        : nothing}
                      ${savedPath
                        ? html`<div class="crit-tool__file-stage">Saved: ${savedPath}</div>`
                        : nothing}
                    </div>
                  `;
                })}
              </div>
            </details>`
          : state === "running"
            ? html`<div class="crit-tool__empty">Searching the web…</div>`
            : nothing}

        ${(braveResults.length > 0 || savedCount > 0)
          ? html`<div class="crit-tool__meta">
              <span>${braveResults.length} result${braveResults.length === 1 ? "" : "s"}</span>
              ${savedCount > 0
                ? html`<span>${savedCount} saved clip${savedCount === 1 ? "" : "s"}</span>`
                : nothing}
            </div>`
          : nothing}
      </div>
    `,
    isCustom: false,
  };
}

function renderBraveGroundingToolCard(
  params: unknown,
  result: ToolRendererResult | undefined,
  isStreaming?: boolean,
) {
  if (result?.isError) {
    return renderCollapsedToolError("Grounded Web Answer");
  }

  const parsedParams = parseToolParams(params);
  const details = getToolDetails(result);
  const state = getToolState(result, isStreaming);
  const question =
    getStringValue(details, "question") || getStringValue(parsedParams, "question");
  const summary = getToolSummary(result);
  const citations =
    isRecord(details) && Array.isArray(details.citations)
      ? details.citations.filter((entry) => isRecord(entry)).slice(0, 8)
      : [];

  return {
    content: html`
      <div class="crit-tool">
        <div class="crit-tool__header">
          <div class="crit-tool__heading">
            <span class="crit-tool__eyebrow">Grounded Web Answer</span>
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

        ${question
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Question</div>
              <p class="crit-tool__summary">${question}</p>
            </section>`
          : nothing}

        ${summary
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Answer</div>
              <p class="crit-tool__summary">${summary}</p>
            </section>`
          : nothing}

        ${citations.length > 0
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Citations</div>
              <div class="crit-tool__files">
                ${citations.map((citation) => {
                  const label = getStringValue(citation, "label");
                  const url = getStringValue(citation, "url");

                  return html`
                    <div class="crit-tool__file">
                      <div class="crit-tool__file-source">${label || url}</div>
                      ${url
                        ? html`<div class="crit-tool__file-stage">
                            <a href=${url} rel="noreferrer" target="_blank">${url}</a>
                          </div>`
                        : nothing}
                    </div>
                  `;
                })}
              </div>
            </section>`
          : nothing}
      </div>
    `,
    isCustom: false,
  };
}

function renderAskUserToolCard(
  params: unknown,
  result: ToolRendererResult | undefined,
  isStreaming?: boolean,
) {
  if (result?.isError) {
    return renderCollapsedToolError("User Decision Gate");
  }

  const parsedParams = parseToolParams(params);
  const details = getToolDetails(result);
  const state = getToolState(result, isStreaming);
  const question =
    getStringValue(details, "question") || getStringValue(parsedParams, "question");
  const context = getStringValue(details, "context") || getStringValue(parsedParams, "context");
  const answer = getStringValue(details, "answer");
  const cancelled = getBooleanValue(details, "cancelled");

  return {
    content: html`
      <div class="crit-tool">
        <div class="crit-tool__header">
          <div class="crit-tool__heading">
            <span class="crit-tool__eyebrow">User Decision Gate</span>
          </div>
          <span class="crit-tool__status crit-tool__status--${state}">
            ${state === "complete"
              ? "Complete"
              : state === "error"
                ? "Error"
                : state === "running"
                  ? "Waiting"
                  : "Queued"}
          </span>
        </div>

        ${question
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Question</div>
              <p class="crit-tool__summary">${question}</p>
            </section>`
          : nothing}

        ${context
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Context</div>
              <p class="crit-tool__summary">${context}</p>
            </section>`
          : nothing}

        ${state === "running"
          ? html`<div class="crit-tool__empty">Waiting for user selection…</div>`
          : cancelled
            ? html`<div class="crit-tool__empty">User cancelled the prompt.</div>`
            : answer
              ? html`<section class="crit-tool__section">
                  <div class="crit-tool__label">Selected Answer</div>
                  <p class="crit-tool__summary">${answer}</p>
                </section>`
              : nothing}
      </div>
    `,
    isCustom: false,
  };
}

function renderCompanyKnowledgeSearchToolCard(
  params: unknown,
  result: ToolRendererResult | undefined,
  isStreaming?: boolean,
) {
  if (result?.isError) {
    return renderCollapsedToolError("Knowledge Search");
  }

  const parsedParams = parseToolParams(params);
  const details = getToolDetails(result);
  const state = getToolState(result, isStreaming);
  const query = getStringValue(parsedParams, "query");
  const scopeDescription = getStringValue(details, "scopeDescription");
  const selectedFiles = getStringArrayValue(details, "selectedFiles");
  const recommendedFiles = getStringArrayValue(details, "recommendedFiles");
  const selectionRequired = getBooleanValue(details, "selectionRequired");
  const summary = getToolSummary(result);
  const candidateFiles =
    isRecord(details) && Array.isArray(details.candidateFiles)
      ? details.candidateFiles.filter((entry) => isRecord(entry)).slice(0, 8)
      : [];

  return {
    content: html`
      <div class="crit-tool">
        <div class="crit-tool__header">
          <div class="crit-tool__heading">
            <span class="crit-tool__eyebrow">Knowledge Search</span>
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

        ${query
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Query</div>
              <p class="crit-tool__summary">${query}</p>
            </section>`
          : nothing}

        ${scopeDescription
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Scope</div>
              <p class="crit-tool__summary">${scopeDescription}</p>
            </section>`
          : nothing}

        ${candidateFiles.length > 0
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Candidate Files</div>
              <div class="crit-tool__files">
                ${candidateFiles.map((candidate) => {
                  const file = getStringValue(candidate, "file") || "Unknown file";
                  const matchedTerms = getStringArrayValue(candidate, "matchedTerms");

                  return html`
                    <div class="crit-tool__file">
                      <div class="crit-tool__file-source">${file}</div>
                      ${matchedTerms.length > 0
                        ? html`<div class="crit-tool__file-stage">
                            Matched terms: ${matchedTerms.join(", ")}
                          </div>`
                        : nothing}
                    </div>
                  `;
                })}
              </div>
            </section>`
          : nothing}

        ${selectedFiles.length > 0
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Selected Files</div>
              <p class="crit-tool__summary">${selectedFiles.join(", ")}</p>
            </section>`
          : recommendedFiles.length > 0
            ? html`<section class="crit-tool__section">
                <div class="crit-tool__label">Recommended Files</div>
                <p class="crit-tool__summary">${recommendedFiles.join(", ")}</p>
              </section>`
            : nothing}

        ${selectionRequired
          ? html`<div class="crit-tool__empty">
              File confirmation is required before analysis can continue.
            </div>`
          : nothing}

        ${summary
          ? html`<section class="crit-tool__section">
              <div class="crit-tool__label">Summary</div>
              <p class="crit-tool__summary">${summary}</p>
            </section>`
          : nothing}
      </div>
    `,
    isCustom: false,
  };
}

export function registerCritjectureToolRenderers(registry: ToolRendererRegistry) {
  registry.registerToolRenderer("search_company_knowledge", {
    render(params, result, isStreaming) {
      return renderCompanyKnowledgeSearchToolCard(params, result, isStreaming);
    },
  });

  registry.registerToolRenderer("run_data_analysis", {
    render(params, result, isStreaming) {
      return renderSandboxToolCard(
        {
          emptyCopy:
            "No stdout captured. The Python code should use print(...) for the final answer.",
          eyebrow: "Python Sandbox",
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
        },
        params,
        result,
        isStreaming,
      );
    },
  });

  registry.registerToolRenderer("brave_search", {
    render(params, result, isStreaming) {
      return renderBraveSearchToolCard(params, result, isStreaming);
    },
  });

  registry.registerToolRenderer("brave_grounding", {
    render(params, result, isStreaming) {
      return renderBraveGroundingToolCard(params, result, isStreaming);
    },
  });

  registry.registerToolRenderer("ask_user", {
    render(params, result, isStreaming) {
      return renderAskUserToolCard(params, result, isStreaming);
    },
  });
}
