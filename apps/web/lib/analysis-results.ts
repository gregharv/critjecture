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
  xLabel: string | null;
  yLabel: string | null;
} & (
  | {
      x: Array<string | number>;
      y: number[];
    }
  | {
      series: Array<{
        name: string | null;
        x: Array<string | number>;
        y: number[];
      }>;
    }
);

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

function isChartSeriesArray(
  value: unknown,
): value is Array<{
  name: string | null;
  x: Array<string | number>;
  y: number[];
}> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }

      const series = entry as Record<string, unknown>;
      const x = series.x;
      const y = series.y;

      return (
        isChartAxisArray(x) &&
        isNumericArray(y) &&
        x.length === y.length &&
        (!("name" in series) ||
          series.name === null ||
          (typeof series.name === "string" && series.name.trim().length > 0))
      );
    })
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

  const payloadRecord = payload as Record<string, unknown>;
  const chartType = normalizeChartType(
    "chartType" in payloadRecord ? payloadRecord.chartType : payloadRecord.type,
  );
  const title = normalizeStringOrNull(payloadRecord.title);
  const xLabel = normalizeStringOrNull(payloadRecord.xLabel);
  const yLabel = normalizeStringOrNull(payloadRecord.yLabel);

  if ("series" in payloadRecord) {
    const series = payloadRecord.series;

    if (!isChartSeriesArray(series)) {
      return null;
    }

    return {
      chartType,
      series: series.map((entry) => ({
        name:
          typeof entry.name === "string" && entry.name.trim().length > 0
            ? entry.name.trim()
            : null,
        x: entry.x,
        y: entry.y,
      })),
      title,
      xLabel,
      yLabel,
    };
  }

  if ("x" in payloadRecord && "y" in payloadRecord) {
    const x = payloadRecord.x;
    const y = payloadRecord.y;

    if (!isChartAxisArray(x) || !isNumericArray(y) || x.length !== y.length) {
      return null;
    }

    return {
      chartType,
      title,
      x,
      xLabel,
      y,
      yLabel,
    };
  }

  return null;
}

function countChartPoints(chart: ChartAnalysisPayload) {
  return "series" in chart
    ? chart.series.reduce((sum, series) => sum + series.x.length, 0)
    : chart.x.length;
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
  const pointCount = countChartPoints(chart);

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
    try {
      return parseChartPayload(parsePythonLikeLiteral(trimmed));
    } catch {
      return null;
    }
  }
}

function parsePythonLikeLiteral(source: string) {
  let index = 0;

  function skipWhitespace() {
    while (index < source.length && /\s/.test(source[index]!)) {
      index += 1;
    }
  }

  function parseString() {
    const quote = source[index];

    if (quote !== "'" && quote !== '"') {
      throw new Error("Expected string literal.");
    }

    index += 1;
    let result = "";

    while (index < source.length) {
      const character = source[index]!;

      if (character === "\\") {
        const next = source[index + 1];

        if (next === undefined) {
          throw new Error("Unterminated escape sequence.");
        }

        switch (next) {
          case "\\":
          case "'":
          case '"':
            result += next;
            break;
          case "n":
            result += "\n";
            break;
          case "r":
            result += "\r";
            break;
          case "t":
            result += "\t";
            break;
          default:
            result += next;
            break;
        }

        index += 2;
        continue;
      }

      if (character === quote) {
        index += 1;
        return result;
      }

      result += character;
      index += 1;
    }

    throw new Error("Unterminated string literal.");
  }

  function parseNumber() {
    const start = index;

    if (source[index] === "-") {
      index += 1;
    }

    while (index < source.length && /[0-9]/.test(source[index]!)) {
      index += 1;
    }

    if (source[index] === ".") {
      index += 1;
      while (index < source.length && /[0-9]/.test(source[index]!)) {
        index += 1;
      }
    }

    if (source[index] === "e" || source[index] === "E") {
      index += 1;
      if (source[index] === "+" || source[index] === "-") {
        index += 1;
      }
      while (index < source.length && /[0-9]/.test(source[index]!)) {
        index += 1;
      }
    }

    const parsed = Number(source.slice(start, index));

    if (!Number.isFinite(parsed)) {
      throw new Error("Invalid numeric literal.");
    }

    return parsed;
  }

  function parseIdentifier() {
    const start = index;

    while (index < source.length && /[A-Za-z_]/.test(source[index]!)) {
      index += 1;
    }

    const identifier = source.slice(start, index);

    switch (identifier) {
      case "True":
        return true;
      case "False":
        return false;
      case "None":
        return null;
      default:
        throw new Error(`Unsupported identifier ${identifier}.`);
    }
  }

  function parseArray() {
    index += 1;
    const result: unknown[] = [];
    skipWhitespace();

    if (source[index] === "]") {
      index += 1;
      return result;
    }

    while (index < source.length) {
      result.push(parseValue());
      skipWhitespace();

      if (source[index] === "]") {
        index += 1;
        return result;
      }

      if (source[index] !== ",") {
        throw new Error("Expected comma in array literal.");
      }

      index += 1;
      skipWhitespace();
    }

    throw new Error("Unterminated array literal.");
  }

  function parseObject() {
    index += 1;
    const result: Record<string, unknown> = {};
    skipWhitespace();

    if (source[index] === "}") {
      index += 1;
      return result;
    }

    while (index < source.length) {
      skipWhitespace();
      const keyValue = parseValue();

      if (typeof keyValue !== "string") {
        throw new Error("Object keys must be strings.");
      }

      skipWhitespace();

      if (source[index] !== ":") {
        throw new Error("Expected colon in object literal.");
      }

      index += 1;
      skipWhitespace();
      result[keyValue] = parseValue();
      skipWhitespace();

      if (source[index] === "}") {
        index += 1;
        return result;
      }

      if (source[index] !== ",") {
        throw new Error("Expected comma in object literal.");
      }

      index += 1;
      skipWhitespace();
    }

    throw new Error("Unterminated object literal.");
  }

  function parseValue(): unknown {
    skipWhitespace();

    const character = source[index];

    if (character === "{") {
      return parseObject();
    }

    if (character === "[") {
      return parseArray();
    }

    if (character === "'" || character === '"') {
      return parseString();
    }

    if (character === "-" || (character !== undefined && /[0-9]/.test(character))) {
      return parseNumber();
    }

    if (character !== undefined && /[A-Za-z_]/.test(character)) {
      return parseIdentifier();
    }

    throw new Error(`Unexpected token ${character ?? "<eof>"}.`);
  }

  const parsed = parseValue();
  skipWhitespace();

  if (index !== source.length) {
    throw new Error("Unexpected trailing content.");
  }

  return parsed;
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
