import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { analysisClassifications, analysisStudies, studyQuestions } from "@/lib/app-schema";
import { normalizeAnalysisError } from "@/lib/analysis-error-normalization";
import {
  ANALYSIS_ROUTER_MODEL_NAME,
  ANALYSIS_ROUTER_PROMPT_VERSION,
  type AnalysisRoutingClassification,
} from "@/lib/analysis-routing-types";
import type { AnalysisQuestionType } from "@/lib/analysis-intent-types";

export type AnalysisStudySummary = {
  currentQuestionId: string | null;
  currentQuestionText: string | null;
  description: string | null;
  id: string;
  status: typeof analysisStudies.$inferSelect.status;
  title: string;
  updatedAt: number;
};

export type CurrentAnalysisQuestionSummary = {
  id: string;
  proposedOutcomeLabel: string | null;
  proposedTreatmentLabel: string | null;
  questionText: string;
  questionType: AnalysisQuestionType;
} | null;

function trimText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function deriveAnalysisStudyTitleFromQuestion(questionText: string) {
  const trimmed = trimText(questionText);

  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77).trimEnd()}…`;
}

export async function listAnalysisStudiesForOrganization(organizationId: string) {
  try {
    const db = await getAppDatabase();
    const studies = await db
      .select()
      .from(analysisStudies)
      .where(eq(analysisStudies.organizationId, organizationId))
      .orderBy(desc(analysisStudies.updatedAt));

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
    })) satisfies AnalysisStudySummary[];
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to list analysis studies.");
  }
}

export async function getAnalysisStudyById(input: {
  organizationId: string;
  studyId: string;
}) {
  try {
    const db = await getAppDatabase();
    const rows = await db
      .select()
      .from(analysisStudies)
      .where(
        and(
          eq(analysisStudies.id, input.studyId),
          eq(analysisStudies.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to load analysis study.");
  }
}

export async function createAnalysisStudy(input: {
  createdByUserId: string;
  description?: string | null;
  organizationId: string;
  questionText: string;
  title?: string | null;
}) {
  try {
    const db = await getAppDatabase();
    const now = Date.now();
    const createdStudy = {
      id: randomUUID(),
      organizationId: input.organizationId,
      title: input.title?.trim() || deriveAnalysisStudyTitleFromQuestion(input.questionText),
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
    } satisfies typeof analysisStudies.$inferInsert;

    await db.insert(analysisStudies).values(createdStudy);

    return createdStudy;
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to create analysis study.");
  }
}

export async function ensureResumableAnalysisStudy(input: {
  createdByUserId: string;
  organizationId: string;
  questionText: string;
  requestedStudyId?: string | null;
}) {
  try {
    if (!input.requestedStudyId) {
      return createAnalysisStudy(input);
    }

    const existingStudy = await getAnalysisStudyById({
      organizationId: input.organizationId,
      studyId: input.requestedStudyId,
    });

    if (!existingStudy) {
      throw new Error("Requested analysis study was not found.");
    }

    if (existingStudy.status === "archived") {
      throw new Error("Archived analysis studies cannot be resumed for new intake.");
    }

    const db = await getAppDatabase();
    const now = Date.now();
    const nextStatus = existingStudy.status === "draft" ? "awaiting_dataset" : existingStudy.status;

    await db
      .update(analysisStudies)
      .set({
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(analysisStudies.id, existingStudy.id));

    return {
      ...existingStudy,
      status: nextStatus,
      updatedAt: now,
    };
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to resume analysis study.");
  }
}

export async function createAnalysisStudyQuestion(input: {
  askedByUserId: string;
  organizationId: string;
  proposedOutcomeLabel?: string | null;
  proposedTreatmentLabel?: string | null;
  questionText: string;
  questionType: AnalysisQuestionType;
  studyId: string;
}) {
  try {
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
      .update(analysisStudies)
      .set({
        currentQuestionId: question.id,
        updatedAt: now,
      })
      .where(eq(analysisStudies.id, input.studyId));

    return question;
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to create analysis study question.");
  }
}

export async function getAnalysisStudyQuestionSummary(input: {
  organizationId: string;
  studyId: string;
}) {
  try {
    const study = await getAnalysisStudyById(input);

    if (!study?.currentQuestionId) {
      return null satisfies CurrentAnalysisQuestionSummary;
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

    return (rows[0] ?? null) satisfies CurrentAnalysisQuestionSummary;
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to load analysis study question.");
  }
}

export async function updateAnalysisStudy(input: {
  description?: string | null;
  organizationId: string;
  studyId: string;
  title?: string | null;
}) {
  try {
    const existingStudy = await getAnalysisStudyById({
      organizationId: input.organizationId,
      studyId: input.studyId,
    });

    if (!existingStudy) {
      throw new Error("Analysis study not found.");
    }

    const db = await getAppDatabase();
    const now = Date.now();
    const nextTitle = input.title?.trim();
    const nextDescription = typeof input.description === "string" ? input.description.trim() : input.description;

    await db
      .update(analysisStudies)
      .set({
        description: typeof input.description === "undefined" ? undefined : nextDescription || null,
        title: nextTitle || existingStudy.title,
        updatedAt: now,
      })
      .where(eq(analysisStudies.id, input.studyId));

    return getAnalysisStudyById({
      organizationId: input.organizationId,
      studyId: input.studyId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to update analysis study.");
  }
}

export async function recordAnalysisClassification(input: {
  classification: AnalysisRoutingClassification;
  organizationId: string;
  studyQuestionId: string;
}) {
  const db = await getAppDatabase();
  const record = {
    id: randomUUID(),
    studyQuestionId: input.studyQuestionId,
    organizationId: input.organizationId,
    classifierModelName: ANALYSIS_ROUTER_MODEL_NAME,
    classifierPromptVersion: ANALYSIS_ROUTER_PROMPT_VERSION,
    rawOutputJson: input.classification.rawOutputJson,
    isAnalytical: input.classification.analysisMode === "dataset_backed_analysis",
    requiredRung: input.classification.requiredRung,
    taskForm: input.classification.taskForm,
    guardrailFlag: input.classification.guardrailFlag,
    confidence: input.classification.confidence,
    reasonText: input.classification.reason,
    routingDecision: input.classification.routingDecision,
    createdAt: Date.now(),
  } satisfies typeof analysisClassifications.$inferInsert;

  await db.insert(analysisClassifications).values(record);

  return record;
}
