import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { resolveOrganizationStorageRoot, resolveRepositoryRoot } from "@/lib/app-paths";
import { getAppDatabase } from "@/lib/app-db";
import { loadAnalysisDagExecutionGraph, deriveIdentificationPlan } from "@/lib/analysis-graph";
import { buildAndStoreAnalysisAnswerPackage, getAnalysisRunPackage } from "@/lib/analysis-result-package";
import { createComputeRun, completeComputeRun, failComputeRun, markComputeRunRunning } from "@/lib/compute-runs";
import {
  analysisApprovals,
  analysisAnswers,
  analysisEstimates,
  analysisEstimands,
  analysisIdentifications,
  analysisRefutations,
  analysisRunDatasetBindings,
  analysisRuns,
  analysisStudies,
  computeRuns,
  datasetVersions,
  organizationSettings,
  runArtifacts,
  studyDatasetBindings,
  studyQuestions,
} from "@/lib/app-schema";
import { assertStudyHasPinnedPrimaryDataset } from "@/lib/study-dataset-bindings";

const execFileAsync = promisify(execFile);

type RunUserContext = {
  id: string;
  organizationId: string;
  organizationSlug: string;
};

type PythonExecutionResult = {
  stderr: string;
  stdout: string;
  value: Record<string, unknown>;
};

type RunnerCapabilities = {
  catboost: boolean;
  dowhy: boolean;
  econml: boolean;
  numpy: boolean;
  pandas: boolean;
  polars: boolean;
  sklearn: boolean;
};

type ResolvedCausalRunner = {
  capabilities: RunnerCapabilities;
  fallbackReason: string | null;
  pythonPath: string;
  requestedKind: typeof analysisRuns.$inferInsert.runnerKind;
  runnerKind: typeof analysisRuns.$inferInsert.runnerKind;
  runnerVersion: string;
};

async function getLocalPythonRunnerPath() {
  const repositoryRoot = await resolveRepositoryRoot();
  return path.join(repositoryRoot, "packages", "python-sandbox", ".venv", "bin", "python");
}

const runnerVersionCache = new Map<string, string>();
const runnerCapabilityCache = new Map<string, RunnerCapabilities>();

async function getRunnerVersion(pythonPath: string) {
  const cached = runnerVersionCache.get(pythonPath);

  if (cached) {
    return cached;
  }

  const { stdout, stderr } = await execFileAsync(pythonPath, ["--version"], {
    env: { ...process.env },
    timeout: 5_000,
  });
  const version = stdout.trim() || stderr.trim() || "python-runner";
  runnerVersionCache.set(pythonPath, version);
  return version;
}

async function getRunnerCapabilities(pythonPath: string) {
  const cached = runnerCapabilityCache.get(pythonPath);

  if (cached) {
    return cached;
  }

  const codeText = [
    "import importlib.util",
    "import json",
    "mods = ['catboost', 'dowhy', 'econml', 'numpy', 'pandas', 'polars', 'sklearn']",
    "print(json.dumps({name: bool(importlib.util.find_spec(name)) for name in mods}))",
  ].join("\n");
  const { stdout } = await execFileAsync(pythonPath, ["-c", codeText], {
    env: { ...process.env },
    timeout: 5_000,
  });
  const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  const capabilities = {
    catboost: parsed.catboost === true,
    dowhy: parsed.dowhy === true,
    econml: parsed.econml === true,
    numpy: parsed.numpy === true,
    pandas: parsed.pandas === true,
    polars: parsed.polars === true,
    sklearn: parsed.sklearn === true,
  } satisfies RunnerCapabilities;
  runnerCapabilityCache.set(pythonPath, capabilities);
  return capabilities;
}

function parseRequestedRunnerKind(value: string | undefined | null) {
  if (value === "pywhy" || value === "dowhy" || value === "hybrid") {
    return value;
  }

  return null;
}

async function resolveCausalRunner(policy: Awaited<ReturnType<typeof getOrganizationExecutionPolicy>>) {
  const requestedKind =
    parseRequestedRunnerKind(process.env.CRITJECTURE_CAUSAL_RUNNER_KIND) ??
    policy?.defaultRunnerKind ??
    "hybrid";
  const dedicatedPythonPath = process.env.CRITJECTURE_CAUSAL_RUNNER_PYTHON?.trim() || null;

  if (requestedKind !== "hybrid" && dedicatedPythonPath) {
    const capabilities = await getRunnerCapabilities(dedicatedPythonPath);

    if (capabilities.dowhy) {
      return {
        capabilities,
        fallbackReason: null,
        pythonPath: dedicatedPythonPath,
        requestedKind,
        runnerKind: requestedKind,
        runnerVersion: await getRunnerVersion(dedicatedPythonPath),
      } satisfies ResolvedCausalRunner;
    }

    const localPythonPath = await getLocalPythonRunnerPath();
    return {
      capabilities: await getRunnerCapabilities(localPythonPath),
      fallbackReason: "Dedicated analysis runner does not currently expose DoWhy; falling back to hybrid execution.",
      pythonPath: localPythonPath,
      requestedKind,
      runnerKind: "hybrid",
      runnerVersion: await getRunnerVersion(localPythonPath),
    } satisfies ResolvedCausalRunner;
  }

  const localPythonPath = await getLocalPythonRunnerPath();
  return {
    capabilities: await getRunnerCapabilities(localPythonPath),
    fallbackReason: requestedKind === "hybrid" ? null : "No dedicated analysis runner configured; falling back to hybrid execution.",
    pythonPath: localPythonPath,
    requestedKind,
    runnerKind: "hybrid",
    runnerVersion: await getRunnerVersion(localPythonPath),
  } satisfies ResolvedCausalRunner;
}

function buildEstimationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import numpy as np",
    "import polars as pl",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "preferred_method = config.get('method_name') or 'backdoor.econml.dml.DML'",
    "",
    "def load_frame(dataset_path, columns):",
    "    suffix = pathlib.Path(dataset_path).suffix.lower()",
    "    if suffix == '.csv':",
    "        frame = pl.scan_csv(dataset_path).select(columns).drop_nulls().collect()",
    "    elif suffix == '.tsv':",
    "        frame = pl.scan_csv(dataset_path, separator='\t').select(columns).drop_nulls().collect()",
    "    elif suffix == '.parquet':",
    "        frame = pl.scan_parquet(dataset_path).select(columns).drop_nulls().collect()",
    "    elif suffix in ('.json', '.ndjson'):",
    "        frame = pl.scan_ndjson(dataset_path).select(columns).drop_nulls().collect()",
    "    else:",
    "        raise ValueError(f'Unsupported dataset format: {suffix}')",
    "    for column in columns:",
    "        frame = frame.with_columns(pl.col(column).cast(pl.Float64, strict=False))",
    "    frame = frame.drop_nulls()",
    "    return frame",
    "",
    "def run_linear_fallback(frame, config, reason=None):",
    "    y = frame[config['outcome_column']].to_numpy()",
    "    t = frame[config['treatment_column']].to_numpy()",
    "    adjustment_arrays = [frame[column].to_numpy() for column in config['adjustment_columns']]",
    "    design_matrix = np.column_stack([np.ones(frame.height), t, *adjustment_arrays])",
    "    beta, _, rank, _ = np.linalg.lstsq(design_matrix, y, rcond=None)",
    "    residuals = y - design_matrix @ beta",
    "    degrees_of_freedom = frame.height - design_matrix.shape[1]",
    "    std_error = None",
    "    ci_low = None",
    "    ci_high = None",
    "    if degrees_of_freedom > 0:",
    "        sigma_squared = float((residuals.T @ residuals) / degrees_of_freedom)",
    "        covariance = sigma_squared * np.linalg.pinv(design_matrix.T @ design_matrix)",
    "        std_error = float(np.sqrt(max(covariance[1, 1], 0.0)))",
    "        ci_low = float(beta[1] - 1.96 * std_error)",
    "        ci_high = float(beta[1] + 1.96 * std_error)",
    "    result = {",
    "        'estimator_name': 'backdoor_linear_regression',",
    "        'effect_name': 'treatment_coefficient',",
    "        'estimate_value': float(beta[1]),",
    "        'std_error': std_error,",
    "        'confidence_interval_low': ci_low,",
    "        'confidence_interval_high': ci_high,",
    "        'p_value': None,",
    "        'row_count': int(frame.height),",
    "        'rank': int(rank),",
    "        'status': 'completed',",
    "        'method_requested': preferred_method,",
    "        'method_used': 'linear_fallback',",
    "    }",
    "    if reason:",
    "        result['fallback_reason'] = str(reason)",
    "    return result",
    "",
    "frame = load_frame(dataset_path, columns)",
    "if frame.height < 3:",
    "    raise ValueError('At least three complete rows are required for estimation.')",
    "",
    "fallback_reason = None",
    "if preferred_method == 'backdoor.econml.dml.DML' and frame.height >= max(20, len(columns) * 4):",
    "    try:",
    "        import pandas as pd",
    "        from catboost import CatBoostClassifier, CatBoostRegressor",
    "        from dowhy import CausalModel",
    "        from sklearn.linear_model import LinearRegression",
    "        from sklearn.preprocessing import PolynomialFeatures",
    "",
    "        pandas_frame = frame.to_pandas()",
    "        treatment_values = sorted({float(value) for value in pandas_frame[config['treatment_column']].tolist()})",
    "        is_binary_treatment = treatment_values in ([0.0], [1.0], [0.0, 1.0])",
    "        model_y = CatBoostRegressor(depth=6, iterations=200, learning_rate=0.05, loss_function='RMSE', random_seed=7, verbose=0)",
    "        model_t = CatBoostClassifier(depth=6, iterations=200, learning_rate=0.05, loss_function='Logloss', random_seed=7, verbose=0) if is_binary_treatment else CatBoostRegressor(depth=6, iterations=200, learning_rate=0.05, loss_function='RMSE', random_seed=7, verbose=0)",
    "        method_params = {",
    "            'init_params': {",
    "                'model_y': model_y,",
    "                'model_t': model_t,",
    "                'model_final': LinearRegression(),",
    "                'featurizer': PolynomialFeatures(degree=1, include_bias=False),",
    "                'discrete_treatment': is_binary_treatment,",
    "                'random_state': 7,",
    "            },",
    "            'fit_params': {},",
    "        }",
    "",
    "        model = CausalModel(data=pandas_frame, treatment=config['treatment_column'], outcome=config['outcome_column'], graph=config['graph_dot'])",
    "        identified_estimand = model.identify_effect(proceed_when_unidentifiable=False)",
    "        estimate = model.estimate_effect(",
    "            identified_estimand,",
    "            method_name='backdoor.econml.dml.DML',",
    "            confidence_intervals=False,",
    "            method_params=method_params,",
    "        )",
    "        value = estimate.value",
    "        if hasattr(value, 'item'):",
    "            value = value.item()",
    "        result = {",
    "            'estimator_name': 'backdoor_econml_dml',",
    "            'effect_name': 'average_treatment_effect',",
    "            'estimate_value': float(value),",
    "            'std_error': None,",
    "            'confidence_interval_low': None,",
    "            'confidence_interval_high': None,",
    "            'p_value': None,",
    "            'row_count': int(frame.height),",
    "            'status': 'completed',",
    "            'method_requested': preferred_method,",
    "            'method_used': 'dowhy_econml_dml',",
    "        }",
    "        print(json.dumps(result))",
    "        raise SystemExit(0)",
    "    except Exception as exc:",
    "        fallback_reason = f'DoWhy + EconML DML unavailable or failed: {exc}'",
    "elif preferred_method == 'backdoor.econml.dml.DML':",
    "    fallback_reason = 'DoWhy + EconML DML requires at least a modest sample; falling back to linear adjustment for the current data.'",
    "",
    "print(json.dumps(run_linear_fallback(frame, config, fallback_reason)))",
  ].join("\n");
}

function buildPropensityScoreEstimationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import numpy as np",
    "import polars as pl",
    "",
    "def sigmoid(x):",
    "    return 1.0 / (1.0 + np.exp(-np.clip(x, -30, 30)))",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "suffix = pathlib.Path(dataset_path).suffix.lower()",
    "if suffix == '.csv':",
    "    frame = pl.scan_csv(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix == '.tsv':",
    "    frame = pl.scan_csv(dataset_path, separator='\t').select(columns).drop_nulls().collect()",
    "elif suffix == '.parquet':",
    "    frame = pl.scan_parquet(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix in ('.json', '.ndjson'):",
    "    frame = pl.scan_ndjson(dataset_path).select(columns).drop_nulls().collect()",
    "else:",
    "    raise ValueError(f'Unsupported dataset format: {suffix}')",
    "",
    "for column in columns:",
    "    frame = frame.with_columns(pl.col(column).cast(pl.Float64))",
    "",
    "t = frame[config['treatment_column']].to_numpy()",
    "unique_treatments = sorted({float(value) for value in t.tolist()})",
    "if unique_treatments not in ([0.0, 1.0], [0.0], [1.0]):",
    "    print(json.dumps({'estimator_name': 'backdoor_propensity_score_weighting', 'status': 'not_run', 'reason': 'Treatment is not binary; skipping propensity-score adjustment.'}))",
    "    raise SystemExit(0)",
    "",
    "y = frame[config['outcome_column']].to_numpy()",
    "adjustment_arrays = [frame[column].to_numpy() for column in config['adjustment_columns']]",
    "X = np.column_stack([np.ones(frame.height), *adjustment_arrays]) if adjustment_arrays else np.ones((frame.height, 1))",
    "beta = np.zeros(X.shape[1])",
    "for _ in range(250):",
    "    p = sigmoid(X @ beta)",
    "    gradient = X.T @ (p - t) / frame.height",
    "    beta -= 0.5 * gradient",
    "",
    "propensity = np.clip(sigmoid(X @ beta), 0.05, 0.95)",
    "treated_weight = t / propensity",
    "control_weight = (1 - t) / (1 - propensity)",
    "treated_mean = float(np.sum(treated_weight * y) / np.sum(treated_weight))",
    "control_mean = float(np.sum(control_weight * y) / np.sum(control_weight))",
    "estimate_value = treated_mean - control_mean",
    "print(json.dumps({",
    "    'estimator_name': 'backdoor_propensity_score_weighting',",
    "    'effect_name': 'average_treatment_effect',",
    "    'estimate_value': float(estimate_value),",
    "    'status': 'completed',",
    "    'std_error': None,",
    "    'confidence_interval_low': None,",
    "    'confidence_interval_high': None,",
    "    'p_value': None,",
    "    'row_count': int(frame.height),",
    "}))",
  ].join("\n");
}

function buildRefutationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import numpy as np",
    "import polars as pl",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "suffix = pathlib.Path(dataset_path).suffix.lower()",
    "if suffix == '.csv':",
    "    frame = pl.scan_csv(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix == '.tsv':",
    "    frame = pl.scan_csv(dataset_path, separator='\t').select(columns).drop_nulls().collect()",
    "elif suffix == '.parquet':",
    "    frame = pl.scan_parquet(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix in ('.json', '.ndjson'):",
    "    frame = pl.scan_ndjson(dataset_path).select(columns).drop_nulls().collect()",
    "else:",
    "    raise ValueError(f'Unsupported dataset format: {suffix}')",
    "",
    "for column in columns:",
    "    frame = frame.with_columns(pl.col(column).cast(pl.Float64))",
    "",
    "y = frame[config['outcome_column']].to_numpy()",
    "t = frame[config['treatment_column']].to_numpy()",
    "rng = np.random.default_rng(7)",
    "placebo_t = rng.permutation(t)",
    "adjustment_arrays = [frame[column].to_numpy() for column in config['adjustment_columns']]",
    "design_matrix = np.column_stack([np.ones(frame.height), placebo_t, *adjustment_arrays])",
    "beta, _, _, _ = np.linalg.lstsq(design_matrix, y, rcond=None)",
    "placebo_effect = float(beta[1])",
    "observed_effect = float(config['observed_effect'])",
    "status = 'passed' if abs(placebo_effect) < max(abs(observed_effect) * 0.5, 1e-9) else 'warning'",
    "summary = 'Placebo treatment coefficient remained small relative to the observed estimate.' if status == 'passed' else 'Placebo treatment produced a sizable coefficient relative to the observed estimate.'",
    "print(json.dumps({",
    "    'refuter_name': 'placebo_treatment_test',",
    "    'status': status,",
    "    'summary_text': summary,",
    "    'placebo_effect': placebo_effect,",
    "}))",
  ].join("\n");
}

function buildRandomCommonCauseRefutationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import numpy as np",
    "import polars as pl",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "suffix = pathlib.Path(dataset_path).suffix.lower()",
    "if suffix == '.csv':",
    "    frame = pl.scan_csv(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix == '.tsv':",
    "    frame = pl.scan_csv(dataset_path, separator='\t').select(columns).drop_nulls().collect()",
    "elif suffix == '.parquet':",
    "    frame = pl.scan_parquet(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix in ('.json', '.ndjson'):",
    "    frame = pl.scan_ndjson(dataset_path).select(columns).drop_nulls().collect()",
    "else:",
    "    raise ValueError(f'Unsupported dataset format: {suffix}')",
    "for column in columns:",
    "    frame = frame.with_columns(pl.col(column).cast(pl.Float64))",
    "rng = np.random.default_rng(11)",
    "y = frame[config['outcome_column']].to_numpy()",
    "t = frame[config['treatment_column']].to_numpy()",
    "adjustment_arrays = [frame[column].to_numpy() for column in config['adjustment_columns']]",
    "random_common_cause = rng.normal(0.0, 1.0, frame.height)",
    "design_matrix = np.column_stack([np.ones(frame.height), t, *adjustment_arrays, random_common_cause])",
    "beta, _, _, _ = np.linalg.lstsq(design_matrix, y, rcond=None)",
    "refuted_effect = float(beta[1])",
    "observed_effect = float(config['observed_effect'])",
    "delta = abs(refuted_effect - observed_effect)",
    "status = 'passed' if delta < max(abs(observed_effect) * 0.25, 0.1) else 'warning'",
    "summary = 'Adding a random common cause did not materially change the estimated effect.' if status == 'passed' else 'The estimate shifted materially after adding a random common cause.'",
    "print(json.dumps({",
    "    'refuter_name': 'random_common_cause_check',",
    "    'status': status,",
    "    'summary_text': summary,",
    "    'refuted_effect': refuted_effect,",
    "}))",
  ].join("\n");
}

function buildSubsetRefutationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import numpy as np",
    "import polars as pl",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "suffix = pathlib.Path(dataset_path).suffix.lower()",
    "if suffix == '.csv':",
    "    frame = pl.scan_csv(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix == '.tsv':",
    "    frame = pl.scan_csv(dataset_path, separator='\t').select(columns).drop_nulls().collect()",
    "elif suffix == '.parquet':",
    "    frame = pl.scan_parquet(dataset_path).select(columns).drop_nulls().collect()",
    "elif suffix in ('.json', '.ndjson'):",
    "    frame = pl.scan_ndjson(dataset_path).select(columns).drop_nulls().collect()",
    "else:",
    "    raise ValueError(f'Unsupported dataset format: {suffix}')",
    "for column in columns:",
    "    frame = frame.with_columns(pl.col(column).cast(pl.Float64))",
    "rng = np.random.default_rng(19)",
    "indices = rng.choice(frame.height, size=max(int(frame.height * 0.8), 3), replace=False)",
    "subset = frame[indices.tolist()]",
    "y = subset[config['outcome_column']].to_numpy()",
    "t = subset[config['treatment_column']].to_numpy()",
    "adjustment_arrays = [subset[column].to_numpy() for column in config['adjustment_columns']]",
    "design_matrix = np.column_stack([np.ones(subset.height), t, *adjustment_arrays])",
    "beta, _, _, _ = np.linalg.lstsq(design_matrix, y, rcond=None)",
    "subset_effect = float(beta[1])",
    "observed_effect = float(config['observed_effect'])",
    "delta = abs(subset_effect - observed_effect)",
    "status = 'passed' if delta < max(abs(observed_effect) * 0.35, 0.1) else 'warning'",
    "summary = 'The estimate remained reasonably stable on a held-out subset.' if status == 'passed' else 'The estimate changed materially on a held-out subset.'",
    "print(json.dumps({",
    "    'refuter_name': 'subset_robustness_check',",
    "    'status': status,",
    "    'summary_text': summary,",
    "    'subset_effect': subset_effect,",
    "}))",
  ].join("\n");
}

async function executePythonJson(codeText: string, payload: Record<string, unknown>, timeoutMs = 60_000, pythonPath?: string) {
  const resolvedPythonPath = pythonPath ?? (await getLocalPythonRunnerPath());
  const { stdout, stderr } = await execFileAsync(
    resolvedPythonPath,
    ["-c", codeText, JSON.stringify(payload)],
    {
      env: { ...process.env },
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
    },
  );

  return {
    stderr,
    stdout,
    value: JSON.parse(stdout.trim()) as Record<string, unknown>,
  } satisfies PythonExecutionResult;
}

async function ensureRunArtifact(input: {
  artifactKind: typeof runArtifacts.$inferInsert.artifactKind;
  computeRunId?: string | null;
  fileName: string;
  organizationId: string;
  organizationSlug: string;
  runId: string;
  studyId: string;
  text: string;
}) {
  const db = await getAppDatabase();
  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);
  const artifactDir = path.join(organizationRoot, "causal_runs", input.runId);
  await mkdir(artifactDir, { recursive: true });
  const storagePath = path.join(artifactDir, input.fileName);
  await writeFile(storagePath, input.text, "utf8");
  const contentHash = createHash("sha256").update(input.text).digest("hex");

  await db.insert(runArtifacts).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    studyId: input.studyId,
    runId: input.runId,
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

  return storagePath;
}

function parseJsonStringArray(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function getOrganizationExecutionPolicy(organizationId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId));

  return rows[0] ?? null;
}

async function getLatestApprovalForDagVersion(dagVersionId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(analysisApprovals)
    .where(eq(analysisApprovals.dagVersionId, dagVersionId))
    .orderBy(desc(analysisApprovals.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

async function createQueuedRun(input: {
  approvalId: string | null;
  metadataJson: string;
  organizationId: string;
  primaryDatasetVersionId: string;
  questionId: string;
  runUser: RunUserContext;
  runnerKind: typeof analysisRuns.$inferInsert.runnerKind;
  runnerVersion: string;
  studyId: string;
  treatmentNodeKey: string;
  outcomeNodeKey: string;
  dagVersionId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const runId = randomUUID();

  await db.insert(analysisRuns).values({
    id: runId,
    studyId: input.studyId,
    organizationId: input.organizationId,
    studyQuestionId: input.questionId,
    dagVersionId: input.dagVersionId,
    primaryDatasetVersionId: input.primaryDatasetVersionId,
    approvalId: input.approvalId,
    treatmentNodeKey: input.treatmentNodeKey,
    outcomeNodeKey: input.outcomeNodeKey,
    status: "queued",
    runnerKind: input.runnerKind,
    runnerVersion: input.runnerVersion,
    requestedByUserId: input.runUser.id,
    failureReason: null,
    metadataJson: input.metadataJson,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return runId;
}

async function updateRunStatus(input: {
  completedAt?: number | null;
  failureReason?: string | null;
  runId: string;
  startedAt?: number | null;
  status: typeof analysisRuns.$inferInsert.status;
}) {
  const db = await getAppDatabase();
  await db
    .update(analysisRuns)
    .set({
      status: input.status,
      startedAt: input.startedAt ?? undefined,
      completedAt: input.completedAt ?? undefined,
      failureReason: input.failureReason ?? undefined,
      updatedAt: Date.now(),
    })
    .where(eq(analysisRuns.id, input.runId));
}

async function pinRunDatasetBindings(input: {
  organizationId: string;
  runId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const bindings = await db
    .select()
    .from(studyDatasetBindings)
    .where(
      and(
        eq(studyDatasetBindings.studyId, input.studyId),
        eq(studyDatasetBindings.organizationId, input.organizationId),
        eq(studyDatasetBindings.isActive, true),
      ),
    )
    .orderBy(asc(studyDatasetBindings.createdAt));

  for (const binding of bindings) {
    if (!binding.datasetVersionId) {
      continue;
    }

    await db.insert(analysisRunDatasetBindings).values({
      id: randomUUID(),
      runId: input.runId,
      organizationId: input.organizationId,
      datasetId: binding.datasetId,
      datasetVersionId: binding.datasetVersionId,
      bindingRole: binding.bindingRole,
      createdAt: Date.now(),
    });
  }
}

async function getStudyExecutionContext(input: { organizationId: string; studyId: string }) {
  const db = await getAppDatabase();
  const studyRows = await db
    .select()
    .from(analysisStudies)
    .where(and(eq(analysisStudies.id, input.studyId), eq(analysisStudies.organizationId, input.organizationId)))
    .limit(1);
  const study = studyRows[0] ?? null;
  if (!study) {
    throw new Error("Analysis study not found.");
  }
  if (!study.currentQuestionId) {
    throw new Error("An analysis study question is required before run creation.");
  }
  if (!study.currentDagVersionId) {
    throw new Error("An approved DAG version is required before run creation.");
  }

  const questionRows = await db
    .select()
    .from(studyQuestions)
    .where(eq(studyQuestions.id, study.currentQuestionId))
    .limit(1);
  const question = questionRows[0] ?? null;
  if (!question) {
    throw new Error("Study question not found.");
  }

  return { question, study };
}

async function getDatasetVersionPath(datasetVersionId: string) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(datasetVersions)
    .where(eq(datasetVersions.id, datasetVersionId))
    .limit(1);
  const version = rows[0] ?? null;
  if (!version) {
    throw new Error("Pinned dataset version not found.");
  }
  return version.materializedPath;
}

function jsonStringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function buildDowhyGraphDot(input: {
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
  nodes: Array<{ id: string; nodeKey: string; observedStatus: string }>;
}) {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node.nodeKey]));
  const nodeStatements = input.nodes.map((node) =>
    node.observedStatus === "observed"
      ? `  ${node.nodeKey};`
      : `  ${node.nodeKey} [observed=\"no\"];`,
  );
  const edgeStatements = input.edges
    .map((edge) => {
      const sourceNodeKey = nodeById.get(edge.sourceNodeId);
      const targetNodeKey = nodeById.get(edge.targetNodeId);

      if (!sourceNodeKey || !targetNodeKey) {
        return null;
      }

      return `  ${sourceNodeKey} -> ${targetNodeKey};`;
    })
    .filter((value): value is string => Boolean(value));

  return ["digraph {", ...nodeStatements, ...edgeStatements, "}"].join("\n");
}

function buildDowhyEstimationScript() {
  return buildEstimationScript();
}

function buildDowhyRefutationScript() {
  return [
    "import json",
    "import pathlib",
    "import sys",
    "import pandas as pd",
    "from dowhy import CausalModel",
    "",
    "config = json.loads(sys.argv[1])",
    "dataset_path = config['dataset_path']",
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
    "columns = [config['treatment_column'], config['outcome_column'], *config['adjustment_columns']]",
    "frame = frame[columns].dropna()",
    "model = CausalModel(data=frame, treatment=config['treatment_column'], outcome=config['outcome_column'], graph=config['graph_dot'])",
    "identified_estimand = model.identify_effect(proceed_when_unidentifiable=False)",
    "estimate = model.estimate_effect(identified_estimand, method_name=config['method_name'])",
    "method_name = config['refutation_method']",
    "kwargs = {}",
    "if method_name == 'placebo_treatment_refuter':",
    "    kwargs['placebo_type'] = 'permute'",
    "elif method_name == 'data_subset_refuter':",
    "    kwargs['subset_fraction'] = 0.8",
    "refutation = model.refute_estimate(identified_estimand, estimate, method_name=method_name, **kwargs)",
    "summary = str(refutation)",
    "new_effect = getattr(refutation, 'new_effect', None)",
    "status = 'passed'",
    "if isinstance(new_effect, (int, float)) and abs(float(new_effect) - float(estimate.value)) > max(abs(float(estimate.value)) * 0.5, 0.1):",
    "    status = 'warning'",
    "print(json.dumps({",
    "    'refuter_name': config['refuter_name'],",
    "    'status': status,",
    "    'summary_text': summary,",
    "    'new_effect': None if new_effect is None else float(new_effect),",
    "}))",
  ].join("\n");
}

async function persistEstimateRow(input: {
  adjustmentSetNodeKeys: string[];
  estimandId: string;
  organizationId: string;
  result: PythonExecutionResult;
  runId: string;
}) {
  const db = await getAppDatabase();

  const status = typeof input.result.value.status === "string" ? input.result.value.status : null;
  if (status === "not_run") {
    return null;
  }

  await db.insert(analysisEstimates).values({
    id: randomUUID(),
    runId: input.runId,
    estimandId: input.estimandId,
    organizationId: input.organizationId,
    estimatorName: String(input.result.value.estimator_name ?? "backdoor_linear_regression"),
    estimatorConfigJson: JSON.stringify({ adjustmentSet: input.adjustmentSetNodeKeys }),
    effectName: String(input.result.value.effect_name ?? "treatment_coefficient"),
    estimateValue: typeof input.result.value.estimate_value === "number" ? input.result.value.estimate_value : null,
    stdError: typeof input.result.value.std_error === "number" ? input.result.value.std_error : null,
    confidenceIntervalLow:
      typeof input.result.value.confidence_interval_low === "number"
        ? input.result.value.confidence_interval_low
        : null,
    confidenceIntervalHigh:
      typeof input.result.value.confidence_interval_high === "number"
        ? input.result.value.confidence_interval_high
        : null,
    pValue: typeof input.result.value.p_value === "number" ? input.result.value.p_value : null,
    estimateJson: JSON.stringify(input.result.value),
    createdAt: Date.now(),
  });

  return input.result.value;
}

async function persistRefutationRow(input: {
  organizationId: string;
  result: PythonExecutionResult;
  runId: string;
}) {
  const db = await getAppDatabase();
  const status =
    input.result.value.status === "passed" ||
    input.result.value.status === "failed" ||
    input.result.value.status === "warning" ||
    input.result.value.status === "not_run"
      ? input.result.value.status
      : "warning";

  await db.insert(analysisRefutations).values({
    id: randomUUID(),
    runId: input.runId,
    organizationId: input.organizationId,
    refuterName: String(input.result.value.refuter_name ?? "refutation_check"),
    status,
    summaryText: String(input.result.value.summary_text ?? "Refutation completed."),
    resultJson: JSON.stringify(input.result.value),
    createdAt: Date.now(),
  });
}

export async function createAndExecuteAnalysisRun(input: {
  runUser: RunUserContext;
  studyId: string;
}) {
  const { study, question } = await getStudyExecutionContext({
    organizationId: input.runUser.organizationId,
    studyId: input.studyId,
  });
  const primaryBinding = await assertStudyHasPinnedPrimaryDataset({
    organizationId: input.runUser.organizationId,
    studyId: input.studyId,
  });
  const graph = await loadAnalysisDagExecutionGraph({
    dagVersionId: study.currentDagVersionId!,
    organizationId: input.runUser.organizationId,
  });
  const policy = await getOrganizationExecutionPolicy(input.runUser.organizationId);
  const runner = await resolveCausalRunner(policy);
  const latestApproval = await getLatestApprovalForDagVersion(graph.version.id);

  if ((policy?.requireDagApproval ?? true) && !latestApproval) {
    throw new Error("An approval for the exact DAG version is required before creating an analysis run.");
  }

  const identificationPlan = deriveIdentificationPlan(graph);
  const treatmentNode = identificationPlan.treatmentNode;
  const outcomeNode = identificationPlan.outcomeNode;

  if (!treatmentNode || !outcomeNode) {
    throw new Error("Treatment and outcome must be pinned on the DAG version before run creation.");
  }

  const runId = await createQueuedRun({
    approvalId: latestApproval?.id ?? null,
    metadataJson: JSON.stringify({
      dedicated_runner_path: runner.pythonPath,
      execution_strategy:
        runner.runnerKind === "hybrid" ? "hybrid_dowhy_econml_with_linear_fallback_v3" : "dedicated_dowhy_econml_runner_v2",
      fallback_reason: runner.fallbackReason,
      requested_runner_kind: runner.requestedKind,
      runner_capabilities: runner.capabilities,
    }),
    organizationId: input.runUser.organizationId,
    primaryDatasetVersionId: primaryBinding.datasetVersion!.id,
    questionId: question.id,
    runUser: input.runUser,
    runnerKind: runner.runnerKind,
    runnerVersion: runner.runnerVersion,
    studyId: study.id,
    treatmentNodeKey: treatmentNode.nodeKey,
    outcomeNodeKey: outcomeNode.nodeKey,
    dagVersionId: graph.version.id,
  });

  await pinRunDatasetBindings({
    organizationId: input.runUser.organizationId,
    runId,
    studyId: study.id,
  });

  const startedAt = Date.now();
  await updateRunStatus({ runId, startedAt, status: "running" });
  const db = await getAppDatabase();
  await db
    .update(analysisStudies)
    .set({
      currentRunId: runId,
      status: "running",
      updatedAt: Date.now(),
    })
    .where(eq(analysisStudies.id, study.id));

  const identificationComputeRunId = await createComputeRun({
    backend: "application",
    codeText: "identification is executed inside the application control plane",
    computeKind: "causal_identification",
    organizationId: input.runUser.organizationId,
    runId,
    runner: "hybrid-control-plane",
    studyId: study.id,
  });

  await markComputeRunRunning(identificationComputeRunId);

  try {
    const identificationPayload = {
      adjustmentSet: identificationPlan.adjustmentSetNodeKeys,
      blockingReasons: identificationPlan.blockingReasons,
      identified: identificationPlan.identifiable,
      method: identificationPlan.method,
      treatmentNodeKey: treatmentNode.nodeKey,
      outcomeNodeKey: outcomeNode.nodeKey,
    };

    await db.insert(analysisIdentifications).values({
      id: randomUUID(),
      runId,
      organizationId: input.runUser.organizationId,
      identified: identificationPlan.identifiable,
      method: identificationPlan.method,
      estimandExpression: identificationPlan.identifiable
        ? `E[${outcomeNode.nodeKey} | do(${treatmentNode.nodeKey} + 1)] - E[${outcomeNode.nodeKey} | do(${treatmentNode.nodeKey})]`
        : null,
      adjustmentSetJson: JSON.stringify(identificationPlan.adjustmentSetNodeKeys),
      blockingReasonsJson: JSON.stringify(identificationPlan.blockingReasons),
      identificationJson: JSON.stringify(identificationPayload),
      createdAt: Date.now(),
    });

    await completeComputeRun({
      computeRunId: identificationComputeRunId,
      stdoutText: jsonStringify(identificationPayload),
    });

    await ensureRunArtifact({
      artifactKind: "misc",
      computeRunId: identificationComputeRunId,
      fileName: "identification.json",
      organizationId: input.runUser.organizationId,
      organizationSlug: input.runUser.organizationSlug,
      runId,
      studyId: study.id,
      text: jsonStringify(identificationPayload),
    });

    if (!identificationPlan.identifiable) {
      await updateRunStatus({
        completedAt: Date.now(),
        runId,
        status: "not_identifiable",
      });
      await buildAndStoreAnalysisAnswerPackage({
        organizationId: input.runUser.organizationId,
        runId,
        studyId: study.id,
      });
      const storedPackage = await getAnalysisRunPackage(runId);
      if (storedPackage) {
        await ensureRunArtifact({
          artifactKind: "answer_package",
          fileName: "answer_package.json",
          organizationId: input.runUser.organizationId,
          organizationSlug: input.runUser.organizationSlug,
          runId,
          studyId: study.id,
          text: storedPackage.packageJson,
        });
      }
      await db
        .update(analysisStudies)
        .set({
          currentRunId: runId,
          status: "blocked",
          updatedAt: Date.now(),
        })
        .where(eq(analysisStudies.id, study.id));

      return getAnalysisRunDetail({ organizationId: input.runUser.organizationId, runId });
    }

    const treatmentColumnId = treatmentNode.datasetColumnId;
    const outcomeColumnId = outcomeNode.datasetColumnId;
    if (!treatmentColumnId || !outcomeColumnId) {
      throw new Error("Treatment and outcome must map to dataset columns before estimation.");
    }

    const adjustmentNodes = graph.nodes.filter((node) => identificationPlan.adjustmentSetNodeKeys.includes(node.nodeKey));

    const estimandId = randomUUID();
    await db.insert(analysisEstimands).values({
      id: estimandId,
      runId,
      organizationId: input.runUser.organizationId,
      estimandKind: "ate",
      estimandLabel: `Effect of ${treatmentNode.label} on ${outcomeNode.label}`,
      estimandExpression: `E[${outcomeNode.nodeKey} | do(${treatmentNode.nodeKey} + 1)] - E[${outcomeNode.nodeKey} | do(${treatmentNode.nodeKey})]`,
      identificationAssumptionsJson: JSON.stringify(
        graph.assumptions.map((assumption) => ({
          assumptionType: assumption.assumptionType,
          description: assumption.description,
        })),
      ),
      createdAt: Date.now(),
    });

    await updateRunStatus({ runId, startedAt, status: "identified" });

    const datasetPath = await getDatasetVersionPath(primaryBinding.datasetVersion!.id);
    const graphDot = buildDowhyGraphDot({
      edges: graph.edges,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        nodeKey: node.nodeKey,
        observedStatus: node.observedStatus,
      })),
    });
    const preferredBackdoorMethod =
      runner.capabilities.dowhy &&
      runner.capabilities.econml &&
      runner.capabilities.catboost &&
      runner.capabilities.sklearn
        ? "backdoor.econml.dml.DML"
        : "backdoor.linear_regression";

    const estimationInput = {
      adjustment_columns: adjustmentNodes.map((node) => node.nodeKey),
      dataset_path: datasetPath,
      graph_dot: graphDot,
      method_name: preferredBackdoorMethod,
      outcome_column: outcomeNode.nodeKey,
      treatment_column: treatmentNode.nodeKey,
    };
    const primaryEstimationCode = runner.runnerKind === "hybrid" ? buildEstimationScript() : buildDowhyEstimationScript();

    const estimationComputeRunId = await createComputeRun({
      backend: runner.runnerKind === "hybrid" ? "python-sandbox-venv" : "dedicated-causal-runner",
      codeText: primaryEstimationCode,
      computeKind: "causal_estimation",
      inputManifestJson: jsonStringify({ datasetPath }),
      organizationId: input.runUser.organizationId,
      runId,
      runner:
        preferredBackdoorMethod === "backdoor.econml.dml.DML"
          ? runner.runnerKind === "hybrid"
            ? "dowhy-econml-dml-hybrid"
            : "dowhy-econml-dml"
          : runner.runnerKind === "hybrid"
            ? "linear-adjustment-fallback"
            : "dowhy-linear-regression",
      studyId: study.id,
    });
    await markComputeRunRunning(estimationComputeRunId);

    const estimationResult = await executePythonJson(primaryEstimationCode, estimationInput, 60_000, runner.pythonPath);
    await persistEstimateRow({
      adjustmentSetNodeKeys: identificationPlan.adjustmentSetNodeKeys,
      estimandId,
      organizationId: input.runUser.organizationId,
      result: estimationResult,
      runId,
    });

    await completeComputeRun({
      computeRunId: estimationComputeRunId,
      stderrText: estimationResult.stderr,
      stdoutText: estimationResult.stdout,
    });
    await ensureRunArtifact({
      artifactKind: "estimate_json",
      computeRunId: estimationComputeRunId,
      fileName: "estimate.json",
      organizationId: input.runUser.organizationId,
      organizationSlug: input.runUser.organizationSlug,
      runId,
      studyId: study.id,
      text: jsonStringify(estimationResult.value),
    });

    const observedEffect =
      typeof estimationResult.value.estimate_value === "number" ? estimationResult.value.estimate_value : 0;

    const propensityCode = runner.runnerKind === "hybrid" ? buildPropensityScoreEstimationScript() : buildDowhyEstimationScript();
    const propensityPayload = {
      ...estimationInput,
      method_name: "backdoor.propensity_score_weighting",
    };

    const propensityComputeRunId = await createComputeRun({
      backend: runner.runnerKind === "hybrid" ? "python-sandbox-venv" : "dedicated-causal-runner",
      codeText: propensityCode,
      computeKind: "causal_estimation",
      inputManifestJson: jsonStringify({ datasetPath, optional: true }),
      organizationId: input.runUser.organizationId,
      runId,
      runner: runner.runnerKind === "hybrid" ? "propensity-score-weighting" : "dowhy-propensity-score-weighting",
      studyId: study.id,
    });
    await markComputeRunRunning(propensityComputeRunId);

    try {
      const propensityResult = await executePythonJson(
        propensityCode,
        propensityPayload,
        60_000,
        runner.pythonPath,
      );
      await persistEstimateRow({
        adjustmentSetNodeKeys: identificationPlan.adjustmentSetNodeKeys,
        estimandId,
        organizationId: input.runUser.organizationId,
        result: propensityResult,
        runId,
      });
      await completeComputeRun({
        computeRunId: propensityComputeRunId,
        stderrText: propensityResult.stderr,
        stdoutText: propensityResult.stdout,
      });
      await ensureRunArtifact({
        artifactKind: "estimate_json",
        computeRunId: propensityComputeRunId,
        fileName: "estimate_propensity_score.json",
        organizationId: input.runUser.organizationId,
        organizationSlug: input.runUser.organizationSlug,
        runId,
        studyId: study.id,
        text: jsonStringify(propensityResult.value),
      });
    } catch (propensityError) {
      await failComputeRun({
        computeRunId: propensityComputeRunId,
        failureReason: propensityError instanceof Error ? propensityError.message : "Propensity-score estimation failed.",
      });
    }

    await updateRunStatus({ runId, startedAt, status: "estimated" });

    const refutationConfigs = [
      {
        codeText: runner.runnerKind === "hybrid" ? buildRefutationScript() : buildDowhyRefutationScript(),
        fileName: "refutation_placebo.json",
        payload: {
          adjustment_columns: adjustmentNodes.map((node) => node.nodeKey),
          dataset_path: datasetPath,
          graph_dot: graphDot,
          method_name: "backdoor.linear_regression",
          observed_effect: observedEffect,
          outcome_column: outcomeNode.nodeKey,
          refutation_method: runner.runnerKind === "hybrid" ? undefined : "placebo_treatment_refuter",
          refuter_name: "placebo_treatment_test",
          treatment_column: treatmentNode.nodeKey,
        },
        runnerName: runner.runnerKind === "hybrid" ? "numpy-polars-placebo" : "dowhy-placebo-refuter",
      },
      {
        codeText: runner.runnerKind === "hybrid" ? buildRandomCommonCauseRefutationScript() : buildDowhyRefutationScript(),
        fileName: "refutation_random_common_cause.json",
        payload: {
          adjustment_columns: adjustmentNodes.map((node) => node.nodeKey),
          dataset_path: datasetPath,
          graph_dot: graphDot,
          method_name: "backdoor.linear_regression",
          observed_effect: observedEffect,
          outcome_column: outcomeNode.nodeKey,
          refutation_method: runner.runnerKind === "hybrid" ? undefined : "random_common_cause",
          refuter_name: "random_common_cause_check",
          treatment_column: treatmentNode.nodeKey,
        },
        runnerName: runner.runnerKind === "hybrid" ? "numpy-polars-random-common-cause" : "dowhy-random-common-cause",
      },
      {
        codeText: runner.runnerKind === "hybrid" ? buildSubsetRefutationScript() : buildDowhyRefutationScript(),
        fileName: "refutation_subset.json",
        payload: {
          adjustment_columns: adjustmentNodes.map((node) => node.nodeKey),
          dataset_path: datasetPath,
          graph_dot: graphDot,
          method_name: "backdoor.linear_regression",
          observed_effect: observedEffect,
          outcome_column: outcomeNode.nodeKey,
          refutation_method: runner.runnerKind === "hybrid" ? undefined : "data_subset_refuter",
          refuter_name: "subset_robustness_check",
          treatment_column: treatmentNode.nodeKey,
        },
        runnerName: runner.runnerKind === "hybrid" ? "numpy-polars-subset-robustness" : "dowhy-subset-refuter",
      },
    ] as const;

    for (const refutationConfig of refutationConfigs) {
      const refutationComputeRunId = await createComputeRun({
        backend: runner.runnerKind === "hybrid" ? "python-sandbox-venv" : "dedicated-causal-runner",
        codeText: refutationConfig.codeText,
        computeKind: "causal_refutation",
        inputManifestJson: jsonStringify({ datasetPath }),
        organizationId: input.runUser.organizationId,
        runId,
        runner: refutationConfig.runnerName,
        studyId: study.id,
      });
      await markComputeRunRunning(refutationComputeRunId);

      try {
        const refutationResult = await executePythonJson(
          refutationConfig.codeText,
          refutationConfig.payload,
          60_000,
          runner.pythonPath,
        );
        await persistRefutationRow({
          organizationId: input.runUser.organizationId,
          result: refutationResult,
          runId,
        });
        await completeComputeRun({
          computeRunId: refutationComputeRunId,
          stderrText: refutationResult.stderr,
          stdoutText: refutationResult.stdout,
        });
        await ensureRunArtifact({
          artifactKind: "refutation_report",
          computeRunId: refutationComputeRunId,
          fileName: refutationConfig.fileName,
          organizationId: input.runUser.organizationId,
          organizationSlug: input.runUser.organizationSlug,
          runId,
          studyId: study.id,
          text: jsonStringify(refutationResult.value),
        });
      } catch (refutationError) {
        await failComputeRun({
          computeRunId: refutationComputeRunId,
          failureReason: refutationError instanceof Error ? refutationError.message : "Refutation failed.",
        });
      }
    }

    await updateRunStatus({ runId, startedAt, status: "refuted" });

    await updateRunStatus({
      completedAt: Date.now(),
      runId,
      startedAt,
      status: "completed",
    });

    await buildAndStoreAnalysisAnswerPackage({
      organizationId: input.runUser.organizationId,
      runId,
      studyId: study.id,
    });
    const storedPackage = await getAnalysisRunPackage(runId);
    if (storedPackage) {
      await ensureRunArtifact({
        artifactKind: "answer_package",
        fileName: "answer_package.json",
        organizationId: input.runUser.organizationId,
        organizationSlug: input.runUser.organizationSlug,
        runId,
        studyId: study.id,
        text: storedPackage.packageJson,
      });
    }

    await db
      .update(analysisStudies)
      .set({
        currentRunId: runId,
        status: "completed",
        updatedAt: Date.now(),
      })
      .where(eq(analysisStudies.id, study.id));

    return getAnalysisRunDetail({ organizationId: input.runUser.organizationId, runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis run execution failed.";
    await failComputeRun({
      computeRunId: identificationComputeRunId,
      failureReason: message,
    }).catch(() => undefined);
    await updateRunStatus({
      completedAt: Date.now(),
      failureReason: message,
      runId,
      startedAt,
      status: "failed",
    });
    await db
      .update(analysisStudies)
      .set({
        currentRunId: runId,
        status: "blocked",
        updatedAt: Date.now(),
      })
      .where(eq(analysisStudies.id, study.id));
    throw error;
  }
}

export async function listAnalysisRunsForStudy(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const runs = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.organizationId, input.organizationId), eq(analysisRuns.studyId, input.studyId)))
    .orderBy(desc(analysisRuns.createdAt));

  const runIds = runs.map((run) => run.id);

  const [identifications, estimands, estimates, refutations, answers, artifacts] = runIds.length
    ? await Promise.all([
        db
          .select()
          .from(analysisIdentifications)
          .where(inArray(analysisIdentifications.runId, runIds)),
        db
          .select()
          .from(analysisEstimands)
          .where(inArray(analysisEstimands.runId, runIds)),
        db
          .select()
          .from(analysisEstimates)
          .where(inArray(analysisEstimates.runId, runIds))
          .orderBy(desc(analysisEstimates.createdAt)),
        db
          .select()
          .from(analysisRefutations)
          .where(inArray(analysisRefutations.runId, runIds)),
        db
          .select()
          .from(analysisAnswers)
          .where(inArray(analysisAnswers.runId, runIds)),
        db
          .select()
          .from(runArtifacts)
          .where(inArray(runArtifacts.runId, runIds)),
      ])
    : [[], [], [], [], [], []];

  const identificationByRunId = new Map(identifications.map((entry) => [entry.runId, entry]));
  const estimateByRunId = new Map<string, (typeof estimates)[number]>();
  for (const estimate of estimates) {
    if (!estimateByRunId.has(estimate.runId)) {
      estimateByRunId.set(estimate.runId, estimate);
    }
  }

  const estimandLabelsByRunId = new Map<string, string[]>();
  for (const estimand of estimands) {
    estimandLabelsByRunId.set(estimand.runId, [
      ...(estimandLabelsByRunId.get(estimand.runId) ?? []),
      estimand.estimandLabel,
    ]);
  }

  const refutationCountByRunId = new Map<string, number>();
  const refuterNamesByRunId = new Map<string, string[]>();
  for (const refutation of refutations) {
    refutationCountByRunId.set(refutation.runId, (refutationCountByRunId.get(refutation.runId) ?? 0) + 1);
    refuterNamesByRunId.set(refutation.runId, [
      ...(refuterNamesByRunId.get(refutation.runId) ?? []),
      refutation.refuterName,
    ]);
  }

  const answerCountByRunId = new Map<string, number>();
  for (const answer of answers) {
    answerCountByRunId.set(answer.runId, (answerCountByRunId.get(answer.runId) ?? 0) + 1);
  }

  const artifactCountByRunId = new Map<string, number>();
  for (const artifact of artifacts) {
    if (!artifact.runId) {
      continue;
    }
    artifactCountByRunId.set(artifact.runId, (artifactCountByRunId.get(artifact.runId) ?? 0) + 1);
  }

  return runs.map((run) => {
    const identification = identificationByRunId.get(run.id) ?? null;
    const estimate = estimateByRunId.get(run.id) ?? null;

    return {
      adjustmentSet: parseJsonStringArray(identification?.adjustmentSetJson),
      artifactCount: artifactCountByRunId.get(run.id) ?? 0,
      answerCount: answerCountByRunId.get(run.id) ?? 0,
      blockingReasons: parseJsonStringArray(identification?.blockingReasonsJson),
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      estimandLabels: [...new Set(estimandLabelsByRunId.get(run.id) ?? [])].sort((left, right) => left.localeCompare(right)),
      estimatorName: estimate?.estimatorName ?? null,
      id: run.id,
      identificationMethod: identification?.method ?? null,
      identified: identification?.identified ?? null,
      outcomeNodeKey: run.outcomeNodeKey,
      primaryEstimateIntervalHigh: estimate?.confidenceIntervalHigh ?? null,
      primaryEstimateIntervalLow: estimate?.confidenceIntervalLow ?? null,
      primaryEstimateValue: estimate?.estimateValue ?? null,
      refutationCount: refutationCountByRunId.get(run.id) ?? 0,
      refuterNames: [...new Set(refuterNamesByRunId.get(run.id) ?? [])].sort((left, right) => left.localeCompare(right)),
      status: run.status,
      treatmentNodeKey: run.treatmentNodeKey,
    };
  });
}

export async function getAnalysisArtifactDetail(input: {
  artifactId: string;
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [artifact] = await db
    .select()
    .from(runArtifacts)
    .where(and(eq(runArtifacts.id, input.artifactId), eq(runArtifacts.organizationId, input.organizationId)));

  if (!artifact || artifact.runId !== input.runId) {
    throw new Error("Analysis artifact not found.");
  }

  return artifact;
}

export async function getAnalysisRunDetail(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const [run] = await db
    .select()
    .from(analysisRuns)
    .where(and(eq(analysisRuns.id, input.runId), eq(analysisRuns.organizationId, input.organizationId)));

  if (!run) {
    throw new Error("Analysis run not found.");
  }

  const [identification, estimands, estimates, refutations, compute, artifacts, answers, answerPackage] = await Promise.all([
    db.select().from(analysisIdentifications).where(eq(analysisIdentifications.runId, run.id)),
    db.select().from(analysisEstimands).where(eq(analysisEstimands.runId, run.id)),
    db.select().from(analysisEstimates).where(eq(analysisEstimates.runId, run.id)),
    db.select().from(analysisRefutations).where(eq(analysisRefutations.runId, run.id)).orderBy(desc(analysisRefutations.createdAt)),
    db.select().from(computeRuns).where(eq(computeRuns.runId, run.id)).orderBy(desc(computeRuns.createdAt)),
    db.select().from(runArtifacts).where(eq(runArtifacts.runId, run.id)).orderBy(desc(runArtifacts.createdAt)),
    db.select().from(analysisAnswers).where(eq(analysisAnswers.runId, run.id)).orderBy(desc(analysisAnswers.createdAt)),
    getAnalysisRunPackage(run.id),
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
      downloadPath: `/api/analysis/runs/${run.id}/artifacts/${artifact.id}`,
      fileName: artifact.fileName,
      id: artifact.id,
      mimeType: artifact.mimeType,
      storagePath: artifact.storagePath,
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
    estimates,
    estimands,
    identification: identification[0] ?? null,
    refutations,
    run,
  };
}
