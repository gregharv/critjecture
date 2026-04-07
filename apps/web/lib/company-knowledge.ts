import "server-only";

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { complete, getModel } from "@mariozechner/pi-ai";
import { and, eq, inArray } from "drizzle-orm";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { getAppDatabase } from "@/lib/app-db";
import { documentChunks, documents } from "@/lib/app-schema";
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/chat-models";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { KNOWLEDGE_MANAGED_SOURCE_TYPES } from "@/lib/knowledge-import-types";
import { isRipgrepAvailable } from "@/lib/runtime-toolchain";
import type {
  CompanyKnowledgeCandidateFile,
  CompanyKnowledgeMatch,
  CompanyKnowledgePreview,
  CompanyKnowledgeSearchResult,
} from "@/lib/company-knowledge-types";
import type { UserRole } from "@/lib/roles";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_MATCHES = 6;
const SEARCH_RESULT_MAX_TEXT_CHARS = 240;
const SEARCH_RESULT_MAX_COLUMNS = 48;
const SEARCH_RESULT_MAX_COLUMN_CHARS = 80;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "average",
  "for",
  "from",
  "in",
  "is",
  "our",
  "the",
  "to",
  "what",
  "with",
]);

const SEARCHABLE_TEXT_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
]);
const TERM_GROUPS = [
  ["sales", "sale", "revenue", "income", "turnover"],
  ["region", "regions", "area", "areas", "zone", "zones", "territory", "territories"],
  ["product", "products", "item", "items", "sku", "skus"],
  ["customer", "customers", "client", "clients", "account", "accounts"],
  ["profit", "margin", "earnings"],
] as const;
const MAX_EXPANDED_SEARCH_TERMS = 20;
const MAX_FUZZY_CORRECTIONS_PER_TOKEN = 2;
const MAX_FUZZY_DISTANCE = 2;
const MIN_FUZZY_TOKEN_LENGTH = 4;
const AI_REWRITE_MANIFEST_MAX_FILES = 200;
const AI_REWRITE_REQUEST_MAX_TOKENS = 220;
const AI_REWRITE_TIMEOUT_MS = 2500;
const AI_REWRITE_MIN_SCORE_THRESHOLD = 18;

type CandidateAccumulator = {
  file: string;
  filenameMatchedTerms: Set<string>;
  exactMatchCount: number;
  matchedTerms: Set<string>;
  matchesByLine: Map<string, CompanyKnowledgeMatch>;
};

type KnowledgeFileManifestEntry = {
  csvColumns: string[];
  file: string;
  filenameTokens: Set<string>;
  previewTokens: Set<string>;
  tokens: Set<string>;
};

type KnowledgeFileManifest = {
  entries: KnowledgeFileManifestEntry[];
  fileCount: number;
  tokenIndex: Map<string, string[]>;
  vocabulary: Set<string>;
};

type QueryExpansion = {
  correctedTerms: Array<{ from: string; to: string }>;
  expandedTerms: string[];
  tokenSearchTerms: string[];
};

type FileSystemCandidateSearchResult = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  exactMatchCount: number;
};

function getScopeDescription(role: UserRole) {
  return canRoleAccessKnowledgeScope(role, "admin")
    ? "all company_data files"
    : "public company_data files only";
}

function extractQueryYear(query: string) {
  return query.match(/\b(?:19|20)\d{2}\b/)?.[0];
}

function normalizeSearchToken(token: string) {
  const normalized = token.toLowerCase().trim();

  if (!normalized || STOPWORDS.has(normalized)) {
    return [];
  }

  const variants = new Set<string>([normalized]);

  if (normalized.endsWith("s") && normalized.length > 3) {
    variants.add(normalized.slice(0, -1));
  }

  return [...variants];
}

function tokenizeText(value: string) {
  return [
    ...new Set(
      value
        .match(/[a-z0-9_]+/gi)
        ?.flatMap((token) => normalizeSearchToken(token)) ?? [],
    ),
  ];
}

function tokenizeQuery(query: string) {
  return tokenizeText(query);
}

const SYNONYM_MAP = TERM_GROUPS.reduce((map, group) => {
  for (const term of group) {
    const normalizedTerm = term.toLowerCase();
    const synonyms = group.filter((candidate) => candidate !== term).map((candidate) => candidate.toLowerCase());
    map.set(normalizedTerm, synonyms);
  }

  return map;
}, new Map<string, string[]>());

function buildTokenIndex(vocabulary: Set<string>) {
  const index = new Map<string, string[]>();

  for (const term of vocabulary) {
    if (term.length < 3 || term.length > 40) {
      continue;
    }

    const firstCharacter = term[0];

    if (!firstCharacter) {
      continue;
    }

    const bucket = index.get(firstCharacter) ?? [];
    bucket.push(term);
    index.set(firstCharacter, bucket);
  }

  return index;
}

function boundedLevenshteinDistance(left: string, right: string, maxDistance: number) {
  if (left === right) {
    return 0;
  }

  if (Math.abs(left.length - right.length) > maxDistance) {
    return null;
  }

  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    let rowMinimum = current[0]!;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      const insertCost = current[column - 1]! + 1;
      const deleteCost = previous[column]! + 1;
      const replaceCost = previous[column - 1]! + substitutionCost;
      const value = Math.min(insertCost, deleteCost, replaceCost);

      current[column] = value;

      if (value < rowMinimum) {
        rowMinimum = value;
      }
    }

    if (rowMinimum > maxDistance) {
      return null;
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column]!;
    }
  }

  const distance = previous[right.length]!;

  return distance <= maxDistance ? distance : null;
}

function findClosestTokens(token: string, tokenIndex: Map<string, string[]>) {
  if (token.length < MIN_FUZZY_TOKEN_LENGTH) {
    return [] as string[];
  }

  const firstCharacter = token[0];

  if (!firstCharacter) {
    return [] as string[];
  }

  const bucket = tokenIndex.get(firstCharacter) ?? [];
  const distances = bucket
    .map((candidate) => {
      const distance = boundedLevenshteinDistance(token, candidate, MAX_FUZZY_DISTANCE);

      if (distance === null) {
        return null;
      }

      return {
        candidate,
        distance,
      };
    })
    .filter((entry): entry is { candidate: string; distance: number } => entry !== null)
    .sort((left, right) => {
      if (left.distance === right.distance) {
        if (left.candidate.length === right.candidate.length) {
          return left.candidate.localeCompare(right.candidate);
        }

        return Math.abs(left.candidate.length - token.length) - Math.abs(right.candidate.length - token.length);
      }

      return left.distance - right.distance;
    });

  return distances.slice(0, MAX_FUZZY_CORRECTIONS_PER_TOKEN).map((entry) => entry.candidate);
}

function expandQueryTokens(queryTokens: string[], manifest: KnowledgeFileManifest): QueryExpansion {
  const expandedTerms = new Set<string>(queryTokens);
  const correctedTerms: Array<{ from: string; to: string }> = [];

  for (const token of queryTokens) {
    for (const synonym of SYNONYM_MAP.get(token) ?? []) {
      expandedTerms.add(synonym);
    }

    if (manifest.vocabulary.has(token)) {
      continue;
    }

    const closestTokens = findClosestTokens(token, manifest.tokenIndex);

    for (const closestToken of closestTokens) {
      expandedTerms.add(closestToken);
      correctedTerms.push({
        from: token,
        to: closestToken,
      });
    }
  }

  const tokenSearchTerms = [...expandedTerms].slice(0, MAX_EXPANDED_SEARCH_TERMS);

  return {
    correctedTerms,
    expandedTerms: tokenSearchTerms,
    tokenSearchTerms,
  };
}

function shouldEnableAiSearchRewrite() {
  const configuredValue = process.env.CRITJECTURE_ENABLE_AI_SEARCH_QUERY_REWRITE?.trim().toLowerCase();

  if (configuredValue === "0" || configuredValue === "false" || configuredValue === "off") {
    return false;
  }

  if (configuredValue === "1" || configuredValue === "true" || configuredValue === "on") {
    return true;
  }

  return process.env.NODE_ENV !== "test";
}

function shouldAttemptAiRewrite(input: {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  exactMatchCount: number;
}) {
  const topScore = input.candidateFiles[0]?.score ?? 0;

  return input.candidateFiles.length === 0 ||
    (input.exactMatchCount === 0 && topScore < AI_REWRITE_MIN_SCORE_THRESHOLD);
}

function buildManifestDigestForAi(manifest: KnowledgeFileManifest) {
  const lines: string[] = [];

  for (const entry of manifest.entries.slice(0, AI_REWRITE_MANIFEST_MAX_FILES)) {
    const columnsPart =
      entry.csvColumns.length > 0
        ? ` | csv_columns=${entry.csvColumns.slice(0, 16).join(", ")}`
        : "";

    lines.push(`- ${entry.file}${columnsPart}`);
  }

  return lines.join("\n");
}

function parseAiSuggestedTerms(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [] as string[];
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidatePayload = fencedMatch?.[1] ?? trimmed;
  const objectMatch = candidatePayload.match(/\{[\s\S]*\}/);
  const jsonPayload = objectMatch?.[0] ?? candidatePayload;

  try {
    const parsed = JSON.parse(jsonPayload) as {
      terms?: unknown;
    };
    const terms = Array.isArray(parsed.terms) ? parsed.terms : [];

    return [
      ...new Set(
        terms
          .filter((term): term is string => typeof term === "string")
          .flatMap((term) => normalizeSearchToken(term))
          .slice(0, MAX_EXPANDED_SEARCH_TERMS),
      ),
    ];
  } catch {
    return tokenizeText(trimmed).slice(0, MAX_EXPANDED_SEARCH_TERMS);
  }
}

async function suggestSearchTermsWithAi(input: {
  manifest: KnowledgeFileManifest;
  normalizedQuery: string;
  seedTerms: string[];
}) {
  if (!shouldEnableAiSearchRewrite()) {
    return [] as string[];
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return [] as string[];
  }

  const manifestDigest = buildManifestDigestForAi(input.manifest);

  if (!manifestDigest) {
    return [] as string[];
  }

  try {
    const model = getModel("openai", DEFAULT_CHAT_MODEL_ID);
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, AI_REWRITE_TIMEOUT_MS);

    const response = await complete(
      model,
      {
        systemPrompt:
          "You rewrite enterprise file-search queries. Return strict JSON only: {\"terms\":[...]} with up to 8 lowercase search terms. Focus on spelling fixes and synonyms. Do not include explanations.",
        messages: [
          {
            role: "user",
            content: [
              `User query: ${input.normalizedQuery}`,
              `Current expanded terms: ${input.seedTerms.join(", ")}`,
              "Available files (with CSV headers when present):",
              manifestDigest,
              "Return JSON only.",
            ].join("\n\n"),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey,
        maxTokens: AI_REWRITE_REQUEST_MAX_TOKENS,
        reasoning: "minimal",
        signal: abortController.signal,
        temperature: 0,
      },
    ).finally(() => {
      clearTimeout(timeoutHandle);
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return parseAiSuggestedTerms(text);
  } catch {
    return [] as string[];
  }
}

function createCandidateAccumulator(file: string): CandidateAccumulator {
  return {
    file,
    filenameMatchedTerms: new Set<string>(),
    exactMatchCount: 0,
    matchedTerms: new Set<string>(),
    matchesByLine: new Map<string, CompanyKnowledgeMatch>(),
  };
}

function addMatches(
  candidates: Map<string, CandidateAccumulator>,
  matches: CompanyKnowledgeMatch[],
  matchedTerm: string,
) {
  for (const match of matches) {
    const candidate = candidates.get(match.file) ?? createCandidateAccumulator(match.file);

    candidate.matchedTerms.add(matchedTerm);
    if (matchedTerm.includes(" ")) {
      candidate.exactMatchCount += 1;
    }
    candidate.matchesByLine.set(`${match.line}:${match.text}`, match);
    candidates.set(match.file, candidate);
  }
}

function previewContainsYear(preview: CompanyKnowledgePreview, year: string) {
  if (preview.kind === "csv") {
    return (
      preview.columns.some((column) => column.includes(year)) ||
      preview.rows.some((row) => row.some((cell) => cell.includes(year)))
    );
  }

  return preview.lines.some((line) => line.includes(year));
}

function isTextSearchableFile(relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();

  return SEARCHABLE_TEXT_EXTENSIONS.has(extension);
}

function isCommandNotFoundError(caughtError: unknown) {
  return (
    typeof caughtError === "object" &&
    caughtError !== null &&
    "code" in caughtError &&
    (caughtError.code === "ENOENT" || caughtError.code === 127)
  );
}

function isStdoutMaxBufferError(caughtError: unknown) {
  if (typeof caughtError !== "object" || caughtError === null) {
    return false;
  }

  const code = "code" in caughtError ? caughtError.code : undefined;
  const message = "message" in caughtError ? String(caughtError.message ?? "") : "";

  return code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || message.includes("maxBuffer");
}

function truncateMatchText(text: string) {
  const trimmed = text.trim().replaceAll("\r", " ");

  if (trimmed.length <= SEARCH_RESULT_MAX_TEXT_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, SEARCH_RESULT_MAX_TEXT_CHARS).trimEnd()}…`;
}

async function runFallbackSearch(
  pattern: string,
  companyDataRoot: string,
  searchedDirectory: string,
  maxMatches: number,
) {
  const loweredPattern = pattern.toLowerCase();
  const matches: CompanyKnowledgeMatch[] = [];
  const relativeFiles = await listRelativeFiles(companyDataRoot, searchedDirectory);

  for (const relativeFile of relativeFiles) {
    if (!isTextSearchableFile(relativeFile)) {
      continue;
    }

    const absolutePath = path.join(companyDataRoot, relativeFile);
    const stream = createReadStream(absolutePath, { encoding: "utf8" });
    const lineReader = readline.createInterface({
      crlfDelay: Infinity,
      input: stream,
    });
    let lineNumber = 0;

    try {
      for await (const line of lineReader) {
        const logicalLines = line.split(/\r/);

        for (const logicalLine of logicalLines) {
          lineNumber += 1;

          if (!logicalLine.trim()) {
            continue;
          }

          if (!logicalLine.toLowerCase().includes(loweredPattern)) {
            continue;
          }

          matches.push({
            file: relativeFile,
            line: lineNumber,
            text: truncateMatchText(logicalLine),
          });

          if (matches.length >= maxMatches) {
            return matches;
          }
        }
      }
    } catch {
      continue;
    } finally {
      lineReader.close();
      stream.destroy();
    }
  }

  return matches;
}

async function runRipgrepSearch(
  pattern: string,
  companyDataRoot: string,
  searchedDirectory: string,
  maxMatches: number,
) {
  const args = [
    "--with-filename",
    "--line-number",
    "--color",
    "never",
    "--fixed-strings",
    "--ignore-case",
    "--max-columns",
    String(SEARCH_RESULT_MAX_TEXT_CHARS),
    "--max-columns-preview",
    "--max-count",
    String(maxMatches),
    pattern,
    searchedDirectory,
  ];

  if (!(await isRipgrepAvailable())) {
    return runFallbackSearch(pattern, companyDataRoot, searchedDirectory, maxMatches);
  }

  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd: companyDataRoot,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
      },
      maxBuffer: 1024 * 1024,
    });

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?):(\d+):(.*)$/);

        if (!match) {
          return null;
        }

        const [, absoluteFile, lineNumber, text] = match;

        return {
          file: path.relative(companyDataRoot, absoluteFile),
          line: Number(lineNumber),
          text: truncateMatchText(text),
        } satisfies CompanyKnowledgeMatch;
      })
      .filter((match): match is CompanyKnowledgeMatch => match !== null);
  } catch (caughtError) {
    const code =
      typeof caughtError === "object" &&
      caughtError !== null &&
      "code" in caughtError
        ? caughtError.code
        : undefined;

    if (code === 1) {
      return [];
    }

    if (isCommandNotFoundError(caughtError) || isStdoutMaxBufferError(caughtError)) {
      return runFallbackSearch(pattern, companyDataRoot, searchedDirectory, maxMatches);
    }

    throw caughtError;
  }
}

async function listRelativeFiles(
  companyDataRoot: string,
  currentPath: string,
): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(companyDataRoot, entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(companyDataRoot, entryPath));
    }
  }

  return files;
}

async function readPreviewLines(absolutePath: string, maxLines: number) {
  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    crlfDelay: Infinity,
    input: stream,
  });
  const lines: string[] = [];

  try {
    for await (const line of lineReader) {
      const logicalLines = line.split(/\r/);

      for (const logicalLine of logicalLines) {
        if (!logicalLine.trim()) {
          continue;
        }

        lines.push(logicalLine.trim());

        if (lines.length >= maxLines) {
          break;
        }
      }

      if (lines.length >= maxLines) {
        break;
      }
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  return lines;
}

async function buildManifestEntry(companyDataRoot: string, relativePath: string) {
  const lowerFilePath = relativePath.toLowerCase();
  const filenameTokens = new Set<string>([
    ...tokenizeText(lowerFilePath),
    ...tokenizeText(path.basename(lowerFilePath)),
  ]);
  const tokens = new Set<string>(filenameTokens);
  const previewTokens = new Set<string>();
  let csvColumns: string[] = [];

  if (!isTextSearchableFile(relativePath)) {
    return {
      csvColumns,
      file: relativePath,
      filenameTokens,
      previewTokens,
      tokens,
    } satisfies KnowledgeFileManifestEntry;
  }

  const absolutePath = path.join(companyDataRoot, relativePath);

  try {
    const previewLines = await readPreviewLines(
      absolutePath,
      lowerFilePath.endsWith(".csv") ? 3 : 2,
    );

    if (lowerFilePath.endsWith(".csv")) {
      const [headerLine, ...previewRows] = previewLines;
      csvColumns = headerLine ? splitCsvRow(headerLine) : [];

      for (const column of csvColumns) {
        for (const token of tokenizeText(column)) {
          tokens.add(token);
          previewTokens.add(token);
        }
      }

      for (const row of previewRows) {
        for (const token of tokenizeText(row)) {
          tokens.add(token);
          previewTokens.add(token);
        }
      }
    } else {
      for (const line of previewLines) {
        for (const token of tokenizeText(line)) {
          tokens.add(token);
          previewTokens.add(token);
        }
      }
    }
  } catch {
    // Ignore preview parse issues for manifest generation.
  }

  return {
    csvColumns,
    file: relativePath,
    filenameTokens,
    previewTokens,
    tokens,
  } satisfies KnowledgeFileManifestEntry;
}

async function buildKnowledgeFileManifest(companyDataRoot: string, searchedDirectory: string) {
  const relativeFiles = await listRelativeFiles(companyDataRoot, searchedDirectory);
  const entries = await Promise.all(
    relativeFiles.map((relativePath) => buildManifestEntry(companyDataRoot, relativePath)),
  );
  const vocabulary = new Set<string>();

  for (const entry of entries) {
    for (const token of entry.tokens) {
      vocabulary.add(token);
    }
  }

  return {
    entries,
    fileCount: entries.length,
    tokenIndex: buildTokenIndex(vocabulary),
    vocabulary,
  } satisfies KnowledgeFileManifest;
}

function addManifestMatches(
  candidates: Map<string, CandidateAccumulator>,
  manifest: KnowledgeFileManifest,
  searchTerms: string[],
) {
  for (const entry of manifest.entries) {
    const matchedTerms = searchTerms.filter((term) => entry.tokens.has(term));

    if (matchedTerms.length === 0) {
      continue;
    }

    const candidate = candidates.get(entry.file) ?? createCandidateAccumulator(entry.file);

    for (const matchedTerm of matchedTerms) {
      candidate.matchedTerms.add(matchedTerm);

      if (entry.filenameTokens.has(matchedTerm)) {
        candidate.filenameMatchedTerms.add(matchedTerm);
      }
    }

    candidates.set(entry.file, candidate);
  }
}

function splitCsvRow(row: string) {
  const firstLogicalLine = row.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const cells = firstLogicalLine
    .split(",")
    .map((cell) => {
      const trimmed = cell.trim();

      if (trimmed.length <= SEARCH_RESULT_MAX_COLUMN_CHARS) {
        return trimmed;
      }

      return `${trimmed.slice(0, SEARCH_RESULT_MAX_COLUMN_CHARS).trimEnd()}…`;
    });

  return cells.slice(0, SEARCH_RESULT_MAX_COLUMNS);
}

async function buildPreview(
  companyDataRoot: string,
  relativePath: string,
): Promise<CompanyKnowledgePreview> {
  const absolutePath = path.join(companyDataRoot, relativePath);
  let previewLines: string[] = [];

  try {
    previewLines = await readPreviewLines(
      absolutePath,
      relativePath.toLowerCase().endsWith(".csv") ? 4 : 3,
    );
  } catch {
    previewLines = [];
  }

  if (relativePath.toLowerCase().endsWith(".csv")) {
    const [header, ...rows] = previewLines;

    return {
      kind: "csv",
      columns: header ? splitCsvRow(header) : [],
      rows: rows.map((row) => splitCsvRow(row)),
    };
  }

  return {
    kind: "text",
    lines: previewLines.slice(0, 3),
  };
}

async function buildCandidateFiles(
  companyDataRoot: string,
  candidates: Map<string, CandidateAccumulator>,
  queryYear?: string,
) {
  const candidateFiles = await Promise.all(
    [...candidates.values()].map(async (candidate): Promise<CompanyKnowledgeCandidateFile> => {
      const preview = await buildPreview(companyDataRoot, candidate.file);
      const matches = [...candidate.matchesByLine.values()].sort((left, right) => {
        if (left.line === right.line) {
          return left.text.localeCompare(right.text);
        }

        return left.line - right.line;
      });
      const filenameMatchCount = candidate.filenameMatchedTerms.size;
      const yearMatch =
        queryYear !== undefined &&
        (matches.some((match) => match.text.includes(queryYear)) ||
          previewContainsYear(preview, queryYear));
      const matchedTerms = [
        ...new Set([
          ...candidate.matchedTerms.values(),
          ...candidate.filenameMatchedTerms.values(),
        ]),
      ].sort();

      return {
        file: candidate.file,
        matchedTerms,
        matches,
        preview,
        score:
          candidate.exactMatchCount * 16 +
          matches.length * 10 +
          matchedTerms.length * 4 +
          filenameMatchCount * 3 +
          (yearMatch ? 25 : 0),
      };
    }),
  );

  return candidateFiles.sort((left, right) => {
    if (left.score === right.score) {
      return left.file.localeCompare(right.file);
    }

    return right.score - left.score;
  });
}

async function searchFileSystemCandidates(input: {
  companyDataRoot: string;
  manifest: KnowledgeFileManifest;
  maxMatches: number;
  normalizedQuery: string;
  queryYear?: string;
  searchedDirectory: string;
  tokenSearchTerms: string[];
}) {
  const exactMatches = await runRipgrepSearch(
    input.normalizedQuery,
    input.companyDataRoot,
    input.searchedDirectory,
    input.maxMatches,
  );
  const candidates = new Map<string, CandidateAccumulator>();

  addMatches(candidates, exactMatches, input.normalizedQuery);

  if (exactMatches.length === 0) {
    const tokenMatches = await Promise.all(
      input.tokenSearchTerms.map(async (token) => ({
        matches: await runRipgrepSearch(token, input.companyDataRoot, input.searchedDirectory, 3),
        token,
      })),
    );

    for (const { matches, token } of tokenMatches) {
      addMatches(candidates, matches, token);
    }

    addManifestMatches(candidates, input.manifest, input.tokenSearchTerms);
  }

  return {
    candidateFiles: await buildCandidateFiles(
      input.companyDataRoot,
      candidates,
      input.queryYear,
    ),
    exactMatchCount: exactMatches.length,
  } satisfies FileSystemCandidateSearchResult;
}

function getPreviewLinesFromText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildPdfExcerpt(chunkText: string, query: string, searchTokens: string[]) {
  const chunkLower = chunkText.toLowerCase();
  const exactQuery = query.trim().toLowerCase();
  const exactQueryIndex = exactQuery ? chunkLower.indexOf(exactQuery) : -1;
  const tokenIndex = searchTokens
    .map((token) => chunkLower.indexOf(token))
    .find((index) => index >= 0);
  const matchIndex = exactQueryIndex >= 0 ? exactQueryIndex : (tokenIndex ?? -1);
  const snippetStart = matchIndex >= 0 ? Math.max(0, matchIndex - 80) : 0;
  const snippetEnd =
    matchIndex >= 0 ? Math.min(chunkText.length, matchIndex + 240) : Math.min(chunkText.length, 240);
  const excerpt = chunkText.slice(snippetStart, snippetEnd).trim();
  const previewLines = getPreviewLinesFromText(excerpt || chunkText);

  return previewLines.length > 0 ? previewLines : ["No preview available."];
}

async function searchIndexedPdfCandidates(
  query: string,
  organizationId: string,
  role: UserRole,
  queryYear?: string,
  additionalSearchTerms: string[] = [],
) {
  const db = await getAppDatabase();
  const searchTokens = [...new Set([...tokenizeQuery(query), ...additionalSearchTerms])];
  const normalizedQuery = query.trim().toLowerCase();
  const whereClauses = [
    eq(documents.organizationId, organizationId),
    inArray(documents.sourceType, [...KNOWLEDGE_MANAGED_SOURCE_TYPES]),
    eq(documents.mimeType, "application/pdf"),
    eq(documents.ingestionStatus, "ready"),
  ];

  if (!canRoleAccessKnowledgeScope(role, "admin")) {
    whereClauses.push(eq(documents.accessScope, "public"));
  }

  const rows = await db
    .select({
      chunkText: documentChunks.chunkText,
      sourcePath: documents.sourcePath,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(...whereClauses));

  const candidates = new Map<
    string,
    {
      exactMatchCount: number;
      filenameMatchedTerms: Set<string>;
      matchedTerms: Set<string>;
      matches: CompanyKnowledgeMatch[];
      previewLines: string[];
      score: number;
    }
  >();

  for (const row of rows) {
    const basename = path.basename(row.sourcePath).toLowerCase();
    const chunkText = row.chunkText.trim();
    const chunkTextLower = chunkText.toLowerCase();
    const filenameMatchedTerms = searchTokens.filter((token) => basename.includes(token));
    const matchedTerms = searchTokens.filter((token) => chunkTextLower.includes(token));
    const exactMatch = normalizedQuery.length > 0 && chunkTextLower.includes(normalizedQuery);

    if (!exactMatch && matchedTerms.length === 0 && filenameMatchedTerms.length === 0) {
      continue;
    }

    const candidate = candidates.get(row.sourcePath) ?? {
      exactMatchCount: 0,
      filenameMatchedTerms: new Set<string>(),
      matchedTerms: new Set<string>(),
      matches: [],
      previewLines: [],
      score: 0,
    };

    if (exactMatch) {
      candidate.exactMatchCount += 1;
      candidate.matchedTerms.add(query.trim());
    }

    for (const matchedTerm of matchedTerms) {
      candidate.matchedTerms.add(matchedTerm);
    }

    for (const filenameMatchedTerm of filenameMatchedTerms) {
      candidate.filenameMatchedTerms.add(filenameMatchedTerm);
    }

    const previewLines = buildPdfExcerpt(chunkText, query, searchTokens);
    const previewText = previewLines.join(" ");

    if (
      previewText &&
      !candidate.matches.some((match) => match.text === previewText && match.file === row.sourcePath)
    ) {
      candidate.matches.push({
        file: row.sourcePath,
        line: 1,
        text: previewText,
      });
    }

    if (candidate.previewLines.length === 0 || exactMatch) {
      candidate.previewLines = previewLines;
    }

    const yearMatch =
      queryYear !== undefined &&
      (chunkText.includes(queryYear) || previewLines.some((line) => line.includes(queryYear)));

    candidate.score =
      candidate.exactMatchCount * 16 +
      candidate.matches.length * 10 +
      candidate.matchedTerms.size * 4 +
      candidate.filenameMatchedTerms.size * 3 +
      (yearMatch ? 25 : 0);

    candidates.set(row.sourcePath, candidate);
  }

  return [...candidates.entries()]
    .map(([file, candidate]) => ({
      file,
      matchedTerms: [...new Set([...candidate.matchedTerms, ...candidate.filenameMatchedTerms])].sort(),
      matches: candidate.matches,
      preview: {
        kind: "text" as const,
        lines: candidate.previewLines.slice(0, 3),
      },
      score: candidate.score,
    }))
    .sort((left, right) => {
      if (left.score === right.score) {
        return left.file.localeCompare(right.file);
      }

      return right.score - left.score;
    });
}

function mergeCandidateFiles(
  primaryCandidates: CompanyKnowledgeCandidateFile[],
  secondaryCandidates: CompanyKnowledgeCandidateFile[],
) {
  const merged = new Map(primaryCandidates.map((candidate) => [candidate.file, candidate]));

  for (const candidate of secondaryCandidates) {
    const existing = merged.get(candidate.file);

    if (!existing) {
      merged.set(candidate.file, candidate);
      continue;
    }

    const matches = [...existing.matches];

    for (const match of candidate.matches) {
      if (
        !matches.some(
          (existingMatch) =>
            existingMatch.file === match.file &&
            existingMatch.line === match.line &&
            existingMatch.text === match.text,
        )
      ) {
        matches.push(match);
      }
    }

    merged.set(candidate.file, {
      ...existing,
      matchedTerms: [...new Set([...existing.matchedTerms, ...candidate.matchedTerms])].sort(),
      matches: matches.sort((left, right) => {
        if (left.line === right.line) {
          return left.text.localeCompare(right.text);
        }

        return left.line - right.line;
      }),
      preview: candidate.score > existing.score ? candidate.preview : existing.preview,
      score: Math.max(existing.score, candidate.score),
    });
  }

  return [...merged.values()].sort((left, right) => {
    if (left.score === right.score) {
      return left.file.localeCompare(right.file);
    }

    return right.score - left.score;
  });
}

function pickSelectedFile(
  queryYear: string | undefined,
  candidateFiles: CompanyKnowledgeCandidateFile[],
) {
  if (candidateFiles.length === 0) {
    return {
      recommendedFiles: [],
      selectedFiles: [],
      selectionReason: "no-match" as const,
      selectionRequired: false,
    };
  }

  if (candidateFiles.length === 1) {
    return {
      recommendedFiles: [candidateFiles[0]!.file],
      selectedFiles: [candidateFiles[0]!.file],
      selectionReason: "single-candidate" as const,
      selectionRequired: false,
    };
  }

  if (queryYear) {
    const matchingYearCandidates = candidateFiles.filter((candidate) => {
      return (
        candidate.matches.some((match) => match.text.includes(queryYear)) ||
        previewContainsYear(candidate.preview, queryYear)
      );
    });

    const informativeYearCandidates = matchingYearCandidates.filter((candidate) =>
      candidate.matchedTerms.some((term) => term !== queryYear),
    );

    if (informativeYearCandidates.length === 1) {
      return {
        recommendedFiles: [informativeYearCandidates[0]!.file],
        selectedFiles: [informativeYearCandidates[0]!.file],
        selectionReason: "unique-year-match" as const,
        selectionRequired: false,
      };
    }

    if (matchingYearCandidates.length === 1) {
      return {
        recommendedFiles: [matchingYearCandidates[0]!.file],
        selectedFiles: [matchingYearCandidates[0]!.file],
        selectionReason: "unique-year-match" as const,
        selectionRequired: false,
      };
    }
  }

  const [topCandidate, secondCandidate] = candidateFiles;
  const recommendedFiles =
    topCandidate &&
    (!secondCandidate || topCandidate.score >= secondCandidate.score + 10)
      ? [topCandidate.file]
      : [];

  return {
    recommendedFiles,
    selectedFiles: [],
    selectionReason: "multiple-candidates" as const,
    selectionRequired: true,
  };
}

function shouldPreferCandidateSet(
  currentCandidates: CompanyKnowledgeCandidateFile[],
  nextCandidates: CompanyKnowledgeCandidateFile[],
) {
  if (currentCandidates.length === 0) {
    return nextCandidates.length > 0;
  }

  if (nextCandidates.length === 0) {
    return false;
  }

  const currentTopScore = currentCandidates[0]?.score ?? 0;
  const nextTopScore = nextCandidates[0]?.score ?? 0;

  if (nextTopScore >= currentTopScore + 4) {
    return true;
  }

  if (nextCandidates.length > currentCandidates.length + 1) {
    return true;
  }

  return false;
}

export async function searchCompanyKnowledge(
  query: string,
  organizationId: string,
  organizationSlug: string,
  role: UserRole,
  maxMatches = DEFAULT_MAX_MATCHES,
): Promise<CompanyKnowledgeSearchResult> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query must not be empty.");
  }

  const companyDataRoot = await resolveCompanyDataRoot(organizationSlug);
  const searchedDirectory =
    canRoleAccessKnowledgeScope(role, "admin")
      ? companyDataRoot
      : path.join(companyDataRoot, "public");
  const manifest = await buildKnowledgeFileManifest(companyDataRoot, searchedDirectory);
  const queryTokens = tokenizeQuery(normalizedQuery);
  const queryExpansion = expandQueryTokens(queryTokens, manifest);
  const queryYear = extractQueryYear(normalizedQuery);
  const primaryFileSearch = await searchFileSystemCandidates({
    companyDataRoot,
    manifest,
    maxMatches,
    normalizedQuery,
    queryYear,
    searchedDirectory,
    tokenSearchTerms: queryExpansion.tokenSearchTerms,
  });
  const primaryPdfCandidates = await searchIndexedPdfCandidates(
    normalizedQuery,
    organizationId,
    role,
    queryYear,
    queryExpansion.tokenSearchTerms,
  );
  let candidateFiles = mergeCandidateFiles(
    primaryFileSearch.candidateFiles,
    primaryPdfCandidates,
  );
  let aiSuggestedTerms: string[] = [];
  let aiRewriteApplied = false;

  if (shouldAttemptAiRewrite({
    candidateFiles,
    exactMatchCount: primaryFileSearch.exactMatchCount,
  })) {
    aiSuggestedTerms = await suggestSearchTermsWithAi({
      manifest,
      normalizedQuery,
      seedTerms: queryExpansion.tokenSearchTerms,
    });

    if (aiSuggestedTerms.length > 0) {
      aiRewriteApplied = true;
      const aiExpandedTerms = [
        ...new Set([...queryExpansion.tokenSearchTerms, ...aiSuggestedTerms]),
      ].slice(0, MAX_EXPANDED_SEARCH_TERMS);
      const aiFileSearch = await searchFileSystemCandidates({
        companyDataRoot,
        manifest,
        maxMatches,
        normalizedQuery,
        queryYear,
        searchedDirectory,
        tokenSearchTerms: aiExpandedTerms,
      });
      const aiPdfCandidates = await searchIndexedPdfCandidates(
        normalizedQuery,
        organizationId,
        role,
        queryYear,
        aiExpandedTerms,
      );
      const aiCandidateFiles = mergeCandidateFiles(aiFileSearch.candidateFiles, aiPdfCandidates);

      if (shouldPreferCandidateSet(candidateFiles, aiCandidateFiles)) {
        candidateFiles = aiCandidateFiles;
      }
    }
  }

  const selection = pickSelectedFile(queryYear, candidateFiles);

  return {
    candidateFiles,
    matches: candidateFiles.flatMap((candidate) => candidate.matches),
    queryDiagnostics: {
      aiRewriteApplied,
      aiSuggestedTerms,
      correctedTerms: queryExpansion.correctedTerms,
      expandedTerms: queryExpansion.expandedTerms,
      manifestFileCount: manifest.fileCount,
    },
    recommendedFiles: selection.recommendedFiles,
    searchedDirectory,
    scopeDescription: getScopeDescription(role),
    selectedFiles: selection.selectedFiles,
    selectionReason: selection.selectionReason,
    selectionRequired: selection.selectionRequired,
  };
}
