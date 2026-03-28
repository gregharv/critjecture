import { NextResponse } from "next/server";

import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import type { CompanyKnowledgeSearchResult } from "@/lib/company-knowledge-types";
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

  if (result.selectedFile) {
    const selectedCandidate = result.candidateFiles.find(
      (candidate) => candidate.file === result.selectedFile,
    );
    const citations = selectedCandidate?.matches.length
      ? selectedCandidate.matches
          .slice(0, 4)
          .map((match) => `- [${match.file}:${match.line}] ${match.text}`)
          .join("\n")
      : `- ${result.selectedFile}`;

    const selectionLine =
      result.selectionReason === "unique-year-match"
        ? `Automatically selected ${result.selectedFile} because it was the only candidate matching the requested year.`
        : `Automatically selected ${result.selectedFile} because it was the only candidate file found.`;

    return [
      `Found ${result.candidateFiles.length} candidate file${result.candidateFiles.length === 1 ? "" : "s"} for "${query}" in ${result.scopeDescription}.`,
      `Role: ${roleLabel}.`,
      selectionLine,
      "Use the selected file path in run_data_analysis inputFiles when computation is needed.",
      citations,
    ].join("\n");
  }

  return [
    `Found ${result.candidateFiles.length} candidate files for "${query}" in ${result.scopeDescription}.`,
    `Role: ${roleLabel}.`,
    "Selection required. Do not call run_data_analysis yet. Wait for the user to choose from the file picker.",
    candidateLines,
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
