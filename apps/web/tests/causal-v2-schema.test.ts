import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { getAppDatabase } from "@/lib/app-db";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

describe("causal V2 schema baseline", () => {
  afterEach(async () => {
    await resetTestAppState();
  });

  it("boots the clean-slate V2 schema around causal studies instead of chat/workflow tables", async () => {
    const environment = await createTestAppEnvironment();

    try {
      await getAppDatabase();

      const sqlite = new Database(environment.databaseFilePath, { readonly: true });

      const tableNames = new Set(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => String((row as { name: string }).name)),
      );

      const indexNames = new Set(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all()
          .map((row) => String((row as { name: string }).name)),
      );

      sqlite.close();

      expect(tableNames.has("causal_studies")).toBe(true);
      expect(tableNames.has("study_questions")).toBe(true);
      expect(tableNames.has("intent_classifications")).toBe(true);
      expect(tableNames.has("causal_dag_versions")).toBe(true);
      expect(tableNames.has("causal_runs")).toBe(true);
      expect(tableNames.has("causal_answer_packages")).toBe(true);

      expect(tableNames.has("conversations")).toBe(false);
      expect(tableNames.has("chat_turns")).toBe(false);
      expect(tableNames.has("workflow_runs")).toBe(false);
      expect(tableNames.has("analysis_results")).toBe(false);

      expect(indexNames.has("study_dataset_bindings_one_active_primary_idx")).toBe(true);
    } finally {
      await environment.cleanup();
    }
  });
});
