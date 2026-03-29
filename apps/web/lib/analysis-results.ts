import "server-only";

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";

const ANALYSIS_RESULT_TTL_MS = 60 * 60 * 1000;

export type CsvSchemaSummary = {
  columns: string[];
  file: string;
};

export type ChartAnalysisPayload = {
  chartType: "bar" | "line" | "scatter";
  title: string | null;
  x: Array<string | number>;
  xLabel: string | null;
  y: number[];
  yLabel: string | null;
};

export type StoredAnalysisResult = {
  chart: ChartAnalysisPayload;
  createdAt: number;
  csvSchemas: CsvSchemaSummary[];
  id: string;
  inputFiles: string[];
  organizationId: string;
  turnId: string;
  userId: string;
};

const storedAnalysisResults = new Map<string, StoredAnalysisResult>();

function cleanupExpiredAnalysisResults(now = Date.now()) {
  for (const [analysisResultId, result] of storedAnalysisResults.entries()) {
    if (result.createdAt + ANALYSIS_RESULT_TTL_MS <= now) {
      storedAnalysisResults.delete(analysisResultId);
    }
  }
}

function normalizeStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeChartType(value: unknown) {
  return value === "line" || value === "scatter" ? value : "bar";
}

function isChartAxisArray(value: unknown): value is Array<string | number> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" || typeof entry === "number")
  );
}

function isNumericArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function parseChartPayload(value: unknown): ChartAnalysisPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload =
    "chart" in value && typeof value.chart === "object" && value.chart !== null
      ? value.chart
      : value;

  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  if (!("x" in payload) || !("y" in payload)) {
    return null;
  }

  const x = payload.x;
  const y = payload.y;
  const payloadRecord = payload as Record<string, unknown>;

  if (!isChartAxisArray(x) || !isNumericArray(y) || x.length !== y.length) {
    return null;
  }

  return {
    chartType: normalizeChartType(
      "chartType" in payloadRecord ? payloadRecord.chartType : payloadRecord.type,
    ),
    title: normalizeStringOrNull(payloadRecord.title),
    x,
    xLabel: normalizeStringOrNull(payloadRecord.xLabel),
    y,
    yLabel: normalizeStringOrNull(payloadRecord.yLabel),
  };
}

function splitCsvHeaderColumns(headerLine: string) {
  return headerLine
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

async function readCsvSchemas(input: {
  inputFiles: string[];
  organizationId: string;
  organizationSlug: string;
  role: UserRole;
}) {
  const uniquePaths = [...new Set(input.inputFiles.map((value) => value.trim()).filter(Boolean))];
  const schemas: CsvSchemaSummary[] = [];

  for (const requestedPath of uniquePaths) {
    if (!requestedPath.toLowerCase().endsWith(".csv")) {
      continue;
    }

    const resolvedFile = await resolveAuthorizedCompanyDataFile(
      requestedPath,
      input.organizationSlug,
      input.role,
      input.organizationId,
    );
    const headerLine = (await readFile(resolvedFile.absolutePath, "utf8"))
      .split(/\r?\n/, 1)[0]
      ?.trim() ?? "";

    schemas.push({
      columns: splitCsvHeaderColumns(headerLine),
      file: resolvedFile.relativePath,
    });
  }

  return schemas;
}

export async function buildCsvSchemas(input: {
  inputFiles: string[];
  organizationId: string;
  organizationSlug: string;
  role: UserRole;
}) {
  return readCsvSchemas(input);
}

export function parseChartAnalysisStdout(stdout: string) {
  const trimmed = stdout.trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    return parseChartPayload(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

export function storeAnalysisResult(input: {
  chart: ChartAnalysisPayload;
  csvSchemas: CsvSchemaSummary[];
  inputFiles: string[];
  organizationId: string;
  turnId: string;
  userId: string;
}) {
  cleanupExpiredAnalysisResults();

  const id = randomUUID();
  const result: StoredAnalysisResult = {
    chart: input.chart,
    createdAt: Date.now(),
    csvSchemas: input.csvSchemas,
    id,
    inputFiles: [...new Set(input.inputFiles.map((value) => value.trim()).filter(Boolean))],
    organizationId: input.organizationId,
    turnId: input.turnId,
    userId: input.userId,
  };

  storedAnalysisResults.set(id, result);

  return result;
}

export function getStoredAnalysisResult(input: {
  analysisResultId: string;
  organizationId: string;
  turnId: string;
  userId: string;
}) {
  cleanupExpiredAnalysisResults();

  const stored = storedAnalysisResults.get(input.analysisResultId) ?? null;

  if (!stored) {
    return null;
  }

  if (
    stored.organizationId !== input.organizationId ||
    stored.turnId !== input.turnId ||
    stored.userId !== input.userId
  ) {
    return null;
  }

  return stored;
}
