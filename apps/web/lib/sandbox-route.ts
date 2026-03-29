import { NextResponse } from "next/server";

export type SandboxRequestBody = {
  code?: unknown;
  inputFiles?: unknown;
  runtimeToolCallId?: unknown;
  turnId?: unknown;
};

export function jsonError(
  message: string,
  status: number,
  details?: {
    exitCode?: number;
    sandboxRunId?: string;
    status?: string;
    stderr?: string;
    stdout?: string;
  },
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

export function buildGeneratedAssetSummary(
  stdout: string,
  assetKind: "chart" | "document",
  relativePath: string,
) {
  const trimmedStdout = stdout.trim();

  if (trimmedStdout) {
    return `Sandbox execution completed successfully.\n${trimmedStdout}\nSaved ${assetKind} asset to ${relativePath}.`;
  }

  return `Sandbox execution completed successfully.\nSaved ${assetKind} asset to ${relativePath}.`;
}

export function parseInputFiles(value: unknown):
  | { inputFiles: string[] }
  | { error: string } {
  if (typeof value === "undefined") {
    return { inputFiles: [] };
  }

  if (!Array.isArray(value)) {
    return {
      error: "inputFiles must be an array of company_data-relative paths for the current organization.",
    };
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
  | { code: string; inputFiles: string[]; runtimeToolCallId: string | null; turnId: string | null }
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
    runtimeToolCallId:
      typeof body.runtimeToolCallId === "string" && body.runtimeToolCallId.trim()
        ? body.runtimeToolCallId.trim()
        : null,
    turnId: typeof body.turnId === "string" && body.turnId.trim() ? body.turnId.trim() : null,
  };
}
