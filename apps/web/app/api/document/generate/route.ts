import { NextResponse } from "next/server";

import {
  executeSandboxedCommand,
  SandboxExecutionError,
  SandboxValidationError,
  type GeneratedSandboxAsset,
} from "@/lib/python-sandbox";
import {
  buildSandboxSummary,
  jsonError,
  parseSandboxRequest,
  type SandboxRequestBody,
} from "@/lib/sandbox-route";

export const runtime = "nodejs";

function expectSinglePdfAsset(generatedAssets: GeneratedSandboxAsset[]) {
  if (
    generatedAssets.length !== 1 ||
    generatedAssets[0]?.mimeType !== "application/pdf"
  ) {
    throw new SandboxValidationError(
      "generate_document must save exactly one PDF file inside outputs/.",
    );
  }

  return generatedAssets[0];
}

export async function POST(request: Request) {
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
      role: parsedRequest.role,
    });
    const generatedAsset = expectSinglePdfAsset(result.generatedAssets);

    return NextResponse.json({
      ...result,
      generatedAsset,
      summary: `${buildSandboxSummary(result.stdout, result.stderr)}\nSaved document asset to ${generatedAsset.relativePath}.`,
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
        : "Document generation failed.";

    return jsonError(message, 500);
  }
}
