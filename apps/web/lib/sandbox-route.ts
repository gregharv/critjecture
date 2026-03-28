import { NextResponse } from "next/server";

export type SandboxRequestBody = {
  code?: unknown;
  inputFiles?: unknown;
};

export function jsonError(
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

export function buildSandboxSummary(stdout: string, stderr: string) {
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

export function parseInputFiles(value: unknown):
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

export function parseSandboxRequest(body: SandboxRequestBody):
  | { code: string; inputFiles: string[] }
  | { error: string } {
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (!code) {
    return { error: "Sandbox code must be a non-empty string." };
  }

  const inputFilesResult = parseInputFiles(body.inputFiles);

  if ("error" in inputFilesResult) {
    return inputFilesResult;
  }

  return {
    code,
    inputFiles: inputFilesResult.inputFiles,
  };
}
