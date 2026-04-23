import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { ensureAnalysisFoundationForUser } from "@/lib/analysis-foundation-sync";
import {
  createAnalysisStudy,
  createAnalysisStudyQuestion,
  listAnalysisStudiesForOrganization,
} from "@/lib/analysis-studies";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  const studies = await listAnalysisStudiesForOrganization(user.organizationId);

  return NextResponse.json({ studies });
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const questionText =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { questionText?: unknown }).questionText === "string"
      ? (body as { questionText: string }).questionText.trim()
      : "";
  const title =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title.trim()
      : "";
  const description =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as { description?: unknown }).description === "string"
      ? (body as { description: string }).description.trim()
      : "";

  if (!questionText) {
    return jsonError("questionText is required when creating an analysis study manually.", 400);
  }

  await ensureAnalysisFoundationForUser(user);
  const study = await createAnalysisStudy({
    createdByUserId: user.id,
    description: description || null,
    organizationId: user.organizationId,
    questionText,
    title: title || null,
  });
  const question = await createAnalysisStudyQuestion({
    askedByUserId: user.id,
    organizationId: user.organizationId,
    questionText,
    questionType: "other",
    studyId: study.id,
  });

  return NextResponse.json({ question, study }, { status: 201 });
}
