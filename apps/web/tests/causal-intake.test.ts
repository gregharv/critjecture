import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { runCausalIntake } from "@/lib/causal-intake";
import {
  causalStudies,
  intentClassifications,
  studyQuestions,
} from "@/lib/app-schema";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("causal intake", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("opens a causal study and persists question and classification before analysis", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runCausalIntake({
        message: "Did discount rate affect conversion?",
        user: user!,
      });

      expect(response.decision).toBe("open_causal_study");
      if (response.decision !== "open_causal_study") {
        throw new Error("Expected open_causal_study response.");
      }

      const db = await getAppDatabase();
      const studies = await db
        .select()
        .from(causalStudies)
        .where(eq(causalStudies.id, response.studyId));
      const questions = await db
        .select()
        .from(studyQuestions)
        .where(eq(studyQuestions.id, response.studyQuestionId));
      const classifications = await db
        .select()
        .from(intentClassifications)
        .where(eq(intentClassifications.studyQuestionId, response.studyQuestionId));

      expect(studies).toHaveLength(1);
      expect(studies[0]).toMatchObject({
        currentQuestionId: response.studyQuestionId,
        organizationId: user!.organizationId,
        status: "awaiting_dataset",
      });

      expect(questions).toHaveLength(1);
      expect(questions[0]).toMatchObject({
        proposedOutcomeLabel: "conversion",
        proposedTreatmentLabel: "discount rate",
        questionText: "Did discount rate affect conversion?",
        questionType: "intervention_effect",
        studyId: response.studyId,
      });

      expect(classifications).toHaveLength(1);
      expect(classifications[0]).toMatchObject({
        intentType: "causal",
        isCausal: true,
        routingDecision: "open_causal_study",
        studyQuestionId: response.studyQuestionId,
      });
    } finally {
      await environment.cleanup();
    }
  });

  it("keeps descriptive requests on the secondary path and does not create a causal study", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runCausalIntake({
        message: "What happened to conversion last month?",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "continue_descriptive",
        nextPath: "/chat",
      });

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies);

      expect(studies).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("routes predictive requests to a separate predictive path and does not create a causal study", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runCausalIntake({
        message: "What predicts conversion?",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "open_predictive_analysis",
        nextPath: "/predictive",
      });

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies);

      expect(studies).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("routes diagnostic why-questions to the observational path first", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runCausalIntake({
        message: "Why did conversion drop last week?",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "continue_descriptive",
        nextPath: "/chat",
      });

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies);

      expect(studies).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("reuses the requested study when a causal intake resumes existing work", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const first = await runCausalIntake({
        message: "Did the pricing change affect activation?",
        user: user!,
      });
      expect(first.decision).toBe("open_causal_study");
      if (first.decision !== "open_causal_study") {
        throw new Error("Expected open_causal_study response.");
      }

      const second = await runCausalIntake({
        message: "What happens if we increase the trial length by seven days?",
        requestedStudyId: first.studyId,
        user: user!,
      });

      expect(second.decision).toBe("open_causal_study");
      if (second.decision !== "open_causal_study") {
        throw new Error("Expected resumed open_causal_study response.");
      }

      expect(second.proposedTreatmentLabel).toContain("trial length");
      expect(second.studyId).toBe(first.studyId);

      const db = await getAppDatabase();
      const questions = await db
        .select()
        .from(studyQuestions)
        .where(eq(studyQuestions.studyId, first.studyId));
      const refreshedStudy = await db
        .select()
        .from(causalStudies)
        .where(eq(causalStudies.id, first.studyId));

      expect(questions).toHaveLength(2);
      expect(refreshedStudy[0]?.currentQuestionId).toBe(second.studyQuestionId);
    } finally {
      await environment.cleanup();
    }
  });

  it("asks for clarification when intent is ambiguous", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runCausalIntake({
        message: "Can you help me understand conversion?",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "ask_clarification",
      });
    } finally {
      await environment.cleanup();
    }
  });
});
