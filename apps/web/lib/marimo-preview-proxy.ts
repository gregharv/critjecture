import "server-only";

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getUserConversation } from "@/lib/conversations";
import { getAnalysisPreviewTarget } from "@/lib/marimo-preview";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  finalizeObservedRequest,
} from "@/lib/operations";

function buildUpstreamUrl(input: {
  pathSegments: string[];
  port: number;
  searchParams: URLSearchParams;
}) {
  const pathname = input.pathSegments.length > 0 ? `/${input.pathSegments.join("/")}` : "/";
  const passthroughSearch = new URLSearchParams(input.searchParams);
  passthroughSearch.delete("token");
  const query = passthroughSearch.toString();

  return `http://127.0.0.1:${input.port}${pathname}${query ? `?${query}` : ""}`;
}

export async function proxyAnalysisPreviewRequest(input: {
  context: { params: Promise<{ conversationId: string; previewPath?: string[] }> };
  request: Request;
}) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: input.request.method,
    routeGroup: "sandbox",
    routeKey: "analysis.workspace.preview.proxy",
    user,
  });

  if (!user) {
    return finalizeObservedRequest(observed, {
      errorCode: "auth_required",
      outcome: "error",
      response: buildObservedErrorResponse("Authentication required.", 401),
    });
  }

  const { conversationId, previewPath = [] } = await input.context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_conversation_id",
      outcome: "error",
      response: buildObservedErrorResponse("conversationId must be a non-empty string.", 400),
    });
  }

  const conversation = await getUserConversation({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    userId: user.id,
    userRole: user.role,
  });

  if (!conversation) {
    return finalizeObservedRequest(observed, {
      errorCode: "conversation_not_found",
      outcome: "error",
      response: buildObservedErrorResponse("Conversation not found.", 404),
    });
  }

  const requestUrl = new URL(input.request.url);
  const token = requestUrl.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return finalizeObservedRequest(observed, {
      errorCode: "preview_token_required",
      outcome: "error",
      response: buildObservedErrorResponse("Preview token is required.", 401),
    });
  }

  const target = await getAnalysisPreviewTarget({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    previewToken: token,
    userId: user.id,
  });

  if (!target) {
    return finalizeObservedRequest(observed, {
      errorCode: "analysis_preview_session_not_found",
      metadata: {
        conversationId: normalizedConversationId,
      },
      outcome: "error",
      response: buildObservedErrorResponse("Preview session not found or expired.", 404),
    });
  }

  const upstreamUrl = buildUpstreamUrl({
    pathSegments: previewPath,
    port: target.port,
    searchParams: requestUrl.searchParams,
  });
  const upstreamHeaders = new Headers();
  const forwardedContentType = input.request.headers.get("content-type");
  const forwardedAccept = input.request.headers.get("accept");

  if (forwardedContentType) {
    upstreamHeaders.set("content-type", forwardedContentType);
  }

  if (forwardedAccept) {
    upstreamHeaders.set("accept", forwardedAccept);
  }

  try {
    const response = await fetch(upstreamUrl, {
      body:
        input.request.method === "GET" || input.request.method === "HEAD"
          ? undefined
          : await input.request.arrayBuffer(),
      cache: "no-store",
      headers: upstreamHeaders,
      method: input.request.method,
      redirect: "manual",
    });

    const responseHeaders = new Headers();

    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === "content-length") {
        continue;
      }

      responseHeaders.set(key, value);
    }

    responseHeaders.set("Cache-Control", "no-store");

    const proxiedResponse = new NextResponse(response.body, {
      headers: responseHeaders,
      status: response.status,
    });

    if (response.status >= 400) {
      return finalizeObservedRequest(observed, {
        errorCode: "analysis_preview_proxy_failed",
        metadata: {
          previewPath,
          previewSessionId: target.sessionId,
          revisionId: target.revisionId,
          upstreamStatus: response.status,
          workspaceId: target.workspaceId,
        },
        outcome: "error",
        response: proxiedResponse,
      });
    }

    return proxiedResponse;
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to proxy notebook preview.";

    return finalizeObservedRequest(observed, {
      errorCode: "analysis_preview_proxy_failed",
      metadata: {
        previewPath,
        previewSessionId: target.sessionId,
        revisionId: target.revisionId,
        workspaceId: target.workspaceId,
      },
      outcome: "error",
      response: buildObservedErrorResponse(message, 502),
    });
  }
}
