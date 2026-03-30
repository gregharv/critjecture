import "server-only";

import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { ensureOrganizationCompanyDataRoot } from "@/lib/app-paths";
import { assertManagedKnowledgeDocumentReady } from "@/lib/knowledge-document-access";
import type { UserRole } from "@/lib/roles";

export async function resolveCompanyDataRoot(organizationSlug: string) {
  return ensureOrganizationCompanyDataRoot(organizationSlug);
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
  const scope =
    relativePath === "public" || relativePath.startsWith("public/")
      ? "public"
      : "admin";

  if (canRoleAccessKnowledgeScope(role, scope)) {
    return;
  }

  throw new Error("This role may only access files inside company_data/public.");
}

export async function resolveAuthorizedCompanyDataFile(
  relativePath: string,
  organizationSlug: string,
  role: UserRole,
  organizationId?: string,
) {
  const companyDataRoot = await resolveCompanyDataRoot(organizationSlug);
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

  if (organizationId) {
    await assertManagedKnowledgeDocumentReady({
      organizationId,
      relativePath: normalizedRelativePath,
    });
  }

  return {
    absolutePath,
    companyDataRoot,
    relativePath: normalizedRelativePath,
  };
}
