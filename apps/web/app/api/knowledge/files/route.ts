import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import {
  listKnowledgeFiles,
  parseKnowledgeScopeFilter,
  parseKnowledgeStatusFilter,
  uploadKnowledgeFile,
} from "@/lib/knowledge-files";
import {
  beginObservedRequest,
  buildObservedErrorResponse,
  buildRateLimitedResponse,
  enforceRateLimitPolicy,
  finalizeObservedRequest,
  runOperationsMaintenance,
} from "@/lib/operations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { searchParams } = new URL(request.url);
  const scope = parseKnowledgeScopeFilter(searchParams.get("scope"));
  const status = parseKnowledgeStatusFilter(searchParams.get("status"));

  if (scope === null) {
    return jsonError("scope must be public or admin.", 400);
  }

  if (status === null) {
    return jsonError("status must be pending, ready, or failed.", 400);
  }

  try {
    const files = await listKnowledgeFiles(user, {
      scope: scope ?? undefined,
      status: status ?? undefined,
    });

    return NextResponse.json({ files });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Failed to load knowledge files.";

    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const observed = beginObservedRequest({
    method: "POST",
    routeGroup: "knowledge_upload",
    routeKey: "knowledge.files.upload",
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

  const rateLimitDecision = await enforceRateLimitPolicy({
    routeGroup: "knowledge_upload",
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

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return finalizeObservedRequest(observed, {
      errorCode: "invalid_form_data",
      outcome: "error",
      response: buildObservedErrorResponse("Request body must be multipart form data.", 400),
    });
  }

  const file = formData.get("file");
  const scope = formData.get("scope");

  if (!(file instanceof File)) {
    return finalizeObservedRequest(observed, {
      errorCode: "missing_file",
      outcome: "error",
      response: buildObservedErrorResponse("file must be provided as a multipart upload.", 400),
    });
  }

  if (typeof scope !== "string" && user.role === "owner") {
    return finalizeObservedRequest(observed, {
      errorCode: "missing_scope",
      outcome: "error",
      response: buildObservedErrorResponse("scope must be provided for owner uploads.", 400),
    });
  }

  try {
    const uploadedFile = await uploadKnowledgeFile({
      file,
      requestedScope: typeof scope === "string" ? scope : "public",
      user,
    });

    const response = NextResponse.json({ file: uploadedFile });
    return finalizeObservedRequest(observed, {
      metadata: {
        accessScope: uploadedFile.accessScope,
        displayName: uploadedFile.displayName,
        ingestionStatus: uploadedFile.ingestionStatus,
      },
      outcome: "ok",
      response,
      usageEvents: [
        {
          eventType: "knowledge_upload",
          metadata: {
            accessScope: uploadedFile.accessScope,
            ingestionStatus: uploadedFile.ingestionStatus,
          },
          quantity: 1,
          status: uploadedFile.ingestionStatus,
          subjectName: uploadedFile.displayName,
        },
      ],
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Knowledge upload failed.";

    return finalizeObservedRequest(observed, {
      errorCode: "knowledge_upload_failed",
      outcome: "error",
      response: buildObservedErrorResponse(message, 400),
    });
  }
}
