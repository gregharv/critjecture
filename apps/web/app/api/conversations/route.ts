import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { listUserConversations } from "@/lib/conversations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const requestUrl = new URL(request.url);
  const rawSearchQuery = requestUrl.searchParams.get("q") ?? "";
  const searchQuery = rawSearchQuery.trim().slice(0, 200);

  try {
    const conversations = await listUserConversations({
      organizationId: user.organizationId,
      searchQuery: searchQuery.length > 0 ? searchQuery : null,
      userId: user.id,
      userRole: user.role,
    });

    return NextResponse.json({ conversations });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error
        ? caughtError.message
        : "Failed to load conversations.";

    return jsonError(message, 500);
  }
}
