import { getSessionUser } from "@/lib/auth-state";
import { exportPredictiveRunZip, PredictiveExportError } from "@/lib/predictive-export";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { runId } = await context.params;
  const normalizedRunId = runId.trim();

  if (!normalizedRunId) {
    return jsonError("runId must be a non-empty string.", 400);
  }

  try {
    const archive = await exportPredictiveRunZip({
      organizationId: user.organizationId,
      runId: normalizedRunId,
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
    if (caughtError instanceof PredictiveExportError) {
      const statusCode = caughtError.code === "predictive_run_not_found" ? 404 : 400;
      return jsonError(caughtError.message, statusCode);
    }

    return jsonError(
      caughtError instanceof Error ? caughtError.message : "Failed to export predictive run.",
      500,
    );
  }
}
