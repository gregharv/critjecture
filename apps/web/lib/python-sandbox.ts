import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";

const execFileAsync = promisify(execFile);
const SANDBOX_WORKSPACE_DIR = "/tmp/workspace";
const SANDBOX_OUTPUTS_DIR = "outputs";
const SANDBOX_TIMEOUT_MS = 10_000;
const SANDBOX_MAX_BUFFER = 1024 * 1024;
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GENERATED_ASSET_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
};

export type StagedSandboxFile = {
  sourcePath: string;
  stagedPath: string;
};

export type GeneratedSandboxAsset = {
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

export type SandboxedCommandResult = {
  exitCode: number;
  generatedAssets: GeneratedSandboxAsset[];
  pythonExecutable: string;
  runId: string;
  stagedFiles: StagedSandboxFile[];
  stderr: string;
  stdout: string;
  workspaceDir: string;
};

export class SandboxExecutionError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(message: string, options: { exitCode: number; stderr: string; stdout: string }) {
    super(message);
    this.name = "SandboxExecutionError";
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
  }
}

export class SandboxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxValidationError";
  }
}

async function pathExists(targetPath: string, mode = fsConstants.R_OK) {
  try {
    await access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}

function getGeneratedAssetMimeType(relativePath: string) {
  return GENERATED_ASSET_MIME_TYPES[path.extname(relativePath).toLowerCase()] ?? null;
}

function getSandboxRunId(workspaceDir: string) {
  return path.basename(workspaceDir);
}

function buildGeneratedAssetDownloadUrl(runId: string, relativePath: string) {
  const encodedRelativePath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/api/generated-files/${runId}/${encodedRelativePath}`;
}

function normalizeGeneratedAssetRelativePath(relativePath: string) {
  const trimmed = relativePath.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error("Generated asset path must not be empty.");
  }

  if (trimmed.startsWith("/")) {
    throw new Error("Generated asset path must be relative to the sandbox workspace.");
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Generated asset path must stay inside the sandbox workspace.");
  }

  if (
    normalized !== SANDBOX_OUTPUTS_DIR &&
    !normalized.startsWith(`${SANDBOX_OUTPUTS_DIR}/`)
  ) {
    throw new Error("Generated asset path must stay inside the sandbox outputs directory.");
  }

  return normalized;
}

function buildGeneratedAssetMetadata(workspaceDir: string, relativePath: string) {
  const normalizedRelativePath = normalizeGeneratedAssetRelativePath(relativePath);
  const mimeType = getGeneratedAssetMimeType(normalizedRelativePath);

  if (!mimeType) {
    throw new Error(
      `Unsupported generated asset type: ${path.extname(normalizedRelativePath) || normalizedRelativePath}`,
    );
  }

  const runId = getSandboxRunId(workspaceDir);

  return {
    downloadUrl: buildGeneratedAssetDownloadUrl(runId, normalizedRelativePath),
    fileName: path.posix.basename(normalizedRelativePath),
    mimeType,
    relativePath: normalizedRelativePath,
    runId,
  } satisfies GeneratedSandboxAsset;
}

async function collectGeneratedAssets(
  workspaceDir: string,
): Promise<GeneratedSandboxAsset[]> {
  const outputsDir = path.join(workspaceDir, SANDBOX_OUTPUTS_DIR);

  if (!(await pathExists(outputsDir))) {
    return [];
  }

  const assets: GeneratedSandboxAsset[] = [];

  async function walk(currentAbsoluteDir: string, currentRelativeDir: string) {
    const entries = await readdir(currentAbsoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentAbsoluteDir, entry.name);
      const relativePath = path.posix.join(currentRelativeDir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!getGeneratedAssetMimeType(relativePath)) {
        continue;
      }

      assets.push(buildGeneratedAssetMetadata(workspaceDir, relativePath));
    }
  }

  await walk(outputsDir, SANDBOX_OUTPUTS_DIR);

  return assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function resolvePythonSandboxRoot() {
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "packages/python-sandbox"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../packages/python-sandbox"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../../packages/python-sandbox"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "pyproject.toml"))) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate packages/python-sandbox. Initialize the Step 3 uv project before running sandboxed Python.",
  );
}

async function resolvePythonExecutable() {
  const sandboxRoot = await resolvePythonSandboxRoot();
  const pythonExecutable = path.join(sandboxRoot, ".venv/bin/python");

  if (!(await pathExists(pythonExecutable, fsConstants.X_OK))) {
    throw new Error(
      "Python sandbox interpreter is missing at packages/python-sandbox/.venv/bin/python. Run `uv sync` in packages/python-sandbox before testing the Step 3 sandbox.",
    );
  }

  return pythonExecutable;
}

function validateCsvAnalysisCode(code: string) {
  if (/\b(?:import|from)\s+pandas\b/i.test(code) || /\bpd\.read_csv\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use Polars LazyFrames. pandas and pd.read_csv(...) are not allowed.",
    );
  }

  if (/\bpl\.read_csv\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use pl.scan_csv(...). Eager pl.read_csv(...) is not allowed for Step 4.",
    );
  }

  if (!/\bpl\.scan_csv\s*\(/i.test(code) || !/\.collect\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use pl.scan_csv(...) with a final .collect() before printing the answer.",
    );
  }
}

async function stageInputFiles(
  inputFiles: string[],
  organizationSlug: string,
  role: UserRole,
  workspaceDir: string,
): Promise<StagedSandboxFile[]> {
  const uniquePaths = [...new Set(inputFiles.map((filePath) => filePath.trim()).filter(Boolean))];
  const stagedFiles: StagedSandboxFile[] = [];

  for (const requestedPath of uniquePaths) {
    const resolvedFile = await resolveAuthorizedCompanyDataFile(
      requestedPath,
      organizationSlug,
      role,
    );
    const stagedPath = path.posix.join("inputs", resolvedFile.relativePath);
    const stagedAbsolutePath = path.join(workspaceDir, ...stagedPath.split("/"));

    await mkdir(path.dirname(stagedAbsolutePath), { recursive: true });
    await copyFile(resolvedFile.absolutePath, stagedAbsolutePath);

    stagedFiles.push({
      sourcePath: resolvedFile.relativePath,
      stagedPath,
    });
  }

  return stagedFiles;
}

export async function resolveGeneratedSandboxAsset(
  runId: string,
  relativePath: string,
) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("Invalid sandbox run id.");
  }

  const normalizedRelativePath = normalizeGeneratedAssetRelativePath(relativePath);
  const metadata = buildGeneratedAssetMetadata(
    path.join(SANDBOX_WORKSPACE_DIR, runId),
    normalizedRelativePath,
  );
  const workspaceDir = path.join(SANDBOX_WORKSPACE_DIR, runId);
  const absolutePath = path.resolve(workspaceDir, ...normalizedRelativePath.split("/"));
  const relativeFromWorkspace = path.relative(workspaceDir, absolutePath);

  if (
    relativeFromWorkspace === "" ||
    relativeFromWorkspace === ".." ||
    relativeFromWorkspace.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Generated asset path must stay inside the sandbox workspace.");
  }

  const assetStats = await stat(absolutePath).catch(() => null);

  if (!assetStats) {
    throw new Error(`Generated asset not found: ${normalizedRelativePath}`);
  }

  if (!assetStats.isFile()) {
    throw new Error(`Generated asset path is not a file: ${normalizedRelativePath}`);
  }

  await access(absolutePath, fsConstants.R_OK);

  return {
    absolutePath,
    metadata,
  };
}

export async function executeSandboxedCommand(options: {
  code: string;
  inputFiles?: string[];
  organizationSlug: string;
  role: UserRole;
}): Promise<SandboxedCommandResult> {
  const normalizedCode = options.code.trim();

  if (!normalizedCode) {
    throw new Error("Sandbox code must not be empty.");
  }

  await mkdir(SANDBOX_WORKSPACE_DIR, { recursive: true });

  const workspaceDir = path.join(SANDBOX_WORKSPACE_DIR, randomUUID());
  const runId = getSandboxRunId(workspaceDir);
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, SANDBOX_OUTPUTS_DIR), { recursive: true });
  await mkdir(path.join(workspaceDir, ".matplotlib"), { recursive: true });

  const stagedFiles = await stageInputFiles(
    options.inputFiles ?? [],
    options.organizationSlug,
    options.role,
    workspaceDir,
  );
  const hasCsvInputs = stagedFiles.some((file) => file.sourcePath.toLowerCase().endsWith(".csv"));

  if (hasCsvInputs) {
    validateCsvAnalysisCode(normalizedCode);
  }

  const pythonExecutable = await resolvePythonExecutable();

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonExecutable,
      ["-c", normalizedCode],
      {
        cwd: workspaceDir,
        env: {
          MPLCONFIGDIR: path.join(workspaceDir, ".matplotlib"),
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONUNBUFFERED: "1",
        },
        maxBuffer: SANDBOX_MAX_BUFFER,
        timeout: SANDBOX_TIMEOUT_MS,
      },
    );
    const generatedAssets = await collectGeneratedAssets(workspaceDir);

    return {
      exitCode: 0,
      generatedAssets,
      pythonExecutable,
      runId,
      stagedFiles,
      stderr,
      stdout,
      workspaceDir,
    };
  } catch (caughtError) {
    if (typeof caughtError === "object" && caughtError !== null) {
      const stdout = "stdout" in caughtError ? String(caughtError.stdout ?? "") : "";
      const stderr = "stderr" in caughtError ? String(caughtError.stderr ?? "") : "";
      const exitCode =
        "code" in caughtError && typeof caughtError.code === "number"
          ? caughtError.code
          : -1;
      const message = stderr.trim() || stdout.trim() || "Python sandbox execution failed.";

      throw new SandboxExecutionError(message, {
        exitCode,
        stderr,
        stdout,
      });
    }

    throw caughtError;
  }
}
