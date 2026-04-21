import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  causalStudies,
  intentClassifications,
  studyQuestions,
} from "@/lib/app-schema";
import {
  CAUSAL_INTENT_MODEL_NAME,
  CAUSAL_INTENT_PROMPT_VERSION,
  type CausalIntentClassification,
  type CausalQuestionType,
} from "@/lib/causal-intent-types";

export type CausalStudySummary = {
  currentQuestionId: string | null;
  currentQuestionText: string | null;
  description: string | null;
  id: string;
  status: typeof causalStudies.$inferSelect.status;
  title: string;
  updatedAt: number;
};

export type CurrentStudyQuestionSummary = {
  id: string;
  proposedOutcomeLabel: string | null;
  proposedTreatmentLabel: string | null;
  questionText: string;
  questionType: CausalQuestionType;
} | null;

function trimText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function deriveStudyTitleFromQuestion(questionText: string) {
  const trimmed = trimText(questionText);

  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77).trimEnd()}…`;
}

export async function listCausalStudiesForOrganization(organizationId: string) {
  const db = await getAppDatabase();
  const studies = await db
    .select()
    .from(causalStudies)
    .where(eq(causalStudies.organizationId, organizationId))
    .orderBy(desc(causalStudies.updatedAt));

  const currentQuestionIds = studies
    .map((study) => study.currentQuestionId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const questionRows = currentQuestionIds.length
    ? await db
        .select({ id: studyQuestions.id, questionText: studyQuestions.questionText })
        .from(studyQuestions)
        .where(inArray(studyQuestions.id, currentQuestionIds))
    : [];

  const questionTextById = new Map(
    questionRows.map((question) => [question.id, question.questionText]),
  );

  return studies.map((study) => ({
    currentQuestionId: study.currentQuestionId,
    currentQuestionText: study.currentQuestionId
      ? questionTextById.get(study.currentQuestionId) ?? null
      : null,
    description: study.description,
    id: study.id,
    status: study.status,
    title: study.title,
    updatedAt: study.updatedAt,
  })) satisfies CausalStudySummary[];
}

export async function getCausalStudyById(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(causalStudies)
    .where(
      and(
        eq(causalStudies.id, input.studyId),
        eq(causalStudies.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createCausalStudy(input: {
  createdByUserId: string;
  description?: string | null;
  organizationId: string;
  questionText: string;
  title?: string | null;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const createdStudy = {
    id: randomUUID(),
    organizationId: input.organizationId,
    title: input.title?.trim() || deriveStudyTitleFromQuestion(input.questionText),
    description: input.description?.trim() || null,
    status: "awaiting_dataset" as const,
    createdByUserId: input.createdByUserId,
    currentQuestionId: null,
    currentDagId: null,
    currentDagVersionId: null,
    currentRunId: null,
    currentAnswerId: null,
    metadataJson: "{}",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  } satisfies typeof causalStudies.$inferInsert;

  await db.insert(causalStudies).values(createdStudy);

  return createdStudy;
}

export async function ensureResumableCausalStudy(input: {
  createdByUserId: string;
  organizationId: string;
  questionText: string;
  requestedStudyId?: string | null;
}) {
  if (!input.requestedStudyId) {
    return createCausalStudy(input);
  }

  const existingStudy = await getCausalStudyById({
    organizationId: input.organizationId,
    studyId: input.requestedStudyId,
  });

  if (!existingStudy) {
    throw new Error("Requested causal study was not found.");
  }

  if (existingStudy.status === "archived") {
    throw new Error("Archived causal studies cannot be resumed for new intake.");
  }

  const db = await getAppDatabase();
  const now = Date.now();
  const nextStatus = existingStudy.status === "draft" ? "awaiting_dataset" : existingStudy.status;

  await db
    .update(causalStudies)
    .set({
      status: nextStatus,
      updatedAt: now,
    })
    .where(eq(causalStudies.id, existingStudy.id));

  return {
    ...existingStudy,
    status: nextStatus,
    updatedAt: now,
  };
}

export async function createStudyQuestion(input: {
  askedByUserId: string;
  organizationId: string;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  questionText: string;
  questionType: CausalQuestionType;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const question = {
    id: randomUUID(),
    studyId: input.studyId,
    organizationId: input.organizationId,
    askedByUserId: input.askedByUserId,
    questionText: trimText(input.questionText),
    questionType: input.questionType,
    status: "open" as const,
    proposedTreatmentLabel: input.proposedTreatmentLabel ?? null,
    proposedOutcomeLabel: input.proposedOutcomeLabel ?? null,
    metadataJson: "{}",
    createdAt: now,
    updatedAt: now,
  } satisfies typeof studyQuestions.$inferInsert;

  await db.insert(studyQuestions).values(question);

  await db
    .update(causalStudies)
    .set({
      currentQuestionId: question.id,
      updatedAt: now,
    })
    .where(eq(causalStudies.id, input.studyId));

  return question;
}

export async function getStudyQuestionSummary(input: {
  organizationId: string;
  studyId: string;
}) {
  const study = await getCausalStudyById(input);

  if (!study?.currentQuestionId) {
    return null satisfies CurrentStudyQuestionSummary;
  }

  const db = await getAppDatabase();
  const rows = await db
    .select({
      id: studyQuestions.id,
      proposedOutcomeLabel: studyQuestions.proposedOutcomeLabel,
      proposedTreatmentLabel: studyQuestions.proposedTreatmentLabel,
      questionText: studyQuestions.questionText,
      questionType: studyQuestions.questionType,
    })
    .from(studyQuestions)
    .where(eq(studyQuestions.id, study.currentQuestionId))
    .limit(1);

  return (rows[0] ?? null) satisfies CurrentStudyQuestionSummary;
}

export async function updateCausalStudy(input: {
  description?: string | null;
  organizationId: string;
  studyId: string;
  title?: string | null;
}) {
  const existingStudy = await getCausalStudyById({
    organizationId: input.organizationId,
    studyId: input.studyId,
  });

  if (!existingStudy) {
    throw new Error("Causal study not found.");
  }

  const db = await getAppDatabase();
  const now = Date.now();
  const nextTitle = input.title?.trim();
  const nextDescription = typeof input.description === "string" ? input.description.trim() : input.description;

  await db
    .update(causalStudies)
    .set({
      description: typeof input.description === "undefined" ? undefined : nextDescription || null,
      title: nextTitle || existingStudy.title,
      updatedAt: now,
    })
    .where(eq(causalStudies.id, input.studyId));

  return getCausalStudyById({
    organizationId: input.organizationId,
    studyId: input.studyId,
  });
}

export async function recordIntentClassification(input: {
  classification: CausalIntentClassification;
  organizationId: string;
  studyQuestionId: string;
}) {
  const db = await getAppDatabase();
  const record = {
    id: randomUUID(),
    studyQuestionId: input.studyQuestionId,
    organizationId: input.organizationId,
    classifierModelName: CAUSAL_INTENT_MODEL_NAME,
    classifierPromptVersion: CAUSAL_INTENT_PROMPT_VERSION,
    rawOutputJson: input.classification.rawOutputJson,
    isCausal: input.classification.isCausal,
    intentType: input.classification.intentType,
    confidence: input.classification.confidence,
    reasonText: input.classification.reason,
    routingDecision: input.classification.routingDecision,
    createdAt: Date.now(),
  } satisfies typeof intentClassifications.$inferInsert;

  await db.insert(intentClassifications).values(record);

  return record;
}
