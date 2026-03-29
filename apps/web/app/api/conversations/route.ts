import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { listUserConversations } from "@/lib/conversations";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  try {
    const conversations = await listUserConversations({
      organizationId: user.organizationId,
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
