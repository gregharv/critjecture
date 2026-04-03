import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { runBraveGrounding } from "@/lib/brave";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

type BraveGroundingRequestBody = {
  enableCitations?: unknown;
  enableEntities?: unknown;
  enableResearch?: unknown;
  maxAnswerChars?: unknown;
  question?: unknown;
};

function clampMaxAnswerChars(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "2500"), 10);

  if (!Number.isFinite(parsed)) {
    return 2500;
  }

  return Math.min(Math.max(parsed, 200), 10_000);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "search",
    routeKey: "brave.grounding",
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
        "This membership cannot run grounded web answer tools.",
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

  let body: BraveGroundingRequestBody;

  try {
    body = (await request.json()) as BraveGroundingRequestBody;
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_json",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be valid JSON.", 400),
    });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_question",
      outcome: "error",
      response: buildObservedErrorResponse("question must be a non-empty string.", 400),
    });
  }

  const enableResearch = Boolean(body.enableResearch ?? true);
  const enableCitations = Boolean(body.enableCitations ?? true);
  const enableEntities = Boolean(body.enableEntities ?? false);
  const maxAnswerChars = clampMaxAnswerChars(body.maxAnswerChars);

  try {
    const grounding = await runBraveGrounding({
      enableCitations,
      enableEntities,
      enableResearch,
      maxAnswerChars,
      question,
    });

    const response = NextResponse.json({
      ...grounding,
      enableCitations,
      enableEntities,
      enableResearch,
      maxAnswerChars,
      question,
      text: grounding.answer,
    });

    return finalizeObservedRequest(observed, {
      metadata: {
        citationCount: grounding.citations.length,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "search_request",
          metadata: {
            citationCount: grounding.citations.length,
            webGrounding: true,
          },
          quantity: 1,
          status: "completed",
          subjectName: "brave_grounding",
        },
      ],
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Brave grounding request failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "brave_grounding_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 500),
    });
  }
}
