import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { runAnalysisIntake } from "@/lib/analysis-intake";
import { causalStudies, intentClassifications, studyQuestions } from "@/lib/app-schema";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("analysis intake", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("keeps conceptual chat out of study creation", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runAnalysisIntake({
        message: "What is Pearl's ladder of causation?",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "continue_chat",
        nextPath: "/chat",
      });

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies);
      expect(studies).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("routes forecasting to the canonical rung-1 surface without creating a higher-rung study", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runAnalysisIntake({
        message: "Forecast next month's sales.",
        user: user!,
      });

      expect(response).toMatchObject({
        decision: "open_rung1_analysis",
        nextPath: "/analysis/observational",
      });

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies);
      expect(studies).toHaveLength(0);
    } finally {
      await environment.cleanup();
    }
  });

  it("opens a rung-2 study and persists rung-first classification records", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runAnalysisIntake({
        message: "What happens if we cut price by 10%?",
        user: user!,
      });

      expect(response.decision).toBe("open_rung2_study");
      if (response.decision !== "open_rung2_study") {
        throw new Error("Expected open_rung2_study response.");
      }

      const db = await getAppDatabase();
      const studies = await db.select().from(causalStudies).where(eq(causalStudies.id, response.studyId));
      const questions = await db
        .select()
        .from(studyQuestions)
        .where(eq(studyQuestions.id, response.studyQuestionId));
      const classifications = await db
        .select()
        .from(intentClassifications)
        .where(eq(intentClassifications.studyQuestionId, response.studyQuestionId));

      expect(studies).toHaveLength(1);
      expect(questions).toHaveLength(1);
      expect(classifications).toHaveLength(1);
      expect(classifications[0]).toMatchObject({
        isAnalytical: true,
        requiredRung: "rung_2_interventional",
        guardrailFlag: "none",
        routingDecision: "open_rung2_study",
      });
    } finally {
      await environment.cleanup();
    }
  });

  it("opens a rung-3 study and persists rung-first classification records", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();

      const response = await runAnalysisIntake({
        message: "Would churn have been lower if we had not changed onboarding?",
        user: user!,
      });

      expect(response.decision).toBe("open_rung3_study");
      if (response.decision !== "open_rung3_study") {
        throw new Error("Expected open_rung3_study response.");
      }

      const db = await getAppDatabase();
      const classifications = await db
        .select()
        .from(intentClassifications)
        .where(eq(intentClassifications.studyQuestionId, response.studyQuestionId));

      expect(classifications).toHaveLength(1);
      expect(classifications[0]).toMatchObject({
        isAnalytical: true,
        requiredRung: "rung_3_counterfactual",
        guardrailFlag: "none",
        routingDecision: "open_rung3_study",
      });
    } finally {
      await environment.cleanup();
    }
  });
});
