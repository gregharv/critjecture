import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  const execFileAsync = vi.fn();
  execFile[Symbol.for("nodejs.util.promisify.custom")] = execFileAsync;
  return { execFile, execFileAsync };
});

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

import { getAppDatabase } from "@/lib/app-db";
import {
  datasetVersionColumns,
  datasetVersions,
  datasets,
  organizations,
  predictiveAnswerPackages,
  predictiveAnswers,
  users,
} from "@/lib/app-schema";
import { createGroundedPredictiveAnswer, getLatestPredictiveAnswerForRun } from "@/lib/predictive-answers";
import { executePredictiveRun } from "@/lib/predictive-analysis";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

async function ensureUserExists(input: { email: string; name: string; organizationId: string; organizationSlug: string; userId: string }) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(users).values({
    id: input.userId,
    email: input.email,
    name: input.name,
    status: "active",
    passwordHash: "test-password-hash",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(organizations).values({
    id: input.organizationId,
    name: "Critjecture Test Org",
    slug: input.organizationSlug,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
}

async function seedPredictiveDataset(input: { organizationId: string; organizationSlug: string }) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db.insert(organizations).values({
    id: input.organizationId,
    name: "Critjecture Test Org",
    slug: input.organizationSlug,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(datasets).values({
    id: "dataset-1",
    organizationId: input.organizationId,
    connectionId: null,
    datasetKey: "conversions",
    displayName: "Conversions",
    description: "Conversion events",
    accessScope: "admin",
    dataKind: "table",
    grainDescription: "user-day",
    timeColumnName: "event_date",
    entityIdColumnName: "user_id",
    status: "active",
    activeVersionId: "dataset-version-1",
    metadataJson: "{}",
    createdByUserId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(datasetVersions).values({
    id: "dataset-version-1",
    datasetId: "dataset-1",
    organizationId: input.organizationId,
    versionNumber: 1,
    sourceVersionToken: "v1",
    sourceModifiedAt: now,
    contentHash: "hash-1",
    schemaHash: "schema-1",
    rowCount: 120,
    byteSize: 2048,
    materializedPath: "/tmp/conversions-v1.csv",
    ingestionStatus: "ready",
    profileStatus: "ready",
    ingestionError: null,
    profileError: null,
    indexedAt: now,
    metadataJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(datasetVersionColumns).values([
    {
      id: "column-feature-1",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "discount_rate",
      displayName: "Discount rate",
      physicalType: "float64",
      semanticType: "numeric",
      columnOrder: 0,
      nullCount: 0,
      distinctCount: 30,
      statsJson: "{}",
      createdAt: now,
    },
    {
      id: "column-feature-2",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "seasonality",
      displayName: "Seasonality",
      physicalType: "string",
      semanticType: "categorical",
      columnOrder: 1,
      nullCount: 0,
      distinctCount: 4,
      statsJson: "{}",
      createdAt: now,
    },
    {
      id: "column-target",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "conversion_rate",
      displayName: "Conversion rate",
      physicalType: "integer",
      semanticType: "boolean",
      columnOrder: 2,
      nullCount: 0,
      distinctCount: 2,
      statsJson: "{}",
      createdAt: now,
    },
  ]);
}

describe("predictive grounded answers", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await resetTestAppState();
  });

  beforeEach(() => {
    mocks.execFileAsync.mockResolvedValue({
      stderr: "",
      stdout: JSON.stringify({
        claim_label: "ASSOCIATIONAL",
        feature_importance: {
          discount_rate: 0.7,
          seasonality: 0.3,
        },
        metrics: {
          roc_auc: 0.81,
        },
        model_name: "catboost_classifier",
        row_count: 120,
      }),
    });
  });

  it("creates predictive answer packages automatically and stores grounded answer history", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      await ensureUserExists({
        email: user!.email,
        name: user!.name,
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
        userId: user!.id,
      });
      await seedPredictiveDataset({
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
      });

      const run = await executePredictiveRun({
        datasetVersionId: "dataset-version-1",
        featureColumns: ["discount_rate", "seasonality"],
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
        requestedByUserId: user!.id,
        targetColumn: "conversion_rate",
        taskKind: "classification",
      });

      const db = await getAppDatabase();
      const packageRows = await db
        .select()
        .from(predictiveAnswerPackages)
        .where(eq(predictiveAnswerPackages.runId, run.id));

      expect(packageRows).toHaveLength(1);
      expect(packageRows[0]?.packageJson).toContain("ASSOCIATIONAL");

      const answer = await createGroundedPredictiveAnswer({
        organizationId: user!.organizationId,
        runId: run.id,
      });

      expect(answer?.answerText).toContain("Grounded predictive answer");
      expect(answer?.answerText).toContain("does not establish causal effects");

      await createGroundedPredictiveAnswer({
        organizationId: user!.organizationId,
        runId: run.id,
      });

      const answerRows = await db
        .select()
        .from(predictiveAnswers)
        .where(eq(predictiveAnswers.runId, run.id));

      expect(answerRows).toHaveLength(2);
      const latest = await getLatestPredictiveAnswerForRun({
        organizationId: user!.organizationId,
        runId: run.id,
      });
      expect(latest?.id).toBe(answerRows[1]?.id);
    } finally {
      await environment.cleanup();
    }
  });
});
