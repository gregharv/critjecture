import "server-only";

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { UserRole } from "@/lib/roles";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_MATCHES = 6;

export type CompanyKnowledgeMatch = {
  file: string;
  line: number;
  text: string;
};

export type CompanyKnowledgeSearchResult = {
  matches: CompanyKnowledgeMatch[];
  searchedDirectory: string;
  scopeDescription: string;
};

async function pathExists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveCompanyDataRoot() {
  const candidates = [
    path.resolve(process.cwd(), "company_data"),
    path.resolve(process.cwd(), "../company_data"),
    path.resolve(process.cwd(), "../../company_data"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate the company_data directory. Expected it near the repository root.",
  );
}

function getScopeDescription(role: UserRole) {
  return role === "owner"
    ? "all company_data files"
    : "public company_data files only";
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

  const args = [
    "--with-filename",
    "--line-number",
    "--color",
    "never",
    "--ignore-case",
    "--max-count",
    String(maxMatches),
    normalizedQuery,
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

    const matches = stdout
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

    return {
      matches,
      searchedDirectory,
      scopeDescription: getScopeDescription(role),
    };
  } catch (caughtError) {
    const code =
      typeof caughtError === "object" &&
      caughtError !== null &&
      "code" in caughtError
        ? caughtError.code
        : undefined;

    if (code === 1) {
      return {
        matches: [],
        searchedDirectory,
        scopeDescription: getScopeDescription(role),
      };
    }

    throw caughtError;
  }
}
