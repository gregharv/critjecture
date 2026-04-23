export type ObservationalHandoffTaskKind = "classification" | "regression";
export type ObservationalHandoffPreset = "forecast" | "standard";
export type ObservationalChatReturnStatus = "run_completed" | "workspace_ready";

type SearchParamsLike = {
  get(name: string): string | null;
  getAll(name: string): string[];
};

export type ObservationalHorizonLike = {
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
};

export type ObservationalWorkspaceHandoff = {
  datasetVersionId: string | null;
  featureColumns: string[];
  forecastHorizonUnit: string | null;
  forecastHorizonValue: number | null;
  planningNote: string | null;
  preset: ObservationalHandoffPreset | null;
  returnToChat: string | null;
  targetColumn: string | null;
  taskKind: ObservationalHandoffTaskKind | null;
  timeColumn: string | null;
};

export type ObservationalChatReturn = {
  claimLabel: string | null;
  datasetVersionId: string | null;
  featureColumns: string[];
  forecastHorizonUnit: string | null;
  forecastHorizonValue: number | null;
  metricHighlights: string[];
  planningNote: string | null;
  preset: ObservationalHandoffPreset | null;
  runId: string | null;
  status: ObservationalChatReturnStatus;
  summary: string | null;
  targetColumn: string | null;
  taskKind: ObservationalHandoffTaskKind | null;
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

  return normalized.startsWith("/analysis/observational")
    ? normalized
    : "/analysis/observational";
}

function normalizeChatReturnStatus(value: string | null) {
  return value === "workspace_ready" || value === "run_completed" ? value : null;
}

export function normalizeObservationalStringArray(values: string[] | undefined) {
  if (!Array.isArray(values)) {
    return [] as string[];
  }

  return [...new Set(values.map((value) => normalizeString(value)).filter((value): value is string => Boolean(value)))];
}

export function normalizeObservationalPositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function parsePositiveInteger(value: string | null) {
  return value && /^\d+$/.test(value) ? Math.max(1, Number.parseInt(value, 10)) : null;
}

export function formatObservationalHorizon(input: ObservationalHorizonLike) {
  const forecastHorizonValue = normalizeObservationalPositiveInteger(input.forecastHorizonValue);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);

  return forecastHorizonValue && forecastHorizonUnit
    ? `${forecastHorizonValue} ${forecastHorizonUnit}`
    : forecastHorizonValue
      ? String(forecastHorizonValue)
      : forecastHorizonUnit;
}

export function parseObservationalMetricHighlights(metricHighlights: string[]) {
  const parsed: Record<string, number> = {};

  for (const metric of normalizeObservationalStringArray(metricHighlights)) {
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

  for (const value of normalizeObservationalStringArray(values)) {
    params.append(key, value);
  }
}

const PRIMARY_OBSERVATIONAL_CHAT_RETURN_QUERY_KEYS = [
  "observationalChatStatus",
  "observationalClaimLabel",
  "observationalDatasetVersionId",
  "observationalFeatureColumn",
  "observationalForecastHorizonUnit",
  "observationalForecastHorizonValue",
  "observationalMetric",
  "observationalPlanningNote",
  "observationalPreset",
  "observationalRunId",
  "observationalSummary",
  "observationalTargetColumn",
  "observationalTaskKind",
  "observationalTimeColumn",
  "observationalWorkspaceHref",
] as const;

export const OBSERVATIONAL_CHAT_RETURN_QUERY_KEYS = [
  ...PRIMARY_OBSERVATIONAL_CHAT_RETURN_QUERY_KEYS,
] as const;

export function buildObservationalWorkspaceHref(input: {
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  planningNote?: string | null;
  preset?: ObservationalHandoffPreset | null;
  returnToChat?: string | null;
  targetColumn?: string | null;
  taskKind?: ObservationalHandoffTaskKind | null;
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

  const forecastHorizonValue = normalizeObservationalPositiveInteger(input.forecastHorizonValue);
  if (forecastHorizonValue) {
    params.set("forecastHorizonValue", String(forecastHorizonValue));
  }

  setOptionalSearchParam(params, "forecastHorizonUnit", forecastHorizonUnit);
  setOptionalSearchParam(params, "planningNote", planningNote);
  setOptionalSearchParam(params, "returnToChat", returnToChat);

  const query = params.toString();
  return query ? `/analysis/observational?${query}` : "/analysis/observational";
}

export function summarizeObservationalWorkspaceHandoff(input: {
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  openInNewTab?: boolean;
  planningNote?: string | null;
  preset?: ObservationalHandoffPreset | null;
  targetColumn?: string | null;
  taskKind?: ObservationalHandoffTaskKind | null;
  timeColumn?: string | null;
}) {
  const targetColumn = normalizeString(input.targetColumn);
  const datasetVersionId = normalizeString(input.datasetVersionId);
  const taskKind = input.taskKind ?? null;
  const preset = input.preset ?? null;
  const timeColumn = normalizeString(input.timeColumn);
  const planningNote = normalizeString(input.planningNote);
  const featureColumns = normalizeObservationalStringArray(input.featureColumns);
  const horizon = formatObservationalHorizon(input);

  const sentences = ["Observational workspace handoff is ready."];

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
      ? "The observational workspace is opening in the current tab."
      : "The observational workspace was opened in a new tab so chat planning can continue.",
  );
  sentences.push("Next step: review the prefilled setup and run the observational analysis when ready.");

  return sentences.join(" ");
}

export function parseObservationalWorkspaceHandoff(
  searchParams: SearchParamsLike,
): ObservationalWorkspaceHandoff | null {
  const datasetVersionId = normalizeString(searchParams.get("datasetVersionId"));
  const targetColumn = normalizeString(searchParams.get("targetColumn"));
  const taskKind = normalizeTaskKind(searchParams.get("taskKind"));
  const preset = normalizePreset(searchParams.get("preset"));
  const timeColumn = normalizeString(searchParams.get("timeColumn"));
  const forecastHorizonUnit = normalizeString(searchParams.get("forecastHorizonUnit"));
  const planningNote = normalizeString(searchParams.get("planningNote"));
  const returnToChat = normalizeReturnToChat(searchParams.get("returnToChat"));
  const forecastHorizonValue = parsePositiveInteger(searchParams.get("forecastHorizonValue"));
  const featureColumns = normalizeObservationalStringArray(searchParams.getAll("featureColumn"));

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

export function buildObservationalChatReturnHref(input: {
  claimLabel?: string | null;
  datasetVersionId?: string | null;
  featureColumns?: string[];
  forecastHorizonUnit?: string | null;
  forecastHorizonValue?: number | null;
  metricHighlights?: string[];
  planningNote?: string | null;
  preset?: ObservationalHandoffPreset | null;
  returnToChat?: string | null;
  runId?: string | null;
  status: ObservationalChatReturnStatus;
  summary?: string | null;
  targetColumn?: string | null;
  taskKind?: ObservationalHandoffTaskKind | null;
  timeColumn?: string | null;
  workspaceHref?: string | null;
}) {
  const baseHref = normalizeReturnToChat(input.returnToChat) ?? "/chat";
  const url = new URL(baseHref, "https://critjecture.local");
  const claimLabel = normalizeString(input.claimLabel);
  const datasetVersionId = normalizeString(input.datasetVersionId);
  const featureColumns = normalizeObservationalStringArray(input.featureColumns);
  const forecastHorizonUnit = normalizeString(input.forecastHorizonUnit);
  const forecastHorizonValue = normalizeObservationalPositiveInteger(input.forecastHorizonValue);
  const metricHighlights = normalizeObservationalStringArray(input.metricHighlights);
  const planningNote = normalizeString(input.planningNote);
  const runId = normalizeString(input.runId);
  const summary = normalizeString(input.summary);
  const targetColumn = normalizeString(input.targetColumn);
  const timeColumn = normalizeString(input.timeColumn);
  const workspaceHref = normalizeWorkspaceHref(input.workspaceHref);

  url.searchParams.set("observationalChatStatus", input.status);

  if (claimLabel) {
    url.searchParams.set("observationalClaimLabel", claimLabel);
  }

  if (datasetVersionId) {
    url.searchParams.set("observationalDatasetVersionId", datasetVersionId);
  }

  appendRepeatedSearchParam(url.searchParams, "observationalFeatureColumn", featureColumns);

  if (forecastHorizonUnit) {
    url.searchParams.set("observationalForecastHorizonUnit", forecastHorizonUnit);
  }

  if (forecastHorizonValue) {
    url.searchParams.set("observationalForecastHorizonValue", String(forecastHorizonValue));
  }

  appendRepeatedSearchParam(url.searchParams, "observationalMetric", metricHighlights);

  setOptionalSearchParam(url.searchParams, "observationalPlanningNote", planningNote);
  setOptionalSearchParam(url.searchParams, "observationalPreset", input.preset ?? null);
  setOptionalSearchParam(url.searchParams, "observationalRunId", runId);
  setOptionalSearchParam(url.searchParams, "observationalSummary", summary);
  setOptionalSearchParam(url.searchParams, "observationalTargetColumn", targetColumn);
  setOptionalSearchParam(url.searchParams, "observationalTaskKind", input.taskKind ?? null);
  setOptionalSearchParam(url.searchParams, "observationalTimeColumn", timeColumn);
  setOptionalSearchParam(url.searchParams, "observationalWorkspaceHref", workspaceHref);

  return `${url.pathname}${url.search}`;
}

export function parseObservationalChatReturn(
  searchParams: SearchParamsLike,
): ObservationalChatReturn | null {
  const status = normalizeChatReturnStatus(searchParams.get("observationalChatStatus"));

  if (!status) {
    return null;
  }

  return {
    claimLabel: normalizeString(searchParams.get("observationalClaimLabel")),
    datasetVersionId: normalizeString(searchParams.get("observationalDatasetVersionId")),
    featureColumns: normalizeObservationalStringArray(
      searchParams.getAll("observationalFeatureColumn"),
    ),
    forecastHorizonUnit: normalizeString(
      searchParams.get("observationalForecastHorizonUnit"),
    ),
    forecastHorizonValue: parsePositiveInteger(
      searchParams.get("observationalForecastHorizonValue"),
    ),
    metricHighlights: normalizeObservationalStringArray(
      searchParams.getAll("observationalMetric"),
    ),
    planningNote: normalizeString(searchParams.get("observationalPlanningNote")),
    preset: normalizePreset(searchParams.get("observationalPreset")),
    runId: normalizeString(searchParams.get("observationalRunId")),
    status,
    summary: normalizeString(searchParams.get("observationalSummary")),
    targetColumn: normalizeString(searchParams.get("observationalTargetColumn")),
    taskKind: normalizeTaskKind(searchParams.get("observationalTaskKind")),
    timeColumn: normalizeString(searchParams.get("observationalTimeColumn")),
    workspaceHref: normalizeWorkspaceHref(
      searchParams.get("observationalWorkspaceHref"),
    ),
  };
}

export function clearObservationalChatReturnParams(url: URL) {
  for (const key of OBSERVATIONAL_CHAT_RETURN_QUERY_KEYS) {
    url.searchParams.delete(key);
  }
}
