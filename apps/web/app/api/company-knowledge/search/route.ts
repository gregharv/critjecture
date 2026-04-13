import { NextResponse } from "next/server";

import { searchCompanyKnowledge } from "@/lib/company-knowledge";
import type {
  CompanyKnowledgeQueryDiagnostics,
  CompanyKnowledgeSearchResult,
} from "@/lib/company-knowledge-types";
import { getSessionUser } from "@/lib/auth-state";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";
import { getRoleLabel } from "@/lib/roles";

export const runtime = "nodejs";

type SearchRequestBody = {
  query?: unknown;
};

function describeCsvPreview(result: CompanyKnowledgeSearchResult, files: string[]) {
  const schemaLines = result.candidateFiles
    .map((candidate) => {
      if (!files.includes(candidate.file) || candidate.preview.kind !== "csv") {
        return null;
      }

      return `${candidate.file}: ${candidate.preview.columns.join(", ")}`;
    })
    .filter(Boolean);

  if (schemaLines.length === 0) {
    return null;
  }

  return `CSV columns: ${schemaLines.join(" | ")}.`;
}

function buildSelectedCsvSummary(
  query: string,
  roleLabel: string,
  result: CompanyKnowledgeSearchResult,
  diagnosticsLine: string,
) {
  const selectedFile = result.selectedFiles[0];
  const selectedCandidate = selectedFile
    ? result.candidateFiles.find((candidate) => candidate.file === selectedFile)
    : null;
  const csvColumns = selectedCandidate?.preview.kind === "csv"
    ? selectedCandidate.preview.columns.join(", ")
    : null;

  return [
    `Found ${result.candidateFiles.length} candidate file${result.candidateFiles.length === 1 ? "" : "s"} for "${query}" in ${result.scopeDescription}.`,
    `Role: ${roleLabel}.`,
    diagnosticsLine,
    `Automatically selected ${result.selectedFiles.join(", ")} because it was the only candidate file found${result.selectionReason === "unique-year-match" ? " for the requested year" : ""}.`,
    csvColumns ? `Selected CSV columns: ${csvColumns}.` : null,
    "Use the selected file path in inputFiles for run_data_analysis instead of trying to reason through rows in chat context.",
  ]
    .filter(Boolean)
    .join("\n");
}

function describeQueryDiagnostics(diagnostics: CompanyKnowledgeQueryDiagnostics) {
  const correctedTermsLine =
    diagnostics.correctedTerms.length > 0
      ? `Typo-tolerant terms applied: ${diagnostics.correctedTerms
          .map((entry) => `${entry.from} → ${entry.to}`)
          .join(", ")}.`
      : null;

  const expandedTermsLine =
    diagnostics.expandedTerms.length > 0
      ? `Expanded search terms: ${diagnostics.expandedTerms.join(", ")}.`
      : null;
  const aiRewriteLine =
    diagnostics.aiRewriteApplied && diagnostics.aiSuggestedTerms.length > 0
      ? `AI fallback rewrite terms: ${diagnostics.aiSuggestedTerms.join(", ")}.`
      : null;

  return [
    `Searched ${diagnostics.manifestFileCount} managed asset version${diagnostics.manifestFileCount === 1 ? "" : "s"} in the asset-backed manifest (filename + CSV headers + short preview).`,
    correctedTermsLine,
    expandedTermsLine,
    aiRewriteLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSummary(query: string, roleLabel: string, result: CompanyKnowledgeSearchResult) {
  const diagnosticsLine = describeQueryDiagnostics(result.queryDiagnostics);
  if (result.candidateFiles.length === 0) {
    return [
      `No matches found for "${query}" in ${result.scopeDescription}.`,
      diagnosticsLine,
    ]
      .filter(Boolean)
      .join("\n");
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

    if (selectedCandidate?.preview.kind === "csv") {
      return buildSelectedCsvSummary(query, roleLabel, result, diagnosticsLine);
    }

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
      diagnosticsLine,
      selectionLine,
      describeCsvPreview(result, result.selectedFiles),
      "Use the selected file path in inputFiles when a Python sandbox tool is needed.",
      citations,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const recommendedLine =
    result.recommendedFiles.length > 0
      ? `Recommended files: ${result.recommendedFiles.join(", ")}.`
      : "No files were preselected yet.";

  return [
    `Found ${result.candidateFiles.length} candidate files for "${query}" in ${result.scopeDescription}.`,
    `Role: ${roleLabel}.`,
    diagnosticsLine,
    "Selection pending. A multi-select file picker will appear after the assistant finishes gathering candidates. Do not call a Python sandbox tool yet.",
    recommendedLine,
    describeCsvPreview(result, result.recommendedFiles),
    candidateLines,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "search",
    routeKey: "company-knowledge.search",
    user,
  });
  await runOperationsMaintenance();

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  if (!user.access.canUseAnswerTools) {
    return finalizeObservedRequest(observed, {
      errorCode: "search_forbidden",
      outcome: "blocked",
      response: buildObservedErrorResponse(
        "This membership cannot search workspace knowledge.",
        403,
      ),
    });
  }

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "search",
    user,
  });

  if (rateLimitDecision) {
    return finalizeObservedRequest(observed, {
      errorCode: rateLimitDecision.errorCode,
      metadata: {
        limit: rateLimitDecision.limit,
        scope: rateLimitDecision.scope,
        windowMs: rateLimitDecision.windowMs,
      },
      outcome: "rate_limited",
      response: buildRateLimitedResponse(rateLimitDecision),
    });
  }

  let body: SearchRequestBody;

  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_query",
      outcome: "error",
      response: buildObservedErrorResponse("Search query must be a non-empty string.", 400),
    });
  }

  try {
    const result = await searchCompanyKnowledge(
      query,
      user.organizationId,
      user.organizationSlug,
      user.role,
    );
    const roleLabel = getRoleLabel(user.role);

    const response = NextResponse.json({
      ...result,
      role: user.role,
      summary: buildSummary(query, roleLabel, result),
    });
    return finalizeObservedRequest(observed, {
      metadata: {
        candidateFileCount: result.candidateFiles.length,
        recommendedFileCount: result.recommendedFiles.length,
        selectedFileCount: result.selectedFiles.length,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "search_request",
          metadata: {
            candidateFileCount: result.candidateFiles.length,
            selectedFileCount: result.selectedFiles.length,
          },
          quantity: 1,
          status: "completed",
          subjectName: "search_company_knowledge",
        },
      ],
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Company knowledge search failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "search_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
