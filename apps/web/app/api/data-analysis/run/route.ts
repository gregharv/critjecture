import { NextResponse } from "next/server";

import {
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
} from "@/lib/python-sandbox";
import { isUserRole, type UserRole } from "@/lib/roles";

export const runtime = "nodejs";

type SandboxRequestBody = {
  code?: unknown;
  inputFiles?: unknown;
  role?: unknown;
};

function jsonError(
  message: string,
  status: number,
  details?: { exitCode: number; stderr: string; stdout: string },
) {
  return NextResponse.json(
    {
      error: message,
      ...details,
    },
    { status },
  );
}

function buildSummary(stdout: string, stderr: string) {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();

  if (trimmedStdout) {
    return `Sandbox execution completed successfully.\n${trimmedStdout}`;
  }

  if (trimmedStderr) {
    return `Sandbox execution completed successfully with stderr output.\n${trimmedStderr}`;
  }

  return "Sandbox execution completed successfully, but stdout was empty. Update the Python code to print the final answer explicitly.";
}

export async function POST(request: Request) {
  let body: SandboxRequestBody;

  try {
    body = (await request.json()) as SandboxRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!code) {
    return jsonError("Sandbox code must be a non-empty string.", 400);
  }

  if (!isUserRole(body.role)) {
    return jsonError('Role must be either "intern" or "owner".', 400);
  }

  const inputFilesResult = parseInputFiles(body.inputFiles);

  if ("error" in inputFilesResult) {
    return jsonError(inputFilesResult.error, 400);
  }

  const role: UserRole = body.role;
  const inputFiles = inputFilesResult.inputFiles;

  try {
    const result = await executeSandboxedCommand({
      code,
      inputFiles,
      role,
    });

    return NextResponse.json({
      ...result,
      summary: buildSummary(result.stdout, result.stderr),
    });
  } catch (caughtError) {
    if (caughtError instanceof SandboxValidationError) {
      return jsonError(caughtError.message, 400);
    }

    if (caughtError instanceof SandboxExecutionError) {
      const combinedOutput = [caughtError.stderr.trim(), caughtError.stdout.trim()]
        .filter(Boolean)
        .join("\n");

      return jsonError(
        combinedOutput || caughtError.message,
        500,
        {
          exitCode: caughtError.exitCode,
          stderr: caughtError.stderr,
          stdout: caughtError.stdout,
        },
      );
    }

    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Sandbox execution failed.";

    return jsonError(message, 500);
  }
}

function parseInputFiles(value: unknown):
  | { inputFiles: string[] }
  | { error: string } {
  if (typeof value === "undefined") {
    return { inputFiles: [] };
  }

  if (!Array.isArray(value)) {
    return { error: "inputFiles must be an array of company_data-relative paths." };
  }

  const inputFiles = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  if (inputFiles.length !== value.length) {
    return { error: "Every inputFiles entry must be a non-empty string." };
  }

  return { inputFiles };
}
