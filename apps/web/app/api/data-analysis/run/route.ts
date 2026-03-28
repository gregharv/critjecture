import { NextResponse } from "next/server";

import {
  executeSandboxedCommand,
  SandboxExecutionError,
} from "@/lib/python-sandbox";

export const runtime = "nodejs";

type SandboxRequestBody = {
  code?: unknown;
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

  try {
    const result = await executeSandboxedCommand(code);

    return NextResponse.json({
      ...result,
      summary: buildSummary(result.stdout, result.stderr),
    });
  } catch (caughtError) {
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
