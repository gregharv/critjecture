export type PredictiveHandoffTaskKind = "classification" | "regression";
export type PredictiveHandoffPreset = "forecast" | "standard";
export type PredictiveChatReturnStatus = "run_completed" | "workspace_ready";

type SearchParamsLike = {
  get(name: string): string | null;
  getAll(name: string): string[];
};

export type PredictiveHorizonLike = {
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
};

export type PredictiveWorkspaceHandoff = {
  datasetVersionId: string | null;
  featureColumns: string[];
  forecastHorizonUnit: string | null;
  forecastHorizonValue: number | null;
  planningNote: string | null;
  preset: PredictiveHandoffPreset | null;
  returnToChat: string | null;
  targetColumn: string | null;
  taskKind: PredictiveHandoffTaskKind | null;
  timeColumn: string | null;
};

export type PredictiveChatReturn = {
  claimLabel: string | null;
  datasetVersionId: string | null;
  featureColumns: string[];
  forecastHorizonUnit: string | null;
  forecastHorizonValue: number | null;
  metricHighlights: string[];
  planningNote: string | null;
  preset: PredictiveHandoffPreset | null;
  runId: string | null;
  status: PredictiveChatReturnStatus;
  summary: string | null;
  targetColumn: string | null;
  taskKind: PredictiveHandoffTaskKind | null;
  timeColumn: string | null;
  workspaceHref: string | null;
};

function normalizeString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function normalizeTaskKind(value: string | null) {
  return value === "classification" || value === "regression" ? value : null;
}

function normalizePreset(value: string | null) {
  return value === "forecast" || value === "standard" ? value : null;
}

function normalizeReturnToChat(value: string | null | undefined) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.startsWith("/chat") ? normalized : "/chat";
}

function normalizeWorkspaceHref(value: string | null | undefined) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.startsWith("/predictive") ? normalized : "/predictive";
}

function normalizeChatReturnStatus(value: string | null) {
  return value === "workspace_ready" || value === "run_completed" ? value : null;
}

export function normalizePredictiveStringArray(values: string[] | undefined) {
  if (!Array.isArray(values)) {
    return [] as string[];
  }

  return [...new Set(values.map((value) => normalizeString(value)).filter((value): value is string => Boolean(value)))];
}

export function normalizePredictivePositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parsePositiveInteger(value: string | null) {
  return value && /^\d+$/.test(value) ? Math.max(1, Number.parseInt(value, 10)) : null;
}

export function formatPredictiveHorizon(input: PredictiveHorizonLike) {
  const forecastHorizonValue = normalizePredictivePositiveInteger(input.forecastHorizonValue);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);

  return forecastHorizonValue && forecastHorizonUnit
    ? `${forecastHorizonValue} ${forecastHorizonUnit}`
    : forecastHorizonValue
      ? String(forecastHorizonValue)
      : forecastHorizonUnit;
}

export function parsePredictiveMetricHighlights(metricHighlights: string[]) {
  const parsed: Record<string, number> = {};

  for (const metric of normalizePredictiveStringArray(metricHighlights)) {
    const match = metric.match(/^\s*([a-zA-Z0-9_ -]+)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);

    if (!match) {
      continue;
    }

    const key = match[1]?.trim().toLowerCase().replaceAll(" ", "_");
    const value = Number.parseFloat(match[2] ?? "");

    if (key && Number.isFinite(value)) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function setOptionalSearchParam(params: URLSearchParams, key: string, value: string | null) {
  if (value) {
    params.set(key, value);
  }
}

function appendRepeatedSearchParam(params: URLSearchParams, key: string, values: string[]) {
  params.delete(key);

  for (const value of normalizePredictiveStringArray(values)) {
    params.append(key, value);
  }
}

export const PREDICTIVE_CHAT_RETURN_QUERY_KEYS = [
  "predictiveChatStatus",
  "predictiveClaimLabel",
  "predictiveDatasetVersionId",
  "predictiveFeatureColumn",
  "predictiveForecastHorizonUnit",
  "predictiveForecastHorizonValue",
  "predictiveMetric",
  "predictivePlanningNote",
  "predictivePreset",
  "predictiveRunId",
  "predictiveSummary",
  "predictiveTargetColumn",
  "predictiveTaskKind",
  "predictiveTimeColumn",
  "predictiveWorkspaceHref",
] as const;

export function buildPredictiveWorkspaceHref(input: {
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  planningNote?: string | null;
  preset?: PredictiveHandoffPreset | null;
  returnToChat?: string | null;
  targetColumn?: string | null;
  taskKind?: PredictiveHandoffTaskKind | null;
  timeColumn?: string | null;
}) {
  const params = new URLSearchParams();

  const datasetVersionId = normalizeString(input.datasetVersionId);
  const targetColumn = normalizeString(input.targetColumn);
  const taskKind = input.taskKind ?? null;
  const preset = input.preset ?? null;
  const timeColumn = normalizeString(input.timeColumn);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);
  const planningNote = normalizeString(input.planningNote);
  const returnToChat = normalizeReturnToChat(input.returnToChat);

  setOptionalSearchParam(params, "datasetVersionId", datasetVersionId);
  setOptionalSearchParam(params, "targetColumn", targetColumn);
  appendRepeatedSearchParam(params, "featureColumn", input.featureColumns ?? []);
  setOptionalSearchParam(params, "taskKind", taskKind);
  setOptionalSearchParam(params, "preset", preset);
  setOptionalSearchParam(params, "timeColumn", timeColumn);

  const forecastHorizonValue = normalizePredictivePositiveInteger(input.forecastHorizonValue);
  if (forecastHorizonValue) {
    params.set("forecastHorizonValue", String(forecastHorizonValue));
  }

  setOptionalSearchParam(params, "forecastHorizonUnit", forecastHorizonUnit);
  setOptionalSearchParam(params, "planningNote", planningNote);
  setOptionalSearchParam(params, "returnToChat", returnToChat);

  const query = params.toString();
  return query ? `/predictive?${query}` : "/predictive";
}

export function summarizePredictiveWorkspaceHandoff(input: {
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  openInNewTab?: boolean;
  planningNote?: string | null;
  preset?: PredictiveHandoffPreset | null;
  targetColumn?: string | null;
  taskKind?: PredictiveHandoffTaskKind | null;
  timeColumn?: string | null;
}) {
  const targetColumn = normalizeString(input.targetColumn);
  const datasetVersionId = normalizeString(input.datasetVersionId);
  const taskKind = input.taskKind ?? null;
  const preset = input.preset ?? null;
  const timeColumn = normalizeString(input.timeColumn);
  const planningNote = normalizeString(input.planningNote);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);
  const featureColumns = normalizePredictiveStringArray(input.featureColumns);
  const horizon = formatPredictiveHorizon(input);

  const sentences = ["Predictive workspace handoff is ready."];

  if (targetColumn) {
    sentences.push(`Target: ${targetColumn}.`);
  }

  if (taskKind) {
    sentences.push(`Task: ${taskKind}.`);
  }

  if (preset) {
    sentences.push(`Preset: ${preset}.`);
  }

  if (horizon) {
    sentences.push(`Prediction horizon: ${horizon}.`);
  }

  if (timeColumn) {
    sentences.push(`Time column: ${timeColumn}.`);
  }

  if (featureColumns.length > 0) {
    sentences.push(`Feature candidates: ${featureColumns.join(", ")}.`);
  }

  if (datasetVersionId) {
    sentences.push(`Dataset version: ${datasetVersionId}.`);
  }

  if (planningNote) {
    sentences.push(`Planning note: ${planningNote}.`);
  }

  sentences.push(
    input.openInNewTab === false
      ? "The predictive workspace is opening in the current tab."
      : "The predictive workspace was opened in a new tab so chat planning can continue.",
  );
  sentences.push("Next step: review the prefilled setup and run the predictive analysis when ready.");

  return sentences.join(" ");
}

export function parsePredictiveWorkspaceHandoff(
  searchParams: SearchParamsLike,
): PredictiveWorkspaceHandoff | null {
  const datasetVersionId = normalizeString(searchParams.get("datasetVersionId"));
  const targetColumn = normalizeString(searchParams.get("targetColumn"));
  const taskKind = normalizeTaskKind(searchParams.get("taskKind"));
  const preset = normalizePreset(searchParams.get("preset"));
  const timeColumn = normalizeString(searchParams.get("timeColumn"));
  const forecastHorizonUnit = normalizeString(searchParams.get("forecastHorizonUnit"));
  const planningNote = normalizeString(searchParams.get("planningNote"));
  const returnToChat = normalizeReturnToChat(searchParams.get("returnToChat"));
  const forecastHorizonValue = parsePositiveInteger(searchParams.get("forecastHorizonValue"));
  const featureColumns = normalizePredictiveStringArray(searchParams.getAll("featureColumn"));

  if (
    !datasetVersionId &&
    !targetColumn &&
    featureColumns.length === 0 &&
    !taskKind &&
    !preset &&
    !timeColumn &&
    !forecastHorizonUnit &&
    !forecastHorizonValue &&
    !planningNote &&
    !returnToChat
  ) {
    return null;
  }

  return {
    datasetVersionId,
    featureColumns,
    forecastHorizonUnit,
    forecastHorizonValue,
    planningNote,
    preset,
    returnToChat,
    targetColumn,
    taskKind,
    timeColumn,
  };
}

export function buildPredictiveChatReturnHref(input: {
  claimLabel?: string | null;
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  metricHighlights?: string[];
  planningNote?: string | null;
  preset?: PredictiveHandoffPreset | null;
  returnToChat?: string | null;
  runId?: string | null;
  status: PredictiveChatReturnStatus;
  summary?: string | null;
  targetColumn?: string | null;
  taskKind?: PredictiveHandoffTaskKind | null;
  timeColumn?: string | null;
  workspaceHref?: string | null;
}) {
  const baseHref = normalizeReturnToChat(input.returnToChat) ?? "/chat";
  const url = new URL(baseHref, "https://critjecture.local");
  const claimLabel = normalizeString(input.claimLabel);
  const datasetVersionId = normalizeString(input.datasetVersionId);
  const featureColumns = normalizePredictiveStringArray(input.featureColumns);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);
  const forecastHorizonValue = normalizePredictivePositiveInteger(input.forecastHorizonValue);
  const metricHighlights = normalizePredictiveStringArray(input.metricHighlights);
  const planningNote = normalizeString(input.planningNote);
  const runId = normalizeString(input.runId);
  const summary = normalizeString(input.summary);
  const targetColumn = normalizeString(input.targetColumn);
  const timeColumn = normalizeString(input.timeColumn);
  const workspaceHref = normalizeWorkspaceHref(input.workspaceHref);

  url.searchParams.set("predictiveChatStatus", input.status);

  if (claimLabel) {
    url.searchParams.set("predictiveClaimLabel", claimLabel);
  }

  if (datasetVersionId) {
    url.searchParams.set("predictiveDatasetVersionId", datasetVersionId);
  }

  appendRepeatedSearchParam(url.searchParams, "predictiveFeatureColumn", featureColumns);

  if (forecastHorizonUnit) {
    url.searchParams.set("predictiveForecastHorizonUnit", forecastHorizonUnit);
  }

  if (forecastHorizonValue) {
    url.searchParams.set("predictiveForecastHorizonValue", String(forecastHorizonValue));
  }

  appendRepeatedSearchParam(url.searchParams, "predictiveMetric", metricHighlights);

  setOptionalSearchParam(url.searchParams, "predictivePlanningNote", planningNote);
  setOptionalSearchParam(url.searchParams, "predictivePreset", input.preset ?? null);
  setOptionalSearchParam(url.searchParams, "predictiveRunId", runId);
  setOptionalSearchParam(url.searchParams, "predictiveSummary", summary);
  setOptionalSearchParam(url.searchParams, "predictiveTargetColumn", targetColumn);
  setOptionalSearchParam(url.searchParams, "predictiveTaskKind", input.taskKind ?? null);
  setOptionalSearchParam(url.searchParams, "predictiveTimeColumn", timeColumn);
  setOptionalSearchParam(url.searchParams, "predictiveWorkspaceHref", workspaceHref);

  return `${url.pathname}${url.search}`;
}

export function parsePredictiveChatReturn(
  searchParams: SearchParamsLike,
): PredictiveChatReturn | null {
  const status = normalizeChatReturnStatus(searchParams.get("predictiveChatStatus"));

  if (!status) {
    return null;
  }

  return {
    claimLabel: normalizeString(searchParams.get("predictiveClaimLabel")),
    datasetVersionId: normalizeString(searchParams.get("predictiveDatasetVersionId")),
    featureColumns: normalizePredictiveStringArray(searchParams.getAll("predictiveFeatureColumn")),
    forecastHorizonUnit: normalizeString(searchParams.get("predictiveForecastHorizonUnit")),
    forecastHorizonValue: parsePositiveInteger(searchParams.get("predictiveForecastHorizonValue")),
    metricHighlights: normalizePredictiveStringArray(searchParams.getAll("predictiveMetric")),
    planningNote: normalizeString(searchParams.get("predictivePlanningNote")),
    preset: normalizePreset(searchParams.get("predictivePreset")),
    runId: normalizeString(searchParams.get("predictiveRunId")),
    status,
    summary: normalizeString(searchParams.get("predictiveSummary")),
    targetColumn: normalizeString(searchParams.get("predictiveTargetColumn")),
    taskKind: normalizeTaskKind(searchParams.get("predictiveTaskKind")),
    timeColumn: normalizeString(searchParams.get("predictiveTimeColumn")),
    workspaceHref: normalizeWorkspaceHref(searchParams.get("predictiveWorkspaceHref")),
  };
}

export function clearPredictiveChatReturnParams(url: URL) {
  for (const key of PREDICTIVE_CHAT_RETURN_QUERY_KEYS) {
    url.searchParams.delete(key);
  }
}
