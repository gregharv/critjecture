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
  computeRuns,
  datasetVersionColumns,
  datasetVersions,
  datasets,
  organizations,
  predictiveRuns,
  runArtifacts,
  users,
} from "@/lib/app-schema";
import { executePredictiveRun, getPredictiveRunDetail } from "@/lib/predictive-analysis";
import { getAuthenticatedUserByEmail } from "@/lib/users";
import {
  createTestAppEnvironment,
  resetTestAppState,
} from "@/tests/helpers/test-environment";

async function ensureUserExists(input: { email: string; name: string; userId: string }) {
  const db = await getAppDatabase();
  const now = Date.now();
  const existingUsers = await db.select().from(users).where(eq(users.id, input.userId));

  if (existingUsers.length === 0) {
    await db.insert(users).values({
      id: input.userId,
      email: input.email,
      name: input.name,
      status: "active",
      passwordHash: "test-password-hash",
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function seedPredictiveDataset(input: { organizationId: string; organizationSlug: string }) {
  const db = await getAppDatabase();
  const now = Date.now();
  const existingOrganizations = await db.select().from(organizations).where(eq(organizations.id, input.organizationId));

  if (existingOrganizations.length === 0) {
    await db.insert(organizations).values({
      id: input.organizationId,
      name: "Critjecture Test Org",
      slug: input.organizationSlug,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

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
      id: "column-time",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "event_date",
      displayName: "Event date",
      physicalType: "timestamp",
      semanticType: "time",
      columnOrder: 0,
      nullCount: 0,
      distinctCount: 120,
      statsJson: "{}",
      createdAt: now,
    },
    {
      id: "column-feature-1",
      datasetVersionId: "dataset-version-1",
      organizationId: input.organizationId,
      columnName: "discount_rate",
      displayName: "Discount rate",
      physicalType: "float64",
      semanticType: "numeric",
      columnOrder: 1,
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
      columnOrder: 2,
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
      columnOrder: 3,
      nullCount: 0,
      distinctCount: 2,
      statsJson: "{}",
      createdAt: now,
    },
  ]);
}

describe("predictive analysis telemetry", () => {
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

  it("records compute-run telemetry and links artifacts to predictive runs", async () => {
    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      await ensureUserExists({
        email: user!.email,
        name: user!.name,
        userId: user!.id,
      });
      await seedPredictiveDataset({
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
      });

      const result = await executePredictiveRun({
        datasetVersionId: "dataset-version-1",
        featureColumns: ["discount_rate", "seasonality"],
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
        requestedByUserId: user!.id,
        targetColumn: "conversion_rate",
        taskKind: "classification",
      });

      expect(result.id).toBeTruthy();

      const db = await getAppDatabase();
      const computeRows = await db
        .select()
        .from(computeRuns)
        .where(eq(computeRuns.predictiveRunId, result.id));
      const artifactRows = await db
        .select()
        .from(runArtifacts)
        .where(eq(runArtifacts.predictiveRunId, result.id));

      expect(computeRows).toHaveLength(1);
      expect(computeRows[0]?.computeKind).toBe("predictive_analysis");
      expect(computeRows[0]?.status).toBe("completed");
      expect(computeRows[0]?.runner).toBe("catboost-classifier");
      expect(computeRows[0]?.stdoutText).toContain("ASSOCIATIONAL");
      expect(artifactRows).toHaveLength(2);
      expect(artifactRows.some((artifact) => artifact.computeRunId === (computeRows[0]?.id ?? null))).toBe(true);
      expect(artifactRows.some((artifact) => artifact.artifactKind === "answer_package")).toBe(true);

      const detail = await getPredictiveRunDetail({
        organizationId: user!.organizationId,
        runId: result.id,
      });

      expect(detail.answerPackage).not.toBeNull();
      expect(detail.answers).toHaveLength(0);
      expect(detail.computeRuns).toHaveLength(1);
      expect(detail.computeRuns[0]?.status).toBe("completed");
      expect(detail.artifacts[0]?.downloadPath).toContain(`/api/predictive/runs/${result.id}/artifacts/`);
    } finally {
      await environment.cleanup();
    }
  });

  it("stores forecast metadata and auto-includes the time column for forecast runs", async () => {
    mocks.execFileAsync.mockResolvedValueOnce({
      stderr: "",
      stdout: JSON.stringify({
        claim_label: "PREDICTIVE",
        feature_importance: {
          event_date: 0.6,
          discount_rate: 0.25,
          seasonality: 0.15,
        },
        metrics: {
          mae: 1.2,
          r2: 0.73,
        },
        model_name: "catboost_regressor",
        row_count: 120,
      }),
    });

    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      await ensureUserExists({
        email: user!.email,
        name: user!.name,
        userId: user!.id,
      });
      await seedPredictiveDataset({
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
      });

      const result = await executePredictiveRun({
        datasetVersionId: "dataset-version-1",
        featureColumns: ["discount_rate", "seasonality"],
        forecastConfig: {
          horizonUnit: "days",
          horizonValue: 12,
          timeColumnName: "event_date",
        },
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
        preset: "forecast",
        requestedByUserId: user!.id,
        targetColumn: "conversion_rate",
        taskKind: "regression",
      });

      expect(result.preset).toBe("forecast");
      expect(result.forecastConfig?.timeColumnName).toBe("event_date");
      expect(result.featureColumns).toContain("event_date");
      expect(result.summary).toContain("time-ordered holdout");

      const db = await getAppDatabase();
      const runRows = await db.select().from(predictiveRuns).where(eq(predictiveRuns.id, result.id));
      const metadata = JSON.parse(runRows[0]?.metadataJson ?? "{}") as {
        forecastConfig?: { horizonValue?: number; timeColumnName?: string };
        preset?: string;
      };

      expect(metadata.preset).toBe("forecast");
      expect(metadata.forecastConfig?.horizonValue).toBe(12);
      expect(metadata.forecastConfig?.timeColumnName).toBe("event_date");

      const detail = await getPredictiveRunDetail({
        organizationId: user!.organizationId,
        runId: result.id,
      });
      expect(detail.run.preset).toBe("forecast");
      expect(detail.run.forecastConfig?.timeColumnName).toBe("event_date");
    } finally {
      await environment.cleanup();
    }
  });

  it("marks predictive compute telemetry as failed when execution crashes", async () => {
    mocks.execFileAsync.mockRejectedValueOnce(
      Object.assign(new Error("Predictive worker crashed."), {
        stderr: "traceback",
        stdout: "partial output",
      }),
    );

    const environment = await createTestAppEnvironment();

    try {
      const user = await getAuthenticatedUserByEmail("owner@example.com");
      expect(user).not.toBeNull();
      await ensureUserExists({
        email: user!.email,
        name: user!.name,
        userId: user!.id,
      });
      await seedPredictiveDataset({
        organizationId: user!.organizationId,
        organizationSlug: user!.organizationSlug,
      });

      await expect(
        executePredictiveRun({
          datasetVersionId: "dataset-version-1",
          featureColumns: ["discount_rate", "seasonality"],
          organizationId: user!.organizationId,
          organizationSlug: user!.organizationSlug,
          requestedByUserId: user!.id,
          targetColumn: "conversion_rate",
          taskKind: "classification",
        }),
      ).rejects.toThrow("Predictive worker crashed.");

      const db = await getAppDatabase();
      const predictiveRunRows = await db.select().from(predictiveRuns);
      const computeRows = await db.select().from(computeRuns);

      expect(predictiveRunRows).toHaveLength(1);
      expect(predictiveRunRows[0]?.status).toBe("failed");
      expect(predictiveRunRows[0]?.summaryText).toBe("Predictive worker crashed.");
      expect(computeRows).toHaveLength(1);
      expect(computeRows[0]?.status).toBe("failed");
      expect(computeRows[0]?.failureReason).toBe("Predictive worker crashed.");
      expect(computeRows[0]?.stderrText).toBe("traceback");
      expect(computeRows[0]?.stdoutText).toBe("partial output");
    } finally {
      await environment.cleanup();
    }
  });
});
