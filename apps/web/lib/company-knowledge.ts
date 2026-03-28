import "server-only";

import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

import { resolveCompanyDataRoot } from "@/lib/company-data";
import type {
  CompanyKnowledgeCandidateFile,
  CompanyKnowledgeMatch,
  CompanyKnowledgePreview,
  CompanyKnowledgeSearchResult,
} from "@/lib/company-knowledge-types";
import type { UserRole } from "@/lib/roles";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_MATCHES = 6;
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

type CandidateAccumulator = {
  file: string;
  filenameMatchedTerms: Set<string>;
  matchedTerms: Set<string>;
  matchesByLine: Map<string, CompanyKnowledgeMatch>;
};

function getScopeDescription(role: UserRole) {
  return role === "owner"
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
      matchedTerms: new Set<string>(),
      matchesByLine: new Map<string, CompanyKnowledgeMatch>(),
    };

    candidate.matchedTerms.add(matchedTerm);
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
    "--max-count",
    String(maxMatches),
    pattern,
    searchedDirectory,
  ];

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
          text: text.trim(),
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
      if (!line.trim()) {
        continue;
      }

      lines.push(line.trim());

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
  return row.split(",").map((cell) => cell.trim());
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

function pickSelectedFile(
  queryYear: string | undefined,
  candidateFiles: CompanyKnowledgeCandidateFile[],
) {
  if (candidateFiles.length === 0) {
    return {
      selectedFile: undefined,
      selectionReason: "no-match" as const,
      selectionRequired: false,
    };
  }

  if (candidateFiles.length === 1) {
    return {
      selectedFile: candidateFiles[0]?.file,
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
        selectedFile: informativeYearCandidates[0]?.file,
        selectionReason: "unique-year-match" as const,
        selectionRequired: false,
      };
    }

    if (matchingYearCandidates.length === 1) {
      return {
        selectedFile: matchingYearCandidates[0]?.file,
        selectionReason: "unique-year-match" as const,
        selectionRequired: false,
      };
    }
  }

  return {
    selectedFile: undefined,
    selectionReason: "multiple-candidates" as const,
    selectionRequired: true,
  };
}

export async function searchCompanyKnowledge(
  query: string,
  role: UserRole,
  maxMatches = DEFAULT_MAX_MATCHES,
): Promise<CompanyKnowledgeSearchResult> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("Search query must not be empty.");
  }

  const companyDataRoot = await resolveCompanyDataRoot();
  const searchedDirectory =
    role === "owner"
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
  const candidateFiles = await buildCandidateFiles(companyDataRoot, candidates, queryYear);
  const selection = pickSelectedFile(queryYear, candidateFiles);

  return {
    candidateFiles,
    matches: candidateFiles.flatMap((candidate) => candidate.matches),
    searchedDirectory,
    scopeDescription: getScopeDescription(role),
    selectedFile: selection.selectedFile,
    selectionReason: selection.selectionReason,
    selectionRequired: selection.selectionRequired,
  };
}
