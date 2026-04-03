import "server-only";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ensureStorageRoot } from "@/lib/app-paths";

export type BraveFreshness = "pd" | "pw" | "pm" | "py";
export type BraveFormat = "one_line" | "short" | "raw_json";

export type BraveSearchResult = {
  age?: string;
  content?: string;
  contentFilePath?: string;
  snippet: string;
  title: string;
  url: string;
};

export type BraveGroundingCitation = {
  label: string;
  url: string;
};

const BRAVE_FRESHNESS_VALUES = new Set<BraveFreshness>(["pd", "pw", "pm", "py"]);
const BRAVE_FORMAT_VALUES = new Set<BraveFormat>(["one_line", "short", "raw_json"]);

const DEFAULT_COUNTRY = "US";
const MAX_CONTENT_CHARS = 5000;
const MAX_SAVED_CONTENT_CHARS = 250_000;
const MAX_FETCH_CONTENT_RESULTS = 5;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function capText(text: string, maxChars: number) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n(Truncated)`;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtmlToText(value: string) {
  return decodeHtmlEntities(
    normalizeWhitespace(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function getBraveApiKeys() {
  const freeKey = (process.env.BRAVE_API_KEY ?? "").trim();
  const paidKey = (process.env.BRAVE_API_KEY_PAID ?? "").trim();
  const keys = [freeKey, paidKey].filter(Boolean);

  if (keys.length === 0) {
    throw new Error(
      "Missing Brave Search API key. Set BRAVE_API_KEY (and optionally BRAVE_API_KEY_PAID).",
    );
  }

  return [...new Set(keys)];
}

function getBraveGroundingApiKey() {
  const key = (process.env.BRAVE_API_KEY_AI_GROUNDING ?? "").trim();

  if (!key) {
    throw new Error("Missing Brave AI grounding key. Set BRAVE_API_KEY_AI_GROUNDING.");
  }

  return key;
}

function isQuotaOrAuthError(status: number) {
  return status === 401 || status === 403 || status === 429;
}

function isDirectUrlQuery(query: string) {
  return /^https?:\/\//i.test(query.trim());
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

async function getClipsDirectory() {
  const storageRoot = await ensureStorageRoot();
  const clipsDirectory = path.join(storageRoot, "brave_clips");

  await mkdir(clipsDirectory, { recursive: true });

  return clipsDirectory;
}

async function writeClipFile(input: {
  content: string;
  sourceUrl: string;
  title: string;
}) {
  const clipsDirectory = await getClipsDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const hash = createHash("sha1").update(input.sourceUrl).digest("hex").slice(0, 10);
  const safeTitle = input.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fileName = `${timestamp}_${safeTitle || "clip"}_${hash}.md`;
  const filePath = path.join(clipsDirectory, fileName);

  await writeFile(
    filePath,
    `Source: ${input.sourceUrl}\nClipped: ${new Date().toISOString()}\n\n---\n\n${capText(
      input.content,
      MAX_SAVED_CONTENT_CHARS,
    )}`,
    "utf8",
  );

  return filePath;
}

async function fetchPageContent(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.8",
      "User-Agent": "Critjecture Brave Search",
    },
    signal,
  });

  if (!response.ok) {
    return `(HTTP ${response.status})`;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();

  if (contentType.includes("text/html") || /^\s*</.test(text)) {
    return capText(stripHtmlToText(text), MAX_SAVED_CONTENT_CHARS);
  }

  return capText(text, MAX_SAVED_CONTENT_CHARS);
}

function extractMarkdownLinks(text: string): BraveGroundingCitation[] {
  const links: BraveGroundingCitation[] = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

  for (;;) {
    const match = regex.exec(text);

    if (!match) {
      break;
    }

    const label = match[1]?.trim();
    const url = match[2]?.trim();

    if (!label || !url) {
      continue;
    }

    links.push({ label, url });
  }

  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.url)) {
      return false;
    }

    seen.add(link.url);
    return true;
  });
}

export function normalizeBraveQuery(query: string) {
  const trimmed = query.trim();
  const hasDoubleQuotes =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const hasSingleQuotes =
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  const unwrapped = hasDoubleQuotes || hasSingleQuotes ? trimmed.slice(1, -1) : trimmed;

  return normalizeWhitespace(unwrapped);
}

export function normalizeBraveCountry(country: unknown) {
  return String(country ?? DEFAULT_COUNTRY)
    .trim()
    .toUpperCase() || DEFAULT_COUNTRY;
}

export function sanitizeBraveFreshness(freshness: unknown) {
  const candidate = String(freshness ?? "").trim() as BraveFreshness;

  return BRAVE_FRESHNESS_VALUES.has(candidate) ? candidate : undefined;
}

export function sanitizeBraveFormat(format: unknown) {
  const candidate = String(format ?? "short").trim() as BraveFormat;

  return BRAVE_FORMAT_VALUES.has(candidate) ? candidate : "short";
}

export function clampBraveCount(count: unknown) {
  const parsed = Number.parseInt(String(count ?? "3"), 10);

  if (Number.isNaN(parsed)) {
    return 3;
  }

  return clampNumber(parsed, 1, 20);
}

async function fetchBraveSearchApi(input: {
  count: number;
  country: string;
  freshness?: BraveFreshness;
  query: string;
  signal?: AbortSignal;
}) {
  const keys = getBraveApiKeys();
  const searchParams = new URLSearchParams({
    count: String(input.count),
    country: input.country,
    q: input.query,
  });

  if (input.freshness) {
    searchParams.set("freshness", input.freshness);
  }

  const endpoint = `https://api.search.brave.com/res/v1/web/search?${searchParams.toString()}`;
  let lastError: Error | null = null;

  for (const [index, key] of keys.entries()) {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
      signal: input.signal,
    });

    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }

    const body = await response.text();
    lastError = new Error(`Brave Search HTTP ${response.status}: ${body}`);

    if (!(isQuotaOrAuthError(response.status) && index < keys.length - 1)) {
      throw lastError;
    }
  }

  throw lastError ?? new Error("Brave Search request failed.");
}

function mapSearchResults(data: Record<string, unknown>, count: number): BraveSearchResult[] {
  const mapped: BraveSearchResult[] = [];

  const webResults =
    typeof data.web === "object" &&
    data.web !== null &&
    "results" in data.web &&
    Array.isArray(data.web.results)
      ? data.web.results
      : [];

  for (const entry of webResults) {
    if (mapped.length >= count) {
      break;
    }

    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const title = typeof entry.title === "string" ? entry.title : "";
    const url = typeof entry.url === "string" ? entry.url : "";
    const snippet = typeof entry.description === "string" ? entry.description : "";
    const age =
      typeof entry.age === "string"
        ? entry.age
        : typeof entry.page_age === "string"
          ? entry.page_age
          : undefined;

    if (!url) {
      continue;
    }

    mapped.push({ age, snippet, title, url });
  }

  return mapped;
}

export async function runBraveSearch(input: {
  count: number;
  country: string;
  fetchContent: boolean;
  freshness?: BraveFreshness;
  query: string;
  signal?: AbortSignal;
}) {
  const effectiveCount = input.fetchContent
    ? Math.min(input.count, MAX_FETCH_CONTENT_RESULTS)
    : input.count;

  let results: BraveSearchResult[];

  if (input.fetchContent && isDirectUrlQuery(input.query)) {
    const content = await fetchPageContent(input.query, input.signal);
    const contentFilePath = await writeClipFile({
      content,
      sourceUrl: input.query,
      title: input.query,
    });

    results = [
      {
        content: truncateText(content, MAX_CONTENT_CHARS),
        contentFilePath,
        snippet: "(Direct fetch)",
        title: input.query,
        url: input.query,
      },
    ];
  } else {
    const data = await fetchBraveSearchApi({
      count: effectiveCount,
      country: input.country,
      freshness: input.freshness,
      query: input.query,
      signal: input.signal,
    });

    results = mapSearchResults(data, effectiveCount);

    if (input.fetchContent) {
      for (const result of results) {
        try {
          const content = await fetchPageContent(result.url, input.signal);
          result.content = truncateText(content, MAX_CONTENT_CHARS);
          result.contentFilePath = await writeClipFile({
            content,
            sourceUrl: result.url,
            title: result.title || "clip",
          });
        } catch (caughtError) {
          const message =
            caughtError instanceof Error ? caughtError.message : "Failed to fetch content.";
          result.content = `(Error: ${message})`;
        }
      }
    }
  }

  return {
    count: effectiveCount,
    country: input.country,
    fetchContent: input.fetchContent,
    freshness: input.freshness,
    query: input.query,
    results,
  };
}

export function formatBraveSearchText(input: {
  format: BraveFormat;
  query: string;
  results: BraveSearchResult[];
}) {
  if (input.format === "raw_json") {
    return JSON.stringify(
      {
        query: input.query,
        results: input.results,
      },
      null,
      2,
    );
  }

  if (input.format === "one_line") {
    const top = input.results[0];

    if (!top) {
      return "No results";
    }

    return `${top.title} — ${top.url}${top.age ? ` (${top.age})` : ""}`;
  }

  if (input.results.length === 0) {
    return "No results";
  }

  return input.results
    .map((result, index) => {
      const lines = [
        `--- Result ${index + 1} ---`,
        `URL: ${result.url}`,
        `Title: ${result.title}${result.age ? ` (${result.age})` : ""}`,
      ];

      if (result.snippet) {
        lines.push(`Snippet: ${truncateText(result.snippet, 400)}`);
      }

      if (result.contentFilePath) {
        lines.push(`Saved: ${result.contentFilePath}`);
      }

      if (result.content) {
        lines.push("", "Content (preview):", result.content);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export async function runBraveGrounding(input: {
  enableCitations: boolean;
  enableEntities: boolean;
  enableResearch: boolean;
  maxAnswerChars: number;
  question: string;
  signal?: AbortSignal;
}) {
  const apiKey = getBraveGroundingApiKey();
  const response = await fetch("https://api.search.brave.com/res/v1/chat/completions", {
    body: JSON.stringify({
      extra_body: {
        enable_citations: input.enableCitations,
        enable_entities: input.enableEntities,
        enable_research: input.enableResearch,
      },
      messages: [{ content: input.question, role: "user" }],
      model: "brave",
      stream: false,
    }),
    headers: {
      "Content-Type": "application/json",
      "x-subscription-token": apiKey,
    },
    method: "POST",
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brave Grounding HTTP ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: unknown;
  };

  const rawAnswer = payload.choices?.[0]?.message?.content?.trim() ?? "";
  const answer = truncateText(rawAnswer || "No answer was returned.", input.maxAnswerChars);

  return {
    answer,
    citations: extractMarkdownLinks(answer),
    usage: payload.usage ?? null,
  };
}
