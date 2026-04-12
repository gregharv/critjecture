import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { getUserConversation } from "@/lib/conversations";
import type { AnalysisWorkspaceResponse } from "@/lib/marimo-types";
import {
  getAnalysisWorkspaceByConversation,
  getLatestAnalysisNotebookRevision,
} from "@/lib/marimo-workspaces";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const { conversationId } = await context.params;
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return jsonError("conversationId must be a non-empty string.", 400);
  }

  const conversation = await getUserConversation({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    userId: user.id,
    userRole: user.role,
  });

  if (!conversation) {
    return jsonError("Conversation not found.", 404);
  }

  const workspace = await getAnalysisWorkspaceByConversation({
    conversationId: normalizedConversationId,
    organizationId: user.organizationId,
    userId: user.id,
  });

  if (!workspace) {
    return jsonError("Analysis workspace not found.", 404);
  }

  const latestRevision = workspace.latestRevisionId
    ? await getLatestAnalysisNotebookRevision(workspace.id)
    : null;

  return NextResponse.json({
    latestRevision,
    workspace,
  } satisfies AnalysisWorkspaceResponse);
}
