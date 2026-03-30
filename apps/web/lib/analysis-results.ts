import "server-only";

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { and, eq, gt, lte } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { analysisResults } from "@/lib/app-schema";
import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";

const ANALYSIS_RESULT_TTL_MS = 60 * 60 * 1000;

export const ANALYSIS_RESULT_MAX_POINT_COUNT = 2_000;
export const ANALYSIS_RESULT_MAX_PAYLOAD_BYTES = 256 * 1024;

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
  expiresAt: number;
  id: string;
  inputFiles: string[];
  organizationId: string;
  payloadBytes: number;
  pointCount: number;
  turnId: string;
  userId: string;
};

export class AnalysisResultValidationError extends Error {
  readonly code: "payload_bytes_limit" | "point_count_limit";

  constructor(
    message: string,
    code: "payload_bytes_limit" | "point_count_limit",
  ) {
    super(message);
    this.name = "AnalysisResultValidationError";
    this.code = code;
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

  const payloadRecord = payload as Record<string, unknown>;
  const x = payloadRecord.x;
  const y = payloadRecord.y;

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

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseCsvSchemasJson(value: string): CsvSchemaSummary[] {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }

      const entryRecord = entry as Record<string, unknown>;
      const file = typeof entryRecord.file === "string" ? entryRecord.file.trim() : "";
      const columns = Array.isArray(entryRecord.columns)
        ? entryRecord.columns.filter(
            (column): column is string => typeof column === "string" && column.trim().length > 0,
          )
        : [];

      if (!file || columns.length === 0) {
        return [];
      }

      return [{ columns, file }];
    });
  } catch {
    return [];
  }
}

function splitCsvHeaderColumns(headerLine: string) {
  return headerLine
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function normalizeInputFiles(inputFiles: string[]) {
  return [...new Set(inputFiles.map((value) => value.trim()).filter(Boolean))];
}

function serializeChartPayload(chart: ChartAnalysisPayload) {
  const payloadJson = JSON.stringify(chart);
  const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
  const pointCount = chart.x.length;

  if (pointCount > ANALYSIS_RESULT_MAX_POINT_COUNT) {
    throw new AnalysisResultValidationError(
      `Chart-ready analysis produced ${pointCount} plotted values, which exceeds the ${ANALYSIS_RESULT_MAX_POINT_COUNT} point limit. Aggregate, bin, sample, or reduce to top-N before rendering.`,
      "point_count_limit",
    );
  }

  if (payloadBytes > ANALYSIS_RESULT_MAX_PAYLOAD_BYTES) {
    throw new AnalysisResultValidationError(
      `Chart-ready analysis produced ${payloadBytes} bytes of chart payload, which exceeds the ${ANALYSIS_RESULT_MAX_PAYLOAD_BYTES} byte limit. Aggregate, bin, sample, or reduce to top-N before rendering.`,
      "payload_bytes_limit",
    );
  }

  return {
    payloadBytes,
    payloadJson,
    pointCount,
  };
}

async function readCsvSchemas(input: {
  inputFiles: string[];
  organizationId: string;
  organizationSlug: string;
  role: UserRole;
}) {
  const uniquePaths = normalizeInputFiles(input.inputFiles);
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

function mapStoredAnalysisResultRow(row: typeof analysisResults.$inferSelect): StoredAnalysisResult | null {
  const chart = parseChartPayload(JSON.parse(row.chartJson) as unknown);

  if (!chart) {
    return null;
  }

  return {
    chart,
    createdAt: row.createdAt,
    csvSchemas: parseCsvSchemasJson(row.csvSchemasJson),
    expiresAt: row.expiresAt,
    id: row.id,
    inputFiles: parseStringArray(row.inputFilesJson),
    organizationId: row.organizationId,
    payloadBytes: row.payloadBytes,
    pointCount: row.pointCount,
    turnId: row.turnId,
    userId: row.userId,
  };
}

export async function cleanupExpiredAnalysisResults(now = Date.now()) {
  const db = await getAppDatabase();

  await db.delete(analysisResults).where(lte(analysisResults.expiresAt, now));
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

export async function storeAnalysisResult(input: {
  chart: ChartAnalysisPayload;
  csvSchemas: CsvSchemaSummary[];
  inputFiles: string[];
  organizationId: string;
  turnId: string;
  userId: string;
}) {
  await cleanupExpiredAnalysisResults();

  const { payloadBytes, payloadJson, pointCount } = serializeChartPayload(input.chart);
  const createdAt = Date.now();
  const expiresAt = createdAt + ANALYSIS_RESULT_TTL_MS;
  const id = randomUUID();
  const normalizedInputFiles = normalizeInputFiles(input.inputFiles);
  const db = await getAppDatabase();

  await db.insert(analysisResults).values({
    chartJson: payloadJson,
    createdAt,
    csvSchemasJson: JSON.stringify(input.csvSchemas),
    expiresAt,
    id,
    inputFilesJson: JSON.stringify(normalizedInputFiles),
    organizationId: input.organizationId,
    payloadBytes,
    pointCount,
    turnId: input.turnId,
    userId: input.userId,
  });

  return {
    chart: input.chart,
    createdAt,
    csvSchemas: input.csvSchemas,
    expiresAt,
    id,
    inputFiles: normalizedInputFiles,
    organizationId: input.organizationId,
    payloadBytes,
    pointCount,
    turnId: input.turnId,
    userId: input.userId,
  } satisfies StoredAnalysisResult;
}

export async function getStoredAnalysisResult(input: {
  analysisResultId: string;
  organizationId: string;
  turnId: string;
  userId: string;
}) {
  const now = Date.now();
  await cleanupExpiredAnalysisResults(now);

  const db = await getAppDatabase();
  const row = await db.query.analysisResults.findFirst({
    where: and(
      eq(analysisResults.id, input.analysisResultId),
      eq(analysisResults.organizationId, input.organizationId),
      eq(analysisResults.turnId, input.turnId),
      eq(analysisResults.userId, input.userId),
      gt(analysisResults.expiresAt, now),
    ),
  });

  if (!row) {
    return null;
  }

  try {
    return mapStoredAnalysisResultRow(row);
  } catch {
    return null;
  }
}
