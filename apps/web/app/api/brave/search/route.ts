import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  clampBraveCount,
  formatBraveSearchText,
  normalizeBraveCountry,
  normalizeBraveQuery,
  runBraveSearch,
  sanitizeBraveFormat,
  sanitizeBraveFreshness,
} from "@/lib/brave";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type BraveSearchRequestBody = {
  count?: unknown;
  country?: unknown;
  fetchContent?: unknown;
  format?: unknown;
  freshness?: unknown;
  query?: unknown;
};

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "search",
    routeKey: "brave.search",
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
        "This membership cannot run web search tools.",
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

  let body: BraveSearchRequestBody;

  try {
    body = (await request.json()) as BraveSearchRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const query = normalizeBraveQuery(typeof body.query === "string" ? body.query : "");

  if (!query) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_query",
      outcome: "error",
      response: buildObservedErrorResponse("Search query must be a non-empty string.", 400),
    });
  }

  const count = clampBraveCount(body.count);
  const country = normalizeBraveCountry(body.country);
  const freshness = sanitizeBraveFreshness(body.freshness);
  const format = sanitizeBraveFormat(body.format);
  const fetchContent = Boolean(body.fetchContent ?? false);

  try {
    const search = await runBraveSearch({
      count,
      country,
      fetchContent,
      freshness,
      query,
    });
    const text = formatBraveSearchText({
      format,
      query: search.query,
      results: search.results,
    });

    const response = NextResponse.json({
      ...search,
      format,
      text,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        fetchedContentCount: search.results.filter((result) => Boolean(result.content)).length,
        resultCount: search.results.length,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "search_request",
          metadata: {
            resultCount: search.results.length,
            webSearch: true,
          },
          quantity: 1,
          status: "completed",
          subjectName: "brave_search",
        },
      ],
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Brave search request failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "brave_search_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
