import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readMigrationFile(fileName: string) {
  return readFileSync(path.join(process.cwd(), "drizzle-v2", fileName), "utf8");
}

describe("rung-first classification schema migration", () => {
  it("migrates legacy mixed-taxonomy classification rows into rung-first fields", () => {
    const sqlite = new Database(":memory:");

    try {
      sqlite.exec(readMigrationFile("0000_causal_v2_baseline.sql"));

      sqlite
        .prepare(
          `INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("org_1", "Test Org", "test-org", "active", 1, 1);

      sqlite
        .prepare(
          `INSERT INTO causal_studies (
            id,
            organization_id,
            title,
            status,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("study_1", "org_1", "Study 1", "draft", "{}", 1, 1);

      sqlite
        .prepare(
          `INSERT INTO study_questions (
            id,
            study_id,
            organization_id,
            question_text,
            question_type,
            status,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("question_1", "study_1", "org_1", "Question 1", "counterfactual", "open", "{}", 1, 1);

      sqlite
        .prepare(
          `INSERT INTO study_questions (
            id,
            study_id,
            organization_id,
            question_text,
            question_type,
            status,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("question_2", "study_1", "org_1", "Question 2", "other", "open", "{}", 2, 2);

      sqlite
        .prepare(
          `INSERT INTO intent_classifications (
            id,
            study_question_id,
            organization_id,
            classifier_model_name,
            classifier_prompt_version,
            raw_output_json,
            is_causal,
            intent_type,
            confidence,
            reason_text,
            routing_decision,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "cls_counterfactual",
          "question_1",
          "org_1",
          "legacy-router",
          "legacy-prompt",
          "{}",
          1,
          "counterfactual",
          0.91,
          "legacy counterfactual classification",
          "open_causal_study",
          1,
        );

      sqlite
        .prepare(
          `INSERT INTO intent_classifications (
            id,
            study_question_id,
            organization_id,
            classifier_model_name,
            classifier_prompt_version,
            raw_output_json,
            is_causal,
            intent_type,
            confidence,
            reason_text,
            routing_decision,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "cls_predictive",
          "question_2",
          "org_1",
          "legacy-router",
          "legacy-prompt",
          "{}",
          0,
          "predictive",
          0.72,
          "legacy predictive classification",
          "open_predictive_analysis",
          2,
        );

      sqlite.exec(readMigrationFile("0001_rung_first_classification_schema.sql"));

      const rows = sqlite
        .prepare(
          `SELECT id, is_analytical, required_rung, task_form, guardrail_flag, routing_decision
           FROM intent_classifications
           ORDER BY created_at ASC`,
        )
        .all() as Array<{
        id: string;
        is_analytical: number;
        required_rung: string | null;
        task_form: string;
        guardrail_flag: string;
        routing_decision: string;
      }>;

      expect(rows).toEqual([
        {
          id: "cls_counterfactual",
          is_analytical: 1,
          required_rung: "rung_3_counterfactual",
          task_form: "compare",
          guardrail_flag: "none",
          routing_decision: "open_rung3_study",
        },
        {
          id: "cls_predictive",
          is_analytical: 1,
          required_rung: "rung_1_observational",
          task_form: "predict",
          guardrail_flag: "none",
          routing_decision: "open_rung1_analysis",
        },
      ]);
    } finally {
      sqlite.close();
    }
  });
});
