import { readFile } from "node:fs/promises";
import path from "node:path";

import { getSessionUser } from "@/lib/auth-state";

export const runtime = "nodejs";

const DOC_FILES = {
  compliance: "compliance_controls.md",
  deployment: "deployment.md",
  "hosted-provisioning": "hosted_provisioning.md",
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ doc: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  if (user.role !== "owner") {
    return Response.json({ error: "Only Owner can view review documents." }, { status: 403 });
  }

  const { doc } = await context.params;

  if (!(doc in DOC_FILES)) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }

  const filePath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "docs",
    DOC_FILES[doc as keyof typeof DOC_FILES],
  );
  const content = await readFile(filePath, "utf8");

  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
    status: 200,
  });
}
