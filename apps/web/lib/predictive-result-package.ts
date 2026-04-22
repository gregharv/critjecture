import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  computeRuns,
  datasetVersions,
  datasets,
  predictiveAnswerPackages,
  predictiveResults,
  predictiveRuns,
  runArtifacts,
} from "@/lib/app-schema";
import {
  PREDICTIVE_USER_CLAIM_LABEL,
  toPredictiveUserClaimLabel,
  type PredictiveStoredClaimLabel,
} from "@/lib/predictive-claim-labels";

function parsePredictiveRunMetadata(metadataJson: string) {
  try {
    const parsed = JSON.parse(metadataJson) as {
      forecastConfig?: {
        horizonUnit?: string;
        horizonValue?: number;
        timeColumnName?: string;
      } | null;
      preset?: string;
    };

    return {
      forecastConfig:
        parsed.forecastConfig &&
        typeof parsed.forecastConfig.horizonUnit === "string" &&
        typeof parsed.forecastConfig.horizonValue === "number" &&
        typeof parsed.forecastConfig.timeColumnName === "string"
          ? parsed.forecastConfig
          : null,
      preset: parsed.preset === "forecast" ? "forecast" : "standard",
    } as const;
  } catch {
    return {
      forecastConfig: null,
      preset: "standard",
    } as const;
  }
}

export async function buildAndStorePredictiveAnswerPackage(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(predictiveRuns)
    .where(and(eq(predictiveRuns.id, input.runId), eq(predictiveRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Predictive run not found.");
  }

  const metadata = parsePredictiveRunMetadata(run.metadataJson);

  const [[dataset], [datasetVersion], [result], compute, artifacts] = await Promise.all([
    db.select().from(datasets).where(eq(datasets.id, run.datasetId)),
    db.select().from(datasetVersions).where(eq(datasetVersions.id, run.datasetVersionId)),
    db.select().from(predictiveResults).where(eq(predictiveResults.runId, run.id)),
    db.select().from(computeRuns).where(eq(computeRuns.predictiveRunId, run.id)).orderBy(desc(computeRuns.createdAt)),
    db.select().from(runArtifacts).where(eq(runArtifacts.predictiveRunId, run.id)).orderBy(desc(runArtifacts.createdAt)),
  ]);

  if (!result) {
    throw new Error("A predictive result must exist before packaging grounded answers.");
  }

  const featureImportance = JSON.parse(result.featureImportanceJson) as Record<string, number>;
  const metrics = JSON.parse(result.metricsJson) as Record<string, number>;
  const packageObject = {
    artifacts: artifacts.map((artifact) => ({
      artifactKind: artifact.artifactKind,
      createdAt: artifact.createdAt,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
    })),
    computeRuns: compute.map((computeRun) => ({
      backend: computeRun.backend,
      completedAt: computeRun.completedAt,
      computeKind: computeRun.computeKind,
      createdAt: computeRun.createdAt,
      failureReason: computeRun.failureReason,
      runner: computeRun.runner,
      startedAt: computeRun.startedAt,
      status: computeRun.status,
    })),
    dataset: dataset
      ? {
          datasetKey: dataset.datasetKey,
          displayName: dataset.displayName,
          id: dataset.id,
        }
      : null,
    datasetVersion: datasetVersion
      ? {
          id: datasetVersion.id,
          rowCount: datasetVersion.rowCount,
          versionNumber: datasetVersion.versionNumber,
        }
      : null,
    limitations: [
      "This package summarizes predictive or associational performance only and does not identify causal effects.",
      "Metrics come from the stored model evaluation and should be validated against operational and future data before deployment.",
    ],
    nextSteps: [
      "Validate performance on fresh or out-of-time data before making operational decisions.",
      "Review the top features for data leakage, drift risk, and business plausibility.",
    ],
    result: {
      claimLabel: toPredictiveUserClaimLabel(result.claimLabel as PredictiveStoredClaimLabel) ?? PREDICTIVE_USER_CLAIM_LABEL,
      createdAt: result.createdAt,
      featureImportance,
      metrics,
      modelName: result.modelName,
      rowCount: result.rowCount,
      summaryText: result.summaryText,
      targetColumnName: result.targetColumnName,
      taskKind: result.taskKind,
    },
    run: {
      claimLabel: toPredictiveUserClaimLabel(run.claimLabel as PredictiveStoredClaimLabel | null | undefined),
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      datasetId: run.datasetId,
      datasetVersionId: run.datasetVersionId,
      featureColumns: JSON.parse(run.featureColumnsJson) as string[],
      forecastConfig: metadata.forecastConfig,
      modelName: run.modelName,
      preset: metadata.preset,
      requestedByUserId: run.requestedByUserId,
      runId: run.id,
      startedAt: run.startedAt,
      status: run.status,
      targetColumnName: run.targetColumnName,
      taskKind: run.taskKind,
    },
  };

  const packageJson = JSON.stringify(packageObject);
  const packageHash = createHash("sha256").update(packageJson).digest("hex");
  const now = Date.now();
  const existing = await db
    .select()
    .from(predictiveAnswerPackages)
    .where(eq(predictiveAnswerPackages.runId, run.id));

  if (existing[0]) {
    await db
      .update(predictiveAnswerPackages)
      .set({
        packageJson,
        packageHash,
      })
      .where(eq(predictiveAnswerPackages.id, existing[0].id));

    return { id: existing[0].id, packageHash, packageJson };
  }

  const packageId = `predictive-answer-package:${run.id}`;
  await db.insert(predictiveAnswerPackages).values({
    id: packageId,
    runId: run.id,
    organizationId: input.organizationId,
    packageJson,
    packageHash,
    createdAt: now,
  });

  return { id: packageId, packageHash, packageJson };
}

export async function getPredictiveRunPackage(runId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(predictiveAnswerPackages)
    .where(eq(predictiveAnswerPackages.runId, runId));

  return rows[0] ?? null;
}
