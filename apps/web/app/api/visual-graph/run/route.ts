import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import { recordSandboxRun } from "@/lib/sandbox-runs";
import {
  buildSandboxSummary,
  jsonError,
  parseSandboxRequest,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

function buildVisualGraphCode(code: string) {
  return [
    "import matplotlib",
    'matplotlib.use("Agg")',
    code,
  ].join("\n\n");
}

function expectSinglePngAsset(generatedAssets: GeneratedSandboxAsset[]) {
  if (generatedAssets.length !== 1 || generatedAssets[0]?.mimeType !== "image/png") {
    throw new SandboxValidationError(
      "generate_visual_graph must save exactly one PNG file inside outputs/.",
    );
  }

  return generatedAssets[0];
}

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
      code: buildVisualGraphCode(parsedRequest.code),
      inputFiles: parsedRequest.inputFiles,
      role: user.role,
    });
    await recordSandboxRun({
      generatedAssets: result.generatedAssets,
      toolName: "generate_visual_graph",
      userId: user.id,
      workspaceId: result.workspaceId,
    });
    const generatedAsset = expectSinglePngAsset(result.generatedAssets);

    return NextResponse.json({
      ...result,
      generatedAsset,
      summary: `${buildSandboxSummary(result.stdout, result.stderr)}\nSaved graph asset to ${generatedAsset.relativePath}.`,
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
        : "Graph generation failed.";

    return jsonError(message, 500);
  }
}
