import { readFile } from "node:fs/promises";
import path from "node:path";

import { getSessionUser } from "@/lib/auth-state";
import { getCustomerReviewDoc } from "@/lib/customer-review-docs";

export const runtime = "nodejs";

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
  const reviewDoc = getCustomerReviewDoc(doc);

  if (!reviewDoc) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }

  const filePath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "docs",
    reviewDoc.fileName,
  );
  const content = await readFile(filePath, "utf8");

  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
    status: 200,
  });
}
