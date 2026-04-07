import "server-only";

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { getAppDatabase } from "@/lib/app-db";
import { documentChunks, documents } from "@/lib/app-schema";
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

type CandidateAccumulator = {
  file: string;
  filenameMatchedTerms: Set<string>;
  exactMatchCount: number;
  matchedTerms: Set<string>;
  matchesByLine: Map<string, CompanyKnowledgeMatch>;
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

function tokenizeQuery(query: string) {
  return [
    ...new Set(
      query
        .match(/[a-z0-9_]+/gi)
        ?.flatMap((token) => normalizeSearchToken(token)) ?? [],
    ),
  ];
}

function addMatches(
  candidates: Map<string, CandidateAccumulator>,
  matches: CompanyKnowledgeMatch[],
  matchedTerm: string,
) {
  for (const match of matches) {
    const candidate = candidates.get(match.file) ?? {
      file: match.file,
      filenameMatchedTerms: new Set<string>(),
      exactMatchCount: 0,
      matchedTerms: new Set<string>(),
      matchesByLine: new Map<string, CompanyKnowledgeMatch>(),
    };

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
  const entries = await readdir(currentPath, { withFileTypes: true });
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
  const previewLines = await readPreviewLines(
    absolutePath,
    relativePath.toLowerCase().endsWith(".csv") ? 4 : 3,
  );

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
) {
  const db = await getAppDatabase();
  const searchTokens = tokenizeQuery(query);
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
  const exactMatches = await runRipgrepSearch(
    normalizedQuery,
    companyDataRoot,
    searchedDirectory,
    maxMatches,
  );
  const candidates = new Map<string, CandidateAccumulator>();

  addMatches(candidates, exactMatches, normalizedQuery);

  if (exactMatches.length === 0) {
    const searchTokens = tokenizeQuery(normalizedQuery);
    const tokenMatches = await Promise.all(
      searchTokens.map(async (token) => ({
        matches: await runRipgrepSearch(token, companyDataRoot, searchedDirectory, 3),
        token,
      })),
    );

    for (const { matches, token } of tokenMatches) {
      addMatches(candidates, matches, token);
    }

    const relativeFiles = await listRelativeFiles(companyDataRoot, searchedDirectory);

    for (const relativeFile of relativeFiles) {
      const basename = path.basename(relativeFile).toLowerCase();
      const filenameMatches = searchTokens.filter((token) => basename.includes(token));

      if (filenameMatches.length === 0) {
        continue;
      }

      const candidate = candidates.get(relativeFile) ?? {
        file: relativeFile,
        filenameMatchedTerms: new Set<string>(),
        exactMatchCount: 0,
        matchedTerms: new Set<string>(),
        matchesByLine: new Map<string, CompanyKnowledgeMatch>(),
      };

      for (const token of filenameMatches) {
        candidate.filenameMatchedTerms.add(token);
      }

      candidates.set(relativeFile, candidate);
    }
  }

  const queryYear = extractQueryYear(normalizedQuery);
  const fileSystemCandidates = await buildCandidateFiles(companyDataRoot, candidates, queryYear);
  const indexedPdfCandidates = await searchIndexedPdfCandidates(
    normalizedQuery,
    organizationId,
    role,
    queryYear,
  );
  const candidateFiles = mergeCandidateFiles(fileSystemCandidates, indexedPdfCandidates);
  const selection = pickSelectedFile(queryYear, candidateFiles);

  return {
    candidateFiles,
    matches: candidateFiles.flatMap((candidate) => candidate.matches),
    recommendedFiles: selection.recommendedFiles,
    searchedDirectory,
    scopeDescription: getScopeDescription(role),
    selectedFiles: selection.selectedFiles,
    selectionReason: selection.selectionReason,
    selectionRequired: selection.selectionRequired,
  };
}
