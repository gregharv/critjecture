import { NextResponse } from "next/server";

import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import type { CompanyKnowledgeSearchResult } from "@/lib/company-knowledge-types";
import { getSessionUser } from "@/lib/auth-state";
import { getRoleLabel } from "@/lib/roles";

export const runtime = "nodejs";

type SearchRequestBody = {
  query?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function buildSummary(query: string, roleLabel: string, result: CompanyKnowledgeSearchResult) {
  if (result.candidateFiles.length === 0) {
    return `No matches found for "${query}" in ${result.scopeDescription}.`;
  }

  const candidateLines = result.candidateFiles
    .map((candidate) => {
      const reason =
        candidate.matchedTerms.length > 0
          ? `matched ${candidate.matchedTerms.join(", ")}`
          : "matched preview";

      return `- ${candidate.file} (${reason})`;
    })
    .join("\n");

  if (result.selectedFiles.length > 0) {
    const selectedCandidate = result.candidateFiles.find((candidate) =>
      result.selectedFiles.includes(candidate.file),
    );
    const citations = selectedCandidate?.matches.length
      ? selectedCandidate.matches
          .slice(0, 4)
          .map((match) => `- [${match.file}:${match.line}] ${match.text}`)
          .join("\n")
      : result.selectedFiles.map((file) => `- ${file}`).join("\n");

    const selectionLine =
      result.selectionReason === "unique-year-match"
        ? `Automatically selected ${result.selectedFiles.join(", ")} because it was the only candidate matching the requested year.`
        : `Automatically selected ${result.selectedFiles.join(", ")} because it was the only candidate file found.`;

    return [
      `Found ${result.candidateFiles.length} candidate file${result.candidateFiles.length === 1 ? "" : "s"} for "${query}" in ${result.scopeDescription}.`,
      `Role: ${roleLabel}.`,
      selectionLine,
      "Use the selected file path in inputFiles when a Python sandbox tool is needed.",
      citations,
    ].join("\n");
  }

  const recommendedLine =
    result.recommendedFiles.length > 0
      ? `Recommended files: ${result.recommendedFiles.join(", ")}.`
      : "No files were preselected yet.";

  return [
    `Found ${result.candidateFiles.length} candidate files for "${query}" in ${result.scopeDescription}.`,
    `Role: ${roleLabel}.`,
    "Selection pending. A multi-select file picker will appear after the assistant finishes gathering candidates. Do not call a Python sandbox tool yet.",
    recommendedLine,
    candidateLines,
  ].join("\n");
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

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

  try {
    const result = await searchCompanyKnowledge(query, user.organizationSlug, user.role);
    const roleLabel = getRoleLabel(user.role);

    return NextResponse.json({
      ...result,
      role: user.role,
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
