import "server-only";

import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeSlugSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyOrganizationName(value: string) {
  const slug = normalizeSlugSegment(value);

  return slug || "critjecture-demo";
}

async function resolvePackageRootByName(packageName: string) {
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd()),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), ".."),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../.."),
  ];

  for (const candidate of candidates) {
    const packageJsonPath = path.join(candidate, "package.json");

    if (!(await pathExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readFile(packageJsonPath, "utf8").catch(() => "");

    if (packageJson.includes(`"name": "${packageName}"`)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate package root for ${packageName}.`);
}

export async function resolveRepositoryRoot() {
  return resolvePackageRootByName("critjecture-workspace");
}

export async function resolveWebRoot() {
  return resolvePackageRootByName("web");
}

function parseConfiguredFilePath(value: string, baseDir: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("file:")) {
    return fileURLToPath(new URL(trimmed));
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error(
      "Step 10 supports SQLite file-backed DATABASE_URL values only. Use a filesystem path or file: URL.",
    );
  }

  return path.resolve(baseDir, trimmed);
}

export async function resolveStorageRoot() {
  const repositoryRoot = await resolveRepositoryRoot();
  const configuredPath = parseConfiguredFilePath(
    process.env.CRITJECTURE_STORAGE_ROOT ?? "",
    repositoryRoot,
  );

  if (configuredPath) {
    return configuredPath;
  }

  return path.join(repositoryRoot, "storage");
}

export async function ensureStorageRoot() {
  const storageRoot = await resolveStorageRoot();
  await mkdir(storageRoot, { recursive: true });

  return storageRoot;
}

export async function resolveLegacyDatabaseFilePath() {
  const repositoryRoot = await resolveRepositoryRoot();
  const configuredPath = parseConfiguredFilePath(
    process.env.CRITJECTURE_LEGACY_DATABASE_URL ?? process.env.LEGACY_DATABASE_URL ?? "",
    repositoryRoot,
  );

  if (configuredPath) {
    return configuredPath;
  }

  const storageRoot = await ensureStorageRoot();

  return path.join(storageRoot, "critjecture.sqlite");
}

export async function resolveDatabaseFilePath() {
  const repositoryRoot = await resolveRepositoryRoot();
  const configuredPath = parseConfiguredFilePath(
    process.env.DATABASE_URL ?? process.env.CRITJECTURE_V2_DATABASE_URL ?? "",
    repositoryRoot,
  );

  if (configuredPath) {
    return configuredPath;
  }

  const storageRoot = await ensureStorageRoot();

  return path.join(storageRoot, "critjecture-v2.sqlite");
}

export function getDefaultOrganizationName() {
  return (process.env.CRITJECTURE_ORGANIZATION_NAME ?? "").trim() || "Critjecture Demo";
}

export function getDefaultOrganizationSlug() {
  return slugifyOrganizationName(
    (process.env.CRITJECTURE_ORGANIZATION_SLUG ?? "").trim() || getDefaultOrganizationName(),
  );
}

export async function resolveOrganizationStorageRoot(organizationSlug: string) {
  const normalizedSlug = slugifyOrganizationName(organizationSlug);
  const storageRoot = await ensureStorageRoot();

  return path.join(storageRoot, "organizations", normalizedSlug);
}

export async function ensureOrganizationCompanyDataRoot(organizationSlug: string) {
  const organizationRoot = await resolveOrganizationStorageRoot(organizationSlug);
  const companyDataRoot = path.join(organizationRoot, "company_data");

  await mkdir(companyDataRoot, { recursive: true });

  return companyDataRoot;
}

export async function ensureOrganizationGeneratedAssetsRoot(organizationSlug: string) {
  const organizationRoot = await resolveOrganizationStorageRoot(organizationSlug);
  const generatedAssetsRoot = path.join(organizationRoot, "generated_assets");

  await mkdir(generatedAssetsRoot, { recursive: true });

  return generatedAssetsRoot;
}

export async function ensureOrganizationKnowledgeStagingRoot(organizationSlug: string) {
  const organizationRoot = await resolveOrganizationStorageRoot(organizationSlug);
  const knowledgeStagingRoot = path.join(organizationRoot, "knowledge_staging");

  await mkdir(knowledgeStagingRoot, { recursive: true });

  return knowledgeStagingRoot;
}

export async function ensureOrganizationGovernanceRoot(organizationSlug: string) {
  const organizationRoot = await resolveOrganizationStorageRoot(organizationSlug);
  const governanceRoot = path.join(organizationRoot, "governance");

  await mkdir(governanceRoot, { recursive: true });

  return governanceRoot;
}
