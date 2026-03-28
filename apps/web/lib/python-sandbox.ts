import "server-only";

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SANDBOX_WORKSPACE_DIR = "/tmp/workspace";
const SANDBOX_TIMEOUT_MS = 10_000;
const SANDBOX_MAX_BUFFER = 1024 * 1024;

export type SandboxedCommandResult = {
  exitCode: number;
  pythonExecutable: string;
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
    path.resolve(process.cwd(), "packages/python-sandbox"),
    path.resolve(process.cwd(), "../packages/python-sandbox"),
    path.resolve(process.cwd(), "../../packages/python-sandbox"),
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

export async function executeSandboxedCommand(
  code: string,
): Promise<SandboxedCommandResult> {
  const normalizedCode = code.trim();

  if (!normalizedCode) {
    throw new Error("Sandbox code must not be empty.");
  }

  await mkdir(SANDBOX_WORKSPACE_DIR, { recursive: true });

  const pythonExecutable = await resolvePythonExecutable();

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonExecutable,
      ["-c", normalizedCode],
      {
        cwd: SANDBOX_WORKSPACE_DIR,
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
      stderr,
      stdout,
      workspaceDir: SANDBOX_WORKSPACE_DIR,
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
