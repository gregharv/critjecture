import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { predictiveAnswerPackages, predictiveAnswers, predictiveRuns } from "@/lib/app-schema";
import { PREDICTIVE_USER_CLAIM_LABEL } from "@/lib/predictive-claim-labels";

export const PREDICTIVE_ANSWER_MODEL_NAME = "grounded-predictive-package-template";
export const PREDICTIVE_ANSWER_PROMPT_VERSION = "predictive_answer_markdown_v1";

type ParsedPredictiveAnswerPackage = {
  artifacts?: Array<{
    artifactKind?: string;
    createdAt?: number;
    fileName?: string;
    mimeType?: string;
  }>;
  computeRuns?: Array<{
    backend?: string;
    completedAt?: number | null;
    computeKind?: string;
    createdAt?: number;
    failureReason?: string | null;
    runner?: string;
    startedAt?: number | null;
    status?: string;
  }>;
  dataset?: null | {
    datasetKey?: string;
    displayName?: string;
    id?: string;
  };
  datasetVersion?: null | {
    id?: string;
    rowCount?: number | null;
    versionNumber?: number;
  };
  limitations?: string[];
  nextSteps?: string[];
  result?: {
    claimLabel?: string;
    createdAt?: number;
    featureImportance?: Record<string, number>;
    metrics?: Record<string, number>;
    modelName?: string;
    rowCount?: number | null;
    summaryText?: string;
    targetColumnName?: string;
    taskKind?: string;
  };
  run?: {
    claimLabel?: string | null;
    completedAt?: number | null;
    createdAt?: number;
    datasetId?: string;
    datasetVersionId?: string;
    featureColumns?: string[];
    forecastConfig?: {
      horizonUnit?: string;
      horizonValue?: number;
      timeColumnName?: string;
    } | null;
    modelName?: string | null;
    preset?: string;
    requestedByUserId?: string | null;
    runId?: string;
    startedAt?: number | null;
    status?: string;
    targetColumnName?: string;
    taskKind?: string;
  };
};

function parsePackageJson(packageJson: string) {
  const parsed = JSON.parse(packageJson) as ParsedPredictiveAnswerPackage;

  return {
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
    computeRuns: Array.isArray(parsed.computeRuns) ? parsed.computeRuns : [],
    dataset: parsed.dataset ?? null,
    datasetVersion: parsed.datasetVersion ?? null,
    limitations: Array.isArray(parsed.limitations) ? parsed.limitations : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    result: parsed.result ?? {},
    run: parsed.run ?? {},
  };
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "not reported";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function renderGroundedPredictiveAnswerMarkdown(packageJson: string) {
  const parsed = parsePackageJson(packageJson);
  const datasetName = parsed.dataset?.displayName ?? parsed.dataset?.datasetKey ?? "unknown dataset";
  const runId = parsed.run.runId ?? "unknown run";
  const claimLabel = parsed.result.claimLabel ?? parsed.run.claimLabel ?? PREDICTIVE_USER_CLAIM_LABEL;
  const taskKind = parsed.result.taskKind ?? parsed.run.taskKind ?? "unknown task";
  const targetColumn = parsed.result.targetColumnName ?? parsed.run.targetColumnName ?? "unknown target";
  const featureColumns = Array.isArray(parsed.run.featureColumns) ? parsed.run.featureColumns : [];
  const forecastConfig = parsed.run.forecastConfig ?? null;
  const featureImportanceEntries = Object.entries(parsed.result.featureImportance ?? {}).sort((a, b) => b[1] - a[1]);
  const metricEntries = Object.entries(parsed.result.metrics ?? {});
  const topFeatureLines = featureImportanceEntries.length
    ? featureImportanceEntries.slice(0, 5).map(([feature, value]) => `- ${feature}: ${formatNumber(value)}`)
    : ["- No feature importance values were recorded."];
  const metricLines = metricEntries.length
    ? metricEntries.map(([metric, value]) => `- ${metric}: ${formatNumber(value)}`)
    : ["- No predictive metrics were recorded."];

  return [
    "# Grounded predictive answer",
    "",
    "## Conclusion",
    parsed.result.summaryText ?? "No predictive summary was recorded.",
    "",
    "## Grounding",
    `- Dataset: ${datasetName}`,
    `- Run: ${runId}`,
    `- Claim label: ${claimLabel}`,
    `- Preset: ${parsed.run.preset ?? "standard"}`,
    `- Task kind: ${taskKind}`,
    `- Target column: ${targetColumn}`,
    `- Model: ${parsed.result.modelName ?? parsed.run.modelName ?? "not recorded"}`,
    `- Dataset version: ${parsed.datasetVersion?.versionNumber ?? "unknown"}`,
    `- Row count: ${formatNumber(parsed.result.rowCount ?? parsed.datasetVersion?.rowCount ?? null, 0)}`,
    `- Feature columns: ${featureColumns.join(", ") || "none recorded"}`,
    forecastConfig
      ? `- Forecast setup: ${forecastConfig.timeColumnName ?? "time column not recorded"} with last ${forecastConfig.horizonValue ?? "unknown"} ${forecastConfig.horizonUnit ?? "rows"}`
      : "- Evaluation split: random holdout",
    "",
    "## Metrics",
    ...metricLines,
    "",
    "## Top feature importance",
    ...topFeatureLines,
    "",
    "## Execution telemetry",
    ...(parsed.computeRuns.length
      ? parsed.computeRuns.map(
          (computeRun) =>
            `- ${computeRun.computeKind ?? "compute"}: ${computeRun.status ?? "unknown"} via ${computeRun.runner ?? "unknown runner"} on ${computeRun.backend ?? "unknown backend"}`,
        )
      : ["- No compute telemetry was recorded."]),
    "",
    "## Limitations",
    ...(parsed.limitations.length ? parsed.limitations.map((limitation) => `- ${limitation}`) : ["- No additional limitations were recorded."]),
    "",
    "## Next steps",
    ...(parsed.nextSteps.length ? parsed.nextSteps.map((step) => `- ${step}`) : ["- Validate the model on additional held-out data before operational use."]),
    "",
    "## Guardrail note",
    "This answer was rendered from the stored predictive answer package only. It summarizes instrumental or heuristic predictive output and does not establish causal effects.",
  ].join("\n");
}

export async function listPredictiveAnswersForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(predictiveAnswers)
    .where(and(eq(predictiveAnswers.organizationId, input.organizationId), eq(predictiveAnswers.runId, input.runId)))
    .orderBy(desc(predictiveAnswers.createdAt));
}

export async function getLatestPredictiveAnswerForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const answers = await listPredictiveAnswersForRun(input);
  return answers[0] ?? null;
}

export async function createGroundedPredictiveAnswer(input: {
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

  const [answerPackage] = await db
    .select()
    .from(predictiveAnswerPackages)
    .where(
      and(
        eq(predictiveAnswerPackages.runId, run.id),
        eq(predictiveAnswerPackages.organizationId, input.organizationId),
      ),
    );

  if (!answerPackage) {
    throw new Error("A predictive answer package must exist before generating the final answer.");
  }

  const id = randomUUID();
  const createdAt = Date.now();
  const answerText = renderGroundedPredictiveAnswerMarkdown(answerPackage.packageJson);

  await db.insert(predictiveAnswers).values({
    id,
    runId: run.id,
    organizationId: input.organizationId,
    answerPackageId: answerPackage.id,
    modelName: PREDICTIVE_ANSWER_MODEL_NAME,
    promptVersion: PREDICTIVE_ANSWER_PROMPT_VERSION,
    answerText,
    answerFormat: "markdown",
    createdAt,
  });

  const [storedAnswer] = await db.select().from(predictiveAnswers).where(eq(predictiveAnswers.id, id));
  return storedAnswer ?? null;
}

export function parsePredictiveAnswerPackageForDisplay(packageJson: string) {
  return parsePackageJson(packageJson);
}
