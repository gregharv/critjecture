import { NextResponse } from "next/server";

import {
  searchCompanyKnowledge,
  type CompanyKnowledgeSearchResult,
} from "@/lib/company-knowledge";
import { getRoleLabel, isUserRole } from "@/lib/roles";

export const runtime = "nodejs";

type SearchRequestBody = {
  query?: unknown;
  role?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function buildSummary(query: string, roleLabel: string, result: CompanyKnowledgeSearchResult) {
  if (result.matches.length === 0) {
    return `No matches found for "${query}" in ${result.scopeDescription}.`;
  }

  const citations = result.matches
    .map((match) => `- [${match.file}:${match.line}] ${match.text}`)
    .join("\n");

  return [
    `Found ${result.matches.length} match${result.matches.length === 1 ? "" : "es"} for "${query}" in ${result.scopeDescription}.`,
    `Role: ${roleLabel}.`,
    citations,
  ].join("\n");
}

export async function POST(request: Request) {
  let body: SearchRequestBody;

  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return jsonError("Search query must be a non-empty string.", 400);
  }

  if (!isUserRole(body.role)) {
    return jsonError('Role must be either "intern" or "owner".', 400);
  }

  try {
    const result = await searchCompanyKnowledge(query, body.role);
    const roleLabel = getRoleLabel(body.role);

    return NextResponse.json({
      ...result,
      role: body.role,
      summary: buildSummary(query, roleLabel, result),
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Company knowledge search failed.";

    return jsonError(message, 500);
  }
}
