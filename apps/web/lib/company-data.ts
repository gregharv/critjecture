import "server-only";

import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { UserRole } from "@/lib/roles";

async function pathExists(targetPath: string) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCompanyDataRoot() {
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "company_data"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../company_data"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../../company_data"),
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

export function normalizeCompanyDataRelativePath(relativePath: string) {
  const trimmed = relativePath.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error("Input file paths must be non-empty strings.");
  }

  if (trimmed.startsWith("/")) {
    throw new Error("Input file paths must be relative to company_data.");
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Input file paths must stay inside company_data.");
  }

  return normalized;
}

function assertRoleAllowsCompanyDataPath(relativePath: string, role: UserRole) {
  if (role === "owner") {
    return;
  }

  if (relativePath === "public" || relativePath.startsWith("public/")) {
    return;
  }

  throw new Error("Intern role may only access files inside company_data/public.");
}

export async function resolveAuthorizedCompanyDataFile(
  relativePath: string,
  role: UserRole,
) {
  const companyDataRoot = await resolveCompanyDataRoot();
  const normalizedRelativePath = normalizeCompanyDataRelativePath(relativePath);

  assertRoleAllowsCompanyDataPath(normalizedRelativePath, role);

  const absolutePath = path.resolve(companyDataRoot, normalizedRelativePath);
  const relativeFromRoot = path.relative(companyDataRoot, absolutePath);

  if (
    relativeFromRoot === "" ||
    relativeFromRoot === ".." ||
    relativeFromRoot.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Input file paths must stay inside company_data.");
  }

  let fileStats;

  try {
    fileStats = await stat(absolutePath);
  } catch {
    throw new Error(`Company data file not found: ${normalizedRelativePath}`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Company data path is not a file: ${normalizedRelativePath}`);
  }

  await access(absolutePath, fsConstants.R_OK);

  return {
    absolutePath,
    companyDataRoot,
    relativePath: normalizedRelativePath,
  };
}
