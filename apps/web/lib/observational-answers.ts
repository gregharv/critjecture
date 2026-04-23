import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { observationalAnswerPackages, observationalAnswers, observationalRuns } from "@/lib/app-schema";
import { OBSERVATIONAL_USER_CLAIM_LABEL } from "@/lib/observational-claim-labels";

export const OBSERVATIONAL_ANSWER_MODEL_NAME = "grounded-observational-package-template";
export const OBSERVATIONAL_ANSWER_PROMPT_VERSION = "observational_answer_markdown_v1";

type ParsedObservationalAnswerPackage = {
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
  const parsed = JSON.parse(packageJson) as ParsedObservationalAnswerPackage;

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

function renderGroundedObservationalAnswerMarkdown(packageJson: string) {
  const parsed = parsePackageJson(packageJson);
  const datasetName = parsed.dataset?.displayName ?? parsed.dataset?.datasetKey ?? "unknown dataset";
  const runId = parsed.run.runId ?? "unknown run";
  const claimLabel = parsed.result.claimLabel ?? parsed.run.claimLabel ?? OBSERVATIONAL_USER_CLAIM_LABEL;
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
    : ["- No observational metrics were recorded."];

  return [
    "# Grounded observational answer",
    "",
    "## Conclusion",
    parsed.result.summaryText ?? "No observational summary was recorded.",
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
    ...(parsed.limitations.length
      ? parsed.limitations.map((limitation) => `- ${limitation}`)
      : ["- No additional limitations were recorded."]),
    "",
    "## Next steps",
    ...(parsed.nextSteps.length
      ? parsed.nextSteps.map((step) => `- ${step}`)
      : ["- Validate the model on additional held-out data before operational use."]),
    "",
    "## Guardrail note",
    "This answer was rendered from the stored observational answer package only. It summarizes instrumental or heuristic rung-1 output and does not establish causal effects.",
  ].join("\n");
}

export async function listObservationalAnswersForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(observationalAnswers)
    .where(and(eq(observationalAnswers.organizationId, input.organizationId), eq(observationalAnswers.runId, input.runId)))
    .orderBy(desc(observationalAnswers.createdAt));
}

export async function getLatestObservationalAnswerForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const answers = await listObservationalAnswersForRun(input);
  return answers[0] ?? null;
}

export async function createGroundedObservationalAnswer(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(observationalRuns)
    .where(and(eq(observationalRuns.id, input.runId), eq(observationalRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Observational run not found.");
  }

  const [answerPackage] = await db
    .select()
    .from(observationalAnswerPackages)
    .where(
      and(
        eq(observationalAnswerPackages.runId, run.id),
        eq(observationalAnswerPackages.organizationId, input.organizationId),
      ),
    );

  if (!answerPackage) {
    throw new Error("A stored observational answer package must exist before generating the final answer.");
  }

  const id = randomUUID();
  const createdAt = Date.now();
  const answerText = renderGroundedObservationalAnswerMarkdown(answerPackage.packageJson);

  await db.insert(observationalAnswers).values({
    id,
    runId: run.id,
    organizationId: input.organizationId,
    answerPackageId: answerPackage.id,
    modelName: OBSERVATIONAL_ANSWER_MODEL_NAME,
    promptVersion: OBSERVATIONAL_ANSWER_PROMPT_VERSION,
    answerText,
    answerFormat: "markdown",
    createdAt,
  });

  const [storedAnswer] = await db.select().from(observationalAnswers).where(eq(observationalAnswers.id, id));
  return storedAnswer ?? null;
}

export function parseObservationalAnswerPackageForDisplay(packageJson: string) {
  return parsePackageJson(packageJson);
}
