import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { and, asc, desc, eq } from "drizzle-orm";

import { resolveOrganizationStorageRoot, resolveRepositoryRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import { completeComputeRun, createComputeRun, failComputeRun, markComputeRunRunning } from "@/lib/compute-runs";
import {
  buildObservationalClaimSummary,
  OBSERVATIONAL_USER_CLAIM_LABEL,
  toObservationalStoredClaimLabel,
  toObservationalUserClaimLabel,
  type ObservationalStoredClaimLabel,
  type ObservationalUserClaimLabel,
} from "@/lib/observational-claim-labels";
import { buildAndStoreObservationalAnswerPackage } from "@/lib/observational-result-package";
import {
  datasetVersionColumns,
  computeRuns,
  datasetVersions,
  datasets,
  observationalAnswerPackages,
  observationalAnswers,
  observationalResults,
  observationalRuns,
  runArtifacts,
} from "@/lib/app-schema";
import { listDatasetCatalogForOrganization } from "@/lib/study-dataset-bindings";

const execFileAsync = promisify(execFile);

export const OBSERVATIONAL_CLAIM_LABELS = [OBSERVATIONAL_USER_CLAIM_LABEL] as const;
export const OBSERVATIONAL_TASK_KINDS = ["classification", "regression"] as const;
export const OBSERVATIONAL_ANALYSIS_PRESETS = ["standard", "forecast"] as const;

export type ObservationalClaimLabel = ObservationalUserClaimLabel;
export type ObservationalTaskKind = (typeof OBSERVATIONAL_TASK_KINDS)[number];
export type ObservationalAnalysisPreset = (typeof OBSERVATIONAL_ANALYSIS_PRESETS)[number];
export type ObservationalForecastConfig = {
  horizonUnit: string;
  horizonValue: number;
  timeColumnName: string;
};

export type ObservationalDatasetVersionColumn = {
  columnName: string;
  displayName: string;
  id: string;
  physicalType: string;
  semanticType: typeof datasetVersionColumns.$inferSelect.semanticType;
};

export type ObservationalDatasetCatalogItem = {
  accessScope: typeof datasets.$inferSelect.accessScope;
  datasetKey: string;
  description: string | null;
  displayName: string;
  id: string;
  versions: Array<{
    columns: ObservationalDatasetVersionColumn[];
    id: string;
    rowCount: number | null;
    versionNumber: number;
  }>;
};

export type ObservationalRunResult = {
  claimLabel: ObservationalClaimLabel;
  datasetVersionId: string;
  featureColumns: string[];
  featureImportance: Record<string, number>;
  forecastConfig: ObservationalForecastConfig | null;
  id: string;
  metrics: Record<string, number>;
  modelName: string;
  preset: ObservationalAnalysisPreset;
  rowCount: number;
  summary: string;
  targetColumn: string;
  taskKind: ObservationalTaskKind;
};

export type ObservationalRunSummary = {
  claimLabel: ObservationalClaimLabel | null;
  createdAt: number;
  datasetDisplayName: string;
  datasetVersionId: string;
  featureColumns: string[];
  forecastConfig: ObservationalForecastConfig | null;
  id: string;
  metrics: Record<string, number>;
  modelName: string | null;
  preset: ObservationalAnalysisPreset;
  status: typeof observationalRuns.$inferSelect.status;
  summaryText: string | null;
  targetColumnName: string;
  taskKind: typeof observationalRuns.$inferSelect.taskKind;
};

export type ObservationalRunDetail = {
  answerPackage: null | {
    createdAt: number;
    id: string;
    packageJson: string;
  };
  answers: Array<{
    answerFormat: string;
    answerText: string;
    createdAt: number;
    id: string;
    modelName: string;
    promptVersion: string;
  }>;
  artifacts: Array<{
    artifactKind: string;
    createdAt: number;
    downloadPath: string;
    fileName: string;
    id: string;
    mimeType: string;
  }>;
  computeRuns: Array<{
    backend: string;
    completedAt: number | null;
    computeKind: string;
    createdAt: number;
    failureReason: string | null;
    id: string;
    inputManifestJson: string;
    metadataJson: string;
    runner: string;
    startedAt: number | null;
    status: string;
    stderrText: string | null;
    stdoutText: string | null;
  }>;
  dataset: {
    datasetKey: string;
    displayName: string;
    id: string;
  } | null;
  datasetVersion: {
    id: string;
    rowCount: number | null;
    versionNumber: number;
  } | null;
  result: null | {
    claimLabel: ObservationalClaimLabel;
    createdAt: number;
    featureImportance: Record<string, number>;
    metrics: Record<string, number>;
    modelName: string;
    resultJson: string;
    rowCount: number | null;
    summaryText: string;
    taskKind: ObservationalTaskKind;
    targetColumnName: string;
  };
  run: {
    claimLabel: ObservationalClaimLabel | null;
    completedAt: number | null;
    createdAt: number;
    datasetVersionId: string;
    featureColumns: string[];
    forecastConfig: ObservationalForecastConfig | null;
    id: string;
    modelName: string | null;
    preset: ObservationalAnalysisPreset;
    startedAt: number | null;
    status: typeof observationalRuns.$inferSelect.status;
    summaryText: string | null;
    targetColumnName: string;
    taskKind: typeof observationalRuns.$inferSelect.taskKind;
  };
};

function isTaskKind(value: unknown): value is ObservationalTaskKind {
  return typeof value === "string" && (OBSERVATIONAL_TASK_KINDS as readonly string[]).includes(value);
}

function isAnalysisPreset(value: unknown): value is ObservationalAnalysisPreset {
  return typeof value === "string" && (OBSERVATIONAL_ANALYSIS_PRESETS as readonly string[]).includes(value);
}

function parseObservationalRunMetadata(metadataJson: string) {
  try {
    const parsed = JSON.parse(metadataJson) as {
      forecastConfig?: Partial<ObservationalForecastConfig> | null;
      preset?: ObservationalAnalysisPreset;
    };
    const forecastConfig =
      parsed.forecastConfig &&
      typeof parsed.forecastConfig.horizonUnit === "string" &&
      typeof parsed.forecastConfig.horizonValue === "number" &&
      typeof parsed.forecastConfig.timeColumnName === "string"
        ? {
            horizonUnit: parsed.forecastConfig.horizonUnit,
            horizonValue: parsed.forecastConfig.horizonValue,
            timeColumnName: parsed.forecastConfig.timeColumnName,
          }
        : null;

    return {
      forecastConfig,
      preset: isAnalysisPreset(parsed.preset) ? parsed.preset : "standard",
    } as const;
  } catch {
    return {
      forecastConfig: null,
      preset: "standard",
    } as const;
  }
}

async function getLocalPythonRunnerPath() {
  const repositoryRoot = await resolveRepositoryRoot();
  return path.join(repositoryRoot, "packages", "python-sandbox", ".venv", "bin", "python");
}

async function ensureObservationalArtifact(input: {
  artifactKind: typeof runArtifacts.$inferInsert.artifactKind;
  computeRunId?: string | null;
  fileName: string;
  organizationId: string;
  organizationSlug: string;
  runId: string;
  text: string;
}) {
  const db = await getAppDatabase();
  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);
  const artifactDir = path.join(organizationRoot, "observational_runs", input.runId);
  await mkdir(artifactDir, { recursive: true });
  const storagePath = path.join(artifactDir, input.fileName);
  await writeFile(storagePath, input.text, "utf8");
  const contentHash = createHash("sha256").update(input.text).digest("hex");

  await db.insert(runArtifacts).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    studyId: null,
    runId: null,
    predictiveRunId: input.runId,
    computeRunId: input.computeRunId ?? null,
    artifactKind: input.artifactKind,
    storagePath,
    fileName: input.fileName,
    mimeType: input.fileName.endsWith(".json") ? "application/json" : "text/plain",
    byteSize: Buffer.byteLength(input.text, "utf8"),
    contentHash,
    metadataJson: "{}",
    createdAt: Date.now(),
    expiresAt: null,
  });
}

function getProcessOutputText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function inferTaskKindFromColumn(column: typeof datasetVersionColumns.$inferSelect): ObservationalTaskKind {
  if (column.semanticType === "boolean" || column.semanticType === "categorical") {
    return "classification";
  }

  const physical = column.physicalType.trim().toLowerCase();
  if (physical === "bool" || physical === "boolean") {
    return "classification";
  }

  return "regression";
}

export function buildCatBoostObservationalScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import pandas as pd",
    "from catboost import CatBoostClassifier, CatBoostRegressor",
    "from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score",
    "from sklearn.model_selection import train_test_split",
    "from math import ceil",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "feature_columns = config['feature_columns']",
    "target_column = config['target_column']",
    "task_kind = config.get('task_kind', 'classification')",
    "time_column = config.get('time_column')",
    "forecast_horizon = config.get('forecast_horizon')",
    "suffix = pathlib.Path(dataset_path).suffix.lower()",
    "if suffix == '.csv':",
    "    frame = pd.read_csv(dataset_path)",
    "elif suffix == '.tsv':",
    "    frame = pd.read_csv(dataset_path, sep='\t')",
    "elif suffix == '.parquet':",
    "    frame = pd.read_parquet(dataset_path)",
    "elif suffix in ('.json', '.ndjson'):",
    "    frame = pd.read_json(dataset_path, lines=True)",
    "else:",
    "    raise ValueError(f'Unsupported dataset format: {suffix}')",
    "selected_columns = [*feature_columns, target_column]",
    "if time_column and time_column not in selected_columns:",
    "    selected_columns.append(time_column)",
    "frame = frame[selected_columns].dropna().reset_index(drop=True)",
    "if len(frame) < 10:",
    "    raise ValueError('At least ten complete rows are required for observational analysis.')",
    "if time_column:",
    "    frame = frame.sort_values(by=time_column).reset_index(drop=True)",
    "X = frame[feature_columns]",
    "y = frame[target_column]",
    "if time_column:",
    "    horizon = int(forecast_horizon or max(1, ceil(len(frame) * 0.2)))",
    "    if horizon <= 0:",
    "        raise ValueError('Forecast horizon must be positive.')",
    "    if horizon >= len(frame):",
    "        raise ValueError('Forecast horizon must be smaller than the available row count.')",
    "    X_train, X_test = X.iloc[:-horizon], X.iloc[-horizon:]",
    "    y_train, y_test = y.iloc[:-horizon], y.iloc[-horizon:]",
    "else:",
    "    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=7)",
    "if task_kind == 'regression':",
    "    model = CatBoostRegressor(depth=6, iterations=300, learning_rate=0.05, loss_function='RMSE', random_seed=7, verbose=0)",
    "    model.fit(X_train, y_train)",
    "    predictions = model.predict(X_test)",
    "    print(json.dumps({",
    "        'claim_label': 'PREDICTIVE',",
    "        'model_name': 'catboost_regressor',",
    "        'row_count': int(len(frame)),",
    "        'feature_importance': dict(zip(feature_columns, model.get_feature_importance().tolist())),",
    "        'metrics': {",
    "            'mae': float(mean_absolute_error(y_test, predictions)),",
    "            'r2': float(r2_score(y_test, predictions)),",
    "        },",
    "    }))",
    "else:",
    "    model = CatBoostClassifier(depth=6, iterations=300, learning_rate=0.05, loss_function='Logloss', random_seed=7, verbose=0)",
    "    model.fit(X_train, y_train)",
    "    probabilities = model.predict_proba(X_test)[:, 1]",
    "    print(json.dumps({",
    "        'claim_label': 'ASSOCIATIONAL',",
    "        'model_name': 'catboost_classifier',",
    "        'row_count': int(len(frame)),",
    "        'feature_importance': dict(zip(feature_columns, model.get_feature_importance().tolist())),",
    "        'metrics': {",
    "            'roc_auc': float(roc_auc_score(y_test, probabilities)),",
    "        },",
    "    }))",
  ].join("\n");
}

export async function listObservationalDatasetCatalog(organizationId: string): Promise<ObservationalDatasetCatalogItem[]> {
  const db = await getAppDatabase();
  const catalog = await listDatasetCatalogForOrganization(organizationId);
  const versionIds = catalog.flatMap((dataset) => dataset.versions.map((version) => version.id));

  const columnRows = versionIds.length
    ? await db
        .select()
        .from(datasetVersionColumns)
        .where(eq(datasetVersionColumns.organizationId, organizationId))
        .orderBy(asc(datasetVersionColumns.datasetVersionId), asc(datasetVersionColumns.columnOrder))
    : [];

  const columnsByVersionId = new Map<string, ObservationalDatasetVersionColumn[]>();
  for (const column of columnRows) {
    if (!versionIds.includes(column.datasetVersionId)) {
      continue;
    }

    const existing = columnsByVersionId.get(column.datasetVersionId) ?? [];
    existing.push({
      columnName: column.columnName,
      displayName: column.displayName,
      id: column.id,
      physicalType: column.physicalType,
      semanticType: column.semanticType,
    });
    columnsByVersionId.set(column.datasetVersionId, existing);
  }

  return catalog.map((dataset) => ({
    accessScope: dataset.accessScope,
    datasetKey: dataset.datasetKey,
    description: dataset.description,
    displayName: dataset.displayName,
    id: dataset.id,
    versions: dataset.versions.map((version) => ({
      columns: columnsByVersionId.get(version.id) ?? [],
      id: version.id,
      rowCount: version.rowCount,
      versionNumber: version.versionNumber,
    })),
  }));
}

export async function listObservationalRunsForOrganization(input: {
  limit?: number;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const runs = await db
    .select()
    .from(observationalRuns)
    .where(eq(observationalRuns.organizationId, input.organizationId))
    .orderBy(desc(observationalRuns.createdAt));

  const limitedRuns = typeof input.limit === "number" ? runs.slice(0, input.limit) : runs;
  const datasetIds = [...new Set(limitedRuns.map((run) => run.datasetId))];
  const resultRunIds = limitedRuns.map((run) => run.id);

  const [datasetRows, resultRows] = await Promise.all([
    datasetIds.length
      ? db.select().from(datasets).where(eq(datasets.organizationId, input.organizationId))
      : Promise.resolve([]),
    resultRunIds.length
      ? db.select().from(observationalResults).where(eq(observationalResults.organizationId, input.organizationId))
      : Promise.resolve([]),
  ]);

  const datasetById = new Map(datasetRows.map((dataset) => [dataset.id, dataset]));
  const resultByRunId = new Map(resultRows.map((result) => [result.runId, result]));

  return limitedRuns.map((run) => {
    const dataset = datasetById.get(run.datasetId);
    const result = resultByRunId.get(run.id);
    const metadata = parseObservationalRunMetadata(run.metadataJson);
    return {
      claimLabel: toObservationalUserClaimLabel(
        run.claimLabel as ObservationalStoredClaimLabel | null | undefined,
      ),
      createdAt: run.createdAt,
      datasetDisplayName: dataset?.displayName ?? run.datasetId,
      datasetVersionId: run.datasetVersionId,
      featureColumns: JSON.parse(run.featureColumnsJson) as string[],
      forecastConfig: metadata.forecastConfig,
      id: run.id,
      metrics: result ? (JSON.parse(result.metricsJson) as Record<string, number>) : {},
      modelName: run.modelName,
      preset: metadata.preset,
      status: run.status,
      summaryText: run.summaryText,
      targetColumnName: run.targetColumnName,
      taskKind: run.taskKind,
    } satisfies ObservationalRunSummary;
  });
}

export async function getObservationalArtifactDetail(input: {
  artifactId: string;
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [artifact] = await db
    .select()
    .from(runArtifacts)
    .where(and(eq(runArtifacts.id, input.artifactId), eq(runArtifacts.organizationId, input.organizationId)));

  if (!artifact || artifact.predictiveRunId !== input.runId) {
    throw new Error("Observational artifact not found.");
  }

  return artifact;
}

export async function getObservationalRunDetail(input: {
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

  const metadata = parseObservationalRunMetadata(run.metadataJson);

  const [[dataset], [datasetVersion], [result], artifacts, compute, [answerPackage], answers] = await Promise.all([
    db.select().from(datasets).where(eq(datasets.id, run.datasetId)),
    db.select().from(datasetVersions).where(eq(datasetVersions.id, run.datasetVersionId)),
    db.select().from(observationalResults).where(eq(observationalResults.runId, run.id)),
    db.select().from(runArtifacts).where(eq(runArtifacts.predictiveRunId, run.id)).orderBy(desc(runArtifacts.createdAt)),
    db.select().from(computeRuns).where(eq(computeRuns.predictiveRunId, run.id)).orderBy(desc(computeRuns.createdAt)),
    db.select().from(observationalAnswerPackages).where(eq(observationalAnswerPackages.runId, run.id)),
    db.select().from(observationalAnswers).where(eq(observationalAnswers.runId, run.id)).orderBy(desc(observationalAnswers.createdAt)),
  ]);

  return {
    answerPackage: answerPackage
      ? {
          createdAt: answerPackage.createdAt,
          id: answerPackage.id,
          packageJson: answerPackage.packageJson,
        }
      : null,
    answers: answers.map((answer) => ({
      answerFormat: answer.answerFormat,
      answerText: answer.answerText,
      createdAt: answer.createdAt,
      id: answer.id,
      modelName: answer.modelName,
      promptVersion: answer.promptVersion,
    })),
    artifacts: artifacts.map((artifact) => ({
      artifactKind: artifact.artifactKind,
      createdAt: artifact.createdAt,
      downloadPath: `/api/analysis/observational/runs/${run.id}/artifacts/${artifact.id}`,
      fileName: artifact.fileName,
      id: artifact.id,
      mimeType: artifact.mimeType,
    })),
    computeRuns: compute.map((entry) => ({
      backend: entry.backend,
      completedAt: entry.completedAt,
      computeKind: entry.computeKind,
      createdAt: entry.createdAt,
      failureReason: entry.failureReason,
      id: entry.id,
      inputManifestJson: entry.inputManifestJson,
      metadataJson: entry.metadataJson,
      runner: entry.runner,
      startedAt: entry.startedAt,
      status: entry.status,
      stderrText: entry.stderrText,
      stdoutText: entry.stdoutText,
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
    result: result
      ? {
          claimLabel:
            toObservationalUserClaimLabel(result.claimLabel as ObservationalStoredClaimLabel) ??
            OBSERVATIONAL_USER_CLAIM_LABEL,
          createdAt: result.createdAt,
          featureImportance: JSON.parse(result.featureImportanceJson) as Record<string, number>,
          metrics: JSON.parse(result.metricsJson) as Record<string, number>,
          modelName: result.modelName,
          resultJson: result.resultJson,
          rowCount: result.rowCount,
          summaryText: result.summaryText,
          taskKind: result.taskKind,
          targetColumnName: result.targetColumnName,
        }
      : null,
    run: {
      claimLabel: toObservationalUserClaimLabel(
        run.claimLabel as ObservationalStoredClaimLabel | null | undefined,
      ),
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      datasetVersionId: run.datasetVersionId,
      featureColumns: JSON.parse(run.featureColumnsJson) as string[],
      forecastConfig: metadata.forecastConfig,
      id: run.id,
      modelName: run.modelName,
      preset: metadata.preset,
      startedAt: run.startedAt,
      status: run.status,
      summaryText: run.summaryText,
      targetColumnName: run.targetColumnName,
      taskKind: run.taskKind,
    },
  } satisfies ObservationalRunDetail;
}

export async function executeObservationalRun(input: {
  datasetVersionId: string;
  featureColumns: string[];
  forecastConfig?: {
    horizonUnit?: string | null;
    horizonValue?: number | null;
    timeColumnName?: string | null;
  } | null;
  organizationId: string;
  organizationSlug: string;
  preset?: ObservationalAnalysisPreset | null;
  requestedByUserId: string;
  targetColumn: string;
  taskKind?: ObservationalTaskKind | null;
}) {
  const db = await getAppDatabase();
  const [version] = await db
    .select()
    .from(datasetVersions)
    .where(
      and(
        eq(datasetVersions.id, input.datasetVersionId),
        eq(datasetVersions.organizationId, input.organizationId),
      ),
    );

  if (!version) {
    throw new Error("Dataset version not found.");
  }

  if (version.ingestionStatus !== "ready") {
    throw new Error("Dataset version must be ready before observational analysis can run.");
  }

  const [dataset] = await db.select().from(datasets).where(eq(datasets.id, version.datasetId));

  const columns = await db
    .select()
    .from(datasetVersionColumns)
    .where(
      and(
        eq(datasetVersionColumns.datasetVersionId, input.datasetVersionId),
        eq(datasetVersionColumns.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(datasetVersionColumns.columnOrder));

  const columnByName = new Map(columns.map((column) => [column.columnName, column]));
  const targetColumn = columnByName.get(input.targetColumn) ?? null;

  if (!targetColumn) {
    throw new Error("Target column was not found on the selected dataset version.");
  }

  const featureColumns = [...new Set(input.featureColumns.map((value) => value.trim()).filter(Boolean))];

  if (featureColumns.length === 0) {
    throw new Error("At least one feature column is required.");
  }

  if (featureColumns.includes(input.targetColumn)) {
    throw new Error("Target column cannot also be used as a feature column.");
  }

  for (const featureColumn of featureColumns) {
    if (!columnByName.has(featureColumn)) {
      throw new Error(`Feature column \"${featureColumn}\" was not found on the selected dataset version.`);
    }
  }

  const taskKind = input.taskKind && isTaskKind(input.taskKind)
    ? input.taskKind
    : inferTaskKindFromColumn(targetColumn);
  const preset = input.preset && isAnalysisPreset(input.preset) ? input.preset : "standard";

  let forecastConfig: ObservationalForecastConfig | null = null;
  if (preset === "forecast") {
    const requestedTimeColumnName = input.forecastConfig?.timeColumnName?.trim() ?? "";
    const inferredTimeColumnName =
      requestedTimeColumnName ||
      dataset?.timeColumnName ||
      columns.find((column) => column.semanticType === "time")?.columnName ||
      "";

    if (!inferredTimeColumnName) {
      throw new Error("Forecast analysis requires a time column on the selected dataset version.");
    }

    if (!columnByName.has(inferredTimeColumnName)) {
      throw new Error("Selected forecast time column was not found on the dataset version.");
    }

    if (inferredTimeColumnName === input.targetColumn) {
      throw new Error("Forecast time column cannot also be the target column.");
    }

    const horizonValue = input.forecastConfig?.horizonValue ?? null;
    if (!Number.isInteger(horizonValue) || (horizonValue ?? 0) <= 0) {
      throw new Error("Forecast horizon must be a positive integer.");
    }

    const normalizedHorizonValue = Number(horizonValue);

    if (typeof version.rowCount === "number" && normalizedHorizonValue >= version.rowCount) {
      throw new Error("Forecast horizon must be smaller than the available row count.");
    }

    if (!featureColumns.includes(inferredTimeColumnName)) {
      featureColumns.push(inferredTimeColumnName);
    }

    forecastConfig = {
      horizonUnit: input.forecastConfig?.horizonUnit?.trim() || "rows",
      horizonValue: normalizedHorizonValue,
      timeColumnName: inferredTimeColumnName,
    };
  }

  const runId = randomUUID();
  const now = Date.now();

  await db.insert(observationalRuns).values({
    id: runId,
    organizationId: input.organizationId,
    datasetId: version.datasetId,
    datasetVersionId: version.id,
    requestedByUserId: input.requestedByUserId,
    status: "running",
    taskKind,
    claimLabel: null,
    targetColumnName: input.targetColumn,
    featureColumnsJson: JSON.stringify(featureColumns),
    summaryText: null,
    modelName: null,
    metadataJson: JSON.stringify({
      forecastConfig,
      preset,
    }),
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
  });

  let computeRunId: string | null = null;

  try {
    const pythonPath = await getLocalPythonRunnerPath();
    const code = buildCatBoostObservationalScript();
    const payload = {
      dataset_path: version.materializedPath,
      feature_columns: featureColumns,
      forecast_horizon: forecastConfig?.horizonValue ?? null,
      target_column: input.targetColumn,
      task_kind: taskKind,
      time_column: forecastConfig?.timeColumnName ?? null,
    };
    computeRunId = await createComputeRun({
      backend: "python-sandbox-venv",
      codeText: code,
      computeKind: "predictive_analysis",
      inputManifestJson: JSON.stringify({
        datasetPath: version.materializedPath,
        datasetVersionId: version.id,
        featureColumns,
        forecastConfig,
        preset,
        targetColumn: input.targetColumn,
        taskKind,
      }),
      metadataJson: JSON.stringify({
        datasetId: version.datasetId,
        datasetVersionId: version.id,
        featureColumns,
        forecastConfig,
        predictiveRunId: runId,
        preset,
        targetColumn: input.targetColumn,
        taskKind,
      }),
      organizationId: input.organizationId,
      predictiveRunId: runId,
      runner: taskKind === "classification" ? "catboost-classifier" : "catboost-regressor",
      timeoutMs: 120_000,
    });

    await markComputeRunRunning(computeRunId);
    const { stdout, stderr } = await execFileAsync(pythonPath, ["-c", code, JSON.stringify(payload)], {
      env: { ...process.env },
      maxBuffer: 512 * 1024,
      timeout: 120_000,
    });

    const parsed = JSON.parse(stdout.trim()) as {
      claim_label?: string;
      feature_importance?: Record<string, number>;
      metrics?: Record<string, number>;
      model_name?: string;
      row_count?: number;
    };

    const rawClaimLabel = parsed.claim_label === "ASSOCIATIONAL" ? "ASSOCIATIONAL" : "PREDICTIVE";
    const claimLabel = toObservationalUserClaimLabel(rawClaimLabel) ?? OBSERVATIONAL_USER_CLAIM_LABEL;
    const metrics = parsed.metrics && typeof parsed.metrics === "object" ? parsed.metrics : {};
    const featureImportance =
      parsed.feature_importance && typeof parsed.feature_importance === "object"
        ? parsed.feature_importance
        : {};

    const metricSummary = Object.entries(metrics)
      .map(([key, value]) => `${key}=${typeof value === "number" ? value.toFixed(4) : String(value)}`)
      .join(", ");

    const forecastSummary =
      preset === "forecast" && forecastConfig
        ? ` using a time-ordered holdout of the last ${forecastConfig.horizonValue} ${forecastConfig.horizonUnit}`
        : "";
    const summary = buildObservationalClaimSummary({
      forecastSummary,
      metricSummary,
      modelName: parsed.model_name ?? "CatBoost",
    });
    const storedClaimLabel = toObservationalStoredClaimLabel(rawClaimLabel);
    const completedAt = Date.now();

    await db.insert(observationalResults).values({
      id: randomUUID(),
      runId,
      organizationId: input.organizationId,
      claimLabel: storedClaimLabel,
      taskKind,
      targetColumnName: input.targetColumn,
      featureImportanceJson: JSON.stringify(featureImportance),
      metricsJson: JSON.stringify(metrics),
      resultJson: JSON.stringify(parsed),
      summaryText: summary,
      rowCount: typeof parsed.row_count === "number" ? parsed.row_count : version.rowCount ?? null,
      modelName: parsed.model_name ?? "catboost_model",
      createdAt: completedAt,
    });

    await ensureObservationalArtifact({
      artifactKind: "misc",
      computeRunId,
      fileName: "observational_result.json",
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      runId,
      text: JSON.stringify(
        {
          claimLabel,
          datasetVersionId: version.id,
          featureColumns,
          featureImportance,
          forecastConfig,
          metrics,
          modelName: parsed.model_name ?? "catboost_model",
          preset,
          rowCount: typeof parsed.row_count === "number" ? parsed.row_count : version.rowCount ?? 0,
          summary,
          targetColumn: input.targetColumn,
          taskKind,
        },
        null,
        2,
      ),
    });

    await db
      .update(observationalRuns)
      .set({
        status: "completed",
        claimLabel: storedClaimLabel,
        summaryText: summary,
        modelName: parsed.model_name ?? "catboost_model",
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(observationalRuns.id, runId));

    await completeComputeRun({
      computeRunId,
      stderrText: stderr,
      stdoutText: stdout,
    });

    const answerPackage = await buildAndStoreObservationalAnswerPackage({
      organizationId: input.organizationId,
      runId,
    });

    await ensureObservationalArtifact({
      artifactKind: "answer_package",
      fileName: "answer_package.json",
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      runId,
      text: answerPackage.packageJson,
    });

    return {
      claimLabel,
      datasetVersionId: version.id,
      featureColumns,
      featureImportance,
      forecastConfig,
      id: runId,
      metrics,
      modelName: parsed.model_name ?? "catboost_model",
      preset,
      rowCount: typeof parsed.row_count === "number" ? parsed.row_count : version.rowCount ?? 0,
      summary,
      targetColumn: input.targetColumn,
      taskKind,
    } satisfies ObservationalRunResult;
  } catch (error) {
    const completedAt = Date.now();
    const failureReason = error instanceof Error ? error.message : "Observational analysis failed.";
    await db
      .update(observationalRuns)
      .set({
        status: "failed",
        summaryText: failureReason,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(observationalRuns.id, runId));

    if (computeRunId) {
      await failComputeRun({
        computeRunId,
        failureReason,
        stderrText: getProcessOutputText((error as { stderr?: unknown }).stderr),
        stdoutText: getProcessOutputText((error as { stdout?: unknown }).stdout),
      });
    }
    throw error;
  }
}
