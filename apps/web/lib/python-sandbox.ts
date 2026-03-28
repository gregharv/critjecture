import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";

const execFileAsync = promisify(execFile);
const SANDBOX_WORKSPACE_DIR = "/tmp/workspace";
const SANDBOX_TIMEOUT_MS = 10_000;
const SANDBOX_MAX_BUFFER = 1024 * 1024;

export type StagedSandboxFile = {
  sourcePath: string;
  stagedPath: string;
};

export type SandboxedCommandResult = {
  exitCode: number;
  pythonExecutable: string;
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
  role: UserRole,
  workspaceDir: string,
): Promise<StagedSandboxFile[]> {
  const uniquePaths = [...new Set(inputFiles.map((filePath) => filePath.trim()).filter(Boolean))];
  const stagedFiles: StagedSandboxFile[] = [];

  for (const requestedPath of uniquePaths) {
    const resolvedFile = await resolveAuthorizedCompanyDataFile(requestedPath, role);
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

export async function executeSandboxedCommand(options: {
  code: string,
  inputFiles?: string[];
  role: UserRole;
}): Promise<SandboxedCommandResult> {
  const normalizedCode = options.code.trim();

  if (!normalizedCode) {
    throw new Error("Sandbox code must not be empty.");
  }

  await mkdir(SANDBOX_WORKSPACE_DIR, { recursive: true });

  const workspaceDir = path.join(SANDBOX_WORKSPACE_DIR, randomUUID());
  await mkdir(workspaceDir, { recursive: true });

  const stagedFiles = await stageInputFiles(options.inputFiles ?? [], options.role, workspaceDir);
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
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONUNBUFFERED: "1",
        },
        maxBuffer: SANDBOX_MAX_BUFFER,
        timeout: SANDBOX_TIMEOUT_MS,
      },
    );

    return {
      exitCode: 0,
      pythonExecutable,
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
