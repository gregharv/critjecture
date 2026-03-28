import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
} from "@/lib/python-sandbox";
import { recordSandboxRun } from "@/lib/sandbox-runs";
import {
  buildSandboxSummary,
  jsonError,
  parseSandboxRequest,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: SandboxRequestBody;

  try {
    body = (await request.json()) as SandboxRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsedRequest = parseSandboxRequest(body);

  if ("error" in parsedRequest) {
    return jsonError(parsedRequest.error, 400);
  }

  try {
    const result = await executeSandboxedCommand({
      code: parsedRequest.code,
      inputFiles: parsedRequest.inputFiles,
      role: user.role,
    });
    await recordSandboxRun({
      generatedAssets: result.generatedAssets,
      toolName: "run_data_analysis",
      userId: user.id,
      workspaceId: result.workspaceId,
    });

    return NextResponse.json({
      ...result,
      summary: buildSandboxSummary(result.stdout, result.stderr),
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
