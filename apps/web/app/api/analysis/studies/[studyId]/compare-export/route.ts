import { getSessionUser } from "@/lib/auth-state";
import { AnalysisExportError, exportAnalysisRunComparisonZip } from "@/lib/analysis-export";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ studyId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { studyId } = await context.params;
  const url = new URL(request.url);
  const baseRunId = url.searchParams.get("baseRunId")?.trim() ?? "";
  const targetRunId = url.searchParams.get("targetRunId")?.trim() ?? "";

  if (!studyId.trim()) {
    return jsonError("studyId must be a non-empty string.", 400);
  }

  if (!baseRunId || !targetRunId) {
    return jsonError("baseRunId and targetRunId are required query parameters.", 400);
  }

  try {
    const archive = await exportAnalysisRunComparisonZip({
      baseRunId,
      organizationId: user.organizationId,
      studyId: studyId.trim(),
      targetRunId,
    });

    return new Response(archive.buffer, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${archive.archiveFileName}"`,
        "Content-Length": String(archive.buffer.byteLength),
        "Content-Type": "application/zip",
      },
      status: 200,
    });
  } catch (caughtError) {
    if (caughtError instanceof AnalysisExportError) {
      const statusCode =
        caughtError.code === "analysis_run_not_found"
          ? 404
          : caughtError.code === "analysis_comparison_study_mismatch"
            ? 400
            : 400;
      return jsonError(caughtError.message, statusCode);
    }

    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to export analysis run comparison.",
      500,
    );
  }
}
