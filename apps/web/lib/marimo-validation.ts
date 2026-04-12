import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import { normalizeCsvLineEndings } from "@/lib/knowledge-ingestion";
import type { UserRole } from "@/lib/roles";
import { SANDBOX_WORKSPACE_DIR } from "@/lib/sandbox-policy";
import type { StagedSandboxFile } from "@/lib/python-sandbox";
import { validateCsvAnalysisCode } from "@/lib/python-sandbox";

export class MarimoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarimoValidationError";
  }
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new MarimoValidationError(message);
  }
}

function isAllowedOutputPath(value: string) {
  return value === "outputs" || value.startsWith("outputs/");
}

function normalizeNotebookPathLiteral(value: string) {
  const normalized = value.replace(/\\/g, "/").trim();

  if (!normalized) {
    throw new MarimoValidationError("Notebook file paths must be non-empty.");
  }

  if (normalized.startsWith("/")) {
    throw new MarimoValidationError(
      `Notebook file paths must be relative to the workspace. Received absolute path: ${value}`,
    );
  }

  const segments = normalized.split("/");

  if (segments.some((segment) => segment === "..")) {
    throw new MarimoValidationError(
      `Notebook file paths must stay inside the workspace. Invalid path: ${value}`,
    );
  }

  return normalized;
}

function validateRequiredStructure(notebookSource: string) {
  ensure(/(^|\n)\s*import marimo\s*$/m.test(notebookSource), "Notebook must import marimo.");
  ensure(/(^|\n)\s*app\s*=\s*marimo\.App\s*\(/m.test(notebookSource), "Notebook must define app = marimo.App(...).");
  ensure(/@app\.cell(?:\([^)]*\))?/m.test(notebookSource), "Notebook must define at least one @app.cell.");
  ensure(
    /if __name__ == ["']__main__["']:\s*\n\s+app\.run\(\)/m.test(notebookSource),
    'Notebook must end with if __name__ == "__main__": app.run().',
  );
}

function validateLibraryUsage(notebookSource: string) {
  ensure(/(^|\n)\s*import polars as pl\s*$/m.test(notebookSource), "Notebook must import polars as pl.");

  if (/\b(?:import|from)\s+pandas\b/i.test(notebookSource) || /\bpd\.read_csv\s*\(/i.test(notebookSource)) {
    throw new MarimoValidationError(
      "Notebook analysis must use Polars LazyFrames. pandas and pd.read_csv(...) are not allowed.",
    );
  }

  if (/\bpl\.read_csv\s*\(/i.test(notebookSource)) {
    throw new MarimoValidationError(
      "Notebook analysis must use pl.scan_csv(...). Eager pl.read_csv(...) is not allowed.",
    );
  }

  if (/company_data\//i.test(notebookSource)) {
    throw new MarimoValidationError(
      "Notebook code must read staged files from inputs/ instead of referencing company_data/ paths directly.",
    );
  }

  const referencesInputs = /["']inputs\//.test(notebookSource) || /Path\(["']inputs["']\)/.test(notebookSource);

  if (referencesInputs) {
    ensure(/\bpl\.scan_csv\s*\(/i.test(notebookSource), "Notebook CSV analysis must use pl.scan_csv(...).");
    ensure(/\.collect\s*\(/i.test(notebookSource), "Notebook CSV analysis must call .collect() before presenting results.");
  }
}

function validateOpenWrites(notebookSource: string) {
  const openWritePattern = /\bopen\(\s*(["'])(.*?)\1\s*,\s*(["'])(.*?)\3/g;

  for (const match of notebookSource.matchAll(openWritePattern)) {
    const rawPath = match[2];
    const mode = match[4];

    if (!/[wax+]/.test(mode)) {
      continue;
    }

    const normalizedPath = normalizeNotebookPathLiteral(rawPath);
    ensure(
      isAllowedOutputPath(normalizedPath),
      `Notebook may write files only under outputs/. Invalid write target: ${rawPath}`,
    );
  }
}

function validatePathWrites(notebookSource: string) {
  const pathWritePattern = /Path\(\s*(["'])(.*?)\1\s*\)\.(write_text|write_bytes|mkdir|touch)\s*\(/g;

  for (const match of notebookSource.matchAll(pathWritePattern)) {
    const rawPath = match[2];
    const normalizedPath = normalizeNotebookPathLiteral(rawPath);

    ensure(
      isAllowedOutputPath(normalizedPath),
      `Notebook may create or write files only under outputs/. Invalid target: ${rawPath}`,
    );
  }
}

function validateCommonWriteCalls(notebookSource: string) {
  const directWritePattern = /\.(savefig|write_csv|write_json|write_ndjson|write_parquet|write_excel|save)\(\s*(["'])(.*?)\2/g;

  for (const match of notebookSource.matchAll(directWritePattern)) {
    const rawPath = match[3];
    const normalizedPath = normalizeNotebookPathLiteral(rawPath);

    ensure(
      isAllowedOutputPath(normalizedPath),
      `Notebook may save generated artifacts only under outputs/. Invalid target: ${rawPath}`,
    );
  }
}

function validateNoWritesToInputs(notebookSource: string) {
  if (/\bopen\(\s*(["'])inputs\//.test(notebookSource) && /\bopen\([\s\S]*?,\s*(["']).*[wax+].*\1\s*\)/.test(notebookSource)) {
    throw new MarimoValidationError("inputs/ is read-only. Notebook code must never write under inputs/.");
  }

  if (/Path\(\s*(["'])inputs\//.test(notebookSource) && /\.(write_text|write_bytes|mkdir|touch)\s*\(/.test(notebookSource)) {
    throw new MarimoValidationError("inputs/ is read-only. Notebook code must never create or write files under inputs/.");
  }

  if (/\.(savefig|write_csv|write_json|write_ndjson|write_parquet|write_excel|save)\(\s*(["'])inputs\//.test(notebookSource)) {
    throw new MarimoValidationError("inputs/ is read-only. Notebook code must never save files under inputs/.");
  }
}

export async function validateMarimoNotebookSource(input: {
  notebookSource: string;
  stagedFiles?: StagedSandboxFile[];
  workspaceDir?: string;
}) {
  const notebookSource = input.notebookSource.trim();

  ensure(notebookSource.length > 0, "Notebook source must be a non-empty string.");

  validateRequiredStructure(notebookSource);
  validateNoWritesToInputs(notebookSource);
  validateLibraryUsage(notebookSource);
  validateOpenWrites(notebookSource);
  validatePathWrites(notebookSource);
  validateCommonWriteCalls(notebookSource);

  if (input.stagedFiles && input.workspaceDir) {
    const stagedCsvFiles = input.stagedFiles.filter((file) => file.stagedPath.toLowerCase().endsWith(".csv"));

    if (stagedCsvFiles.length > 0 && /\bpl\.scan_csv\s*\(/i.test(notebookSource)) {
      await validateCsvAnalysisCode(notebookSource, stagedCsvFiles, input.workspaceDir);
    }
  }
}

export async function preflightValidateMarimoNotebookSource(input: {
  inputFiles?: string[];
  notebookSource: string;
  organizationId: string;
  organizationSlug: string;
  role: UserRole;
}) {
  const workspaceDir = path.join(SANDBOX_WORKSPACE_DIR, `marimo-preflight-${randomUUID()}`);
  const uniqueInputFiles = [...new Set((input.inputFiles ?? []).map((value) => value.trim()).filter(Boolean))];
  const stagedFiles: StagedSandboxFile[] = [];

  try {
    await mkdir(workspaceDir, { recursive: true });

    for (const requestedPath of uniqueInputFiles) {
      const resolvedFile = await resolveAuthorizedCompanyDataFile(
        requestedPath,
        input.organizationSlug,
        input.role,
        input.organizationId,
      );
      const stagedPath = path.posix.join("inputs", resolvedFile.relativePath);
      const stagedAbsolutePath = path.join(workspaceDir, ...stagedPath.split("/"));

      await mkdir(path.dirname(stagedAbsolutePath), { recursive: true });

      if (resolvedFile.relativePath.toLowerCase().endsWith(".csv")) {
        const sourceBuffer = await readFile(resolvedFile.absolutePath);
        await writeFile(stagedAbsolutePath, normalizeCsvLineEndings(sourceBuffer));
      } else {
        await copyFile(resolvedFile.absolutePath, stagedAbsolutePath);
      }

      stagedFiles.push({
        sourcePath: resolvedFile.relativePath,
        stagedPath,
      });
    }

    await validateMarimoNotebookSource({
      notebookSource: input.notebookSource,
      stagedFiles,
      workspaceDir,
    });
  } finally {
    await rm(workspaceDir, { force: true, recursive: true }).catch(() => undefined);
  }
}
