import { readFile } from "node:fs/promises";

import { getSessionUser } from "@/lib/auth-state";
import { getGovernanceArtifactDownload } from "@/lib/governance";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (user.role !== "owner") {
    return Response.json({ error: "Only Owner can download governance exports." }, { status: 403 });
  }

  try {
    const { jobId } = await context.params;
    const artifact = await getGovernanceArtifactDownload({
      jobId,
      organizationId: user.organizationId,
    });
    const bytes = await readFile(artifact.path);

    return new Response(bytes, {
      headers: {
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Content-Type": "application/gzip",
      },
      status: 200,
    });
  } catch (caughtError) {
    return Response.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to download governance artifact.",
      },
      { status: 404 },
    );
  }
}
