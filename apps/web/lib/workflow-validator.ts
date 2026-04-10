import "server-only";

import { readFile } from "node:fs/promises";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import { workflowRunInputChecks, workflowRuns } from "@/lib/app-schema";
import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import { countCsvDelimiters, splitCsvRecord } from "@/lib/csv-utils";
import type { UserRole } from "@/lib/roles";
import {
  parseWorkflowJsonRecord,
  type WorkflowInputCheckStatus,
  type WorkflowRunInputCheckReportV1,
  type WorkflowVersionContractsV1,
} from "@/lib/workflow-types";

export type WorkflowValidatorResolvedDocument = {
  accessScope: "admin" | "public";
  contentSha256: string;
  displayName: string;
  id: string;
  mimeType: string | null;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserId: string | null;
};

export type WorkflowValidationOutcomeStatus =
  | "pass"
  | "blocked_validation"
  | "waiting_for_input";

export type WorkflowInputValidationSummary = {
  checkedAt: number;
  failedCheckCount: number;
  failedInputCount: number;
  missingRequiredInputCount: number;
  warningCheckCount: number;
  warningInputCount: number;
};

export type ValidateWorkflowRunInputsResult = {
  reports: WorkflowRunInputCheckReportV1[];
  status: WorkflowValidationOutcomeStatus;
  summary: WorkflowInputValidationSummary;
};

type ValidateWorkflowRunInputsInput = {
  contracts: WorkflowVersionContractsV1;
  executionRole: UserRole;
  organizationId: string;
  organizationSlug: string;
  resolvedInputs: Map<string, WorkflowValidatorResolvedDocument[]>;
  runId: string;
  workflowId: string;
};

type CsvParseResult = {
  columnIndexByLower: Map<string, number>;
  columns: string[];
  rowCount: number;
  rows: string[][];
};

const NULLISH_CELL_VALUES = new Set(["", "na", "n/a", "nan", "none", "null"]);

function normalizeTextValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isNullishCellValue(value: string) {
  return NULLISH_CELL_VALUES.has(value.trim().toLowerCase());
}

function chooseCsvDelimiter(headerLine: string) {
  const delimiterCandidates = [",", ";", "\t", "|"];
  let selectedDelimiter = ",";
  let maxDelimiterCount = -1;

  for (const delimiter of delimiterCandidates) {
    const count = countCsvDelimiters(headerLine, delimiter);

    if (count > maxDelimiterCount) {
      maxDelimiterCount = count;
      selectedDelimiter = delimiter;
    }
  }

  return selectedDelimiter;
}

function parseCsvContent(rawText: string): CsvParseResult {
  const normalizedText = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalizedText.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);

  if (headerIndex < 0) {
    return {
      columnIndexByLower: new Map(),
      columns: [],
      rowCount: 0,
      rows: [],
    };
  }

  const headerLine = lines[headerIndex]!;
  const delimiter = chooseCsvDelimiter(headerLine);
  const columns = splitCsvRecord(headerLine, delimiter).map((column) => column.trim());
  const rows: string[][] = [];

  for (let lineIndex = headerIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";

    if (!line.trim()) {
      continue;
    }

    const parsedCells = splitCsvRecord(line, delimiter).map((cell) => cell.trim());

    while (parsedCells.length < columns.length) {
      parsedCells.push("");
    }

    rows.push(parsedCells);
  }

  const columnIndexByLower = new Map<string, number>();

  columns.forEach((columnName, index) => {
    const normalizedColumnName = columnName.trim().toLowerCase();

    if (normalizedColumnName && !columnIndexByLower.has(normalizedColumnName)) {
      columnIndexByLower.set(normalizedColumnName, index);
    }
  });

  return {
    columnIndexByLower,
    columns,
    rowCount: rows.length,
    rows,
  };
}

function findColumnIndex(csv: CsvParseResult, columnName: string) {
  const exactIndex = csv.columns.findIndex((column) => column === columnName);

  if (exactIndex >= 0) {
    return exactIndex;
  }

  return csv.columnIndexByLower.get(columnName.trim().toLowerCase()) ?? -1;
}

function parseDateValue(rawValue: string, format: "auto" | "iso8601" | undefined) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  if (format === "iso8601") {
    if (!/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(trimmed)) {
      return null;
    }
  }

  const parsed = Date.parse(trimmed);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function normalizeShaList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

async function loadHistoricalResolvedInputHashes(input: {
  lookback: number;
  organizationId: string;
  workflowId: string;
}) {
  if (input.lookback <= 0) {
    return new Map<string, string[][]>();
  }

  const db = await getAppDatabase();
  const rows = await db
    .select({
      metadataJson: workflowRuns.metadataJson,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.status, "completed"),
      ),
    )
    .orderBy(desc(workflowRuns.completedAt), desc(workflowRuns.updatedAt))
    .limit(Math.max(1, input.lookback));

  const hashesByInputKey = new Map<string, string[][]>();

  for (const row of rows) {
    const metadata = parseWorkflowJsonRecord(row.metadataJson);

    if (!Array.isArray(metadata.resolved_inputs)) {
      continue;
    }

    for (const entry of metadata.resolved_inputs) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }

      const inputKey = normalizeTextValue((entry as Record<string, unknown>).input_key);

      if (!inputKey) {
        continue;
      }

      const documentsValue = (entry as Record<string, unknown>).documents;

      if (!Array.isArray(documentsValue)) {
        continue;
      }

      const shaValues = normalizeShaList(
        documentsValue
          .flatMap((documentEntry) => {
            if (
              typeof documentEntry !== "object" ||
              documentEntry === null ||
              Array.isArray(documentEntry)
            ) {
              return [];
            }

            const sha = normalizeTextValue(
              (documentEntry as Record<string, unknown>).content_sha256,
            );

            return sha ? [sha] : [];
          }),
      );

      if (shaValues.length === 0) {
        continue;
      }

      const existing = hashesByInputKey.get(inputKey) ?? [];
      existing.push(shaValues);
      hashesByInputKey.set(inputKey, existing);
    }
  }

  return hashesByInputKey;
}

async function persistWorkflowInputCheckReports(input: {
  organizationId: string;
  reports: WorkflowRunInputCheckReportV1[];
  runId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .delete(workflowRunInputChecks)
    .where(
      and(
        eq(workflowRunInputChecks.organizationId, input.organizationId),
        eq(workflowRunInputChecks.runId, input.runId),
      ),
    );

  if (input.reports.length === 0) {
    return;
  }

  await db.insert(workflowRunInputChecks).values(
    input.reports.map((report) => ({
      createdAt: now,
      id: randomUUID(),
      inputKey: report.input_key,
      organizationId: input.organizationId,
      reportJson: JSON.stringify(report),
      runId: input.runId,
      status: report.status,
      updatedAt: now,
    })),
  );
}

function getReportStatus(checks: WorkflowRunInputCheckReportV1["checks"]) {
  if (checks.some((check) => check.status === "fail")) {
    return "fail" as const;
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warn" as const;
  }

  return "pass" as const;
}

function createValidationCheck(input: {
  code: WorkflowRunInputCheckReportV1["checks"][number]["code"];
  details?: Record<string, unknown>;
  message: string;
  status: WorkflowInputCheckStatus;
}) {
  return {
    code: input.code,
    ...(input.details ? { details: input.details } : {}),
    message: input.message,
    status: input.status,
  } satisfies WorkflowRunInputCheckReportV1["checks"][number];
}

export async function validateWorkflowRunInputs(
  input: ValidateWorkflowRunInputsInput,
): Promise<ValidateWorkflowRunInputsResult> {
  const checkedAt = Date.now();
  const maxDuplicateLookback = input.contracts.inputContract.inputs.reduce((maxValue, inputSpec) => {
    const lookback = inputSpec.duplicate_policy?.lookback_successful_runs ?? 0;
    return Math.max(maxValue, lookback);
  }, 0);
  const historicalHashesByInput = await loadHistoricalResolvedInputHashes({
    lookback: maxDuplicateLookback,
    organizationId: input.organizationId,
    workflowId: input.workflowId,
  });

  const csvParseCache = new Map<
    string,
    | {
        error: string;
      }
    | {
        csv: CsvParseResult;
      }
  >();

  const getCsvForDocument = async (documentRow: WorkflowValidatorResolvedDocument) => {
    const cached = csvParseCache.get(documentRow.id);

    if (cached) {
      return cached;
    }

    try {
      const authorizedFile = await resolveAuthorizedCompanyDataFile(
        documentRow.sourcePath,
        input.organizationSlug,
        input.executionRole,
        input.organizationId,
      );
      const rawText = await readFile(authorizedFile.absolutePath, "utf8");
      const csv = parseCsvContent(rawText);
      const result = { csv };
      csvParseCache.set(documentRow.id, result);
      return result;
    } catch (caughtError) {
      const result = {
        error: caughtError instanceof Error ? caughtError.message : "Failed to load CSV file.",
      };
      csvParseCache.set(documentRow.id, result);
      return result;
    }
  };

  const reports: WorkflowRunInputCheckReportV1[] = [];

  for (const inputSpec of input.contracts.inputContract.inputs) {
    const resolvedDocuments = input.resolvedInputs.get(inputSpec.input_key) ?? [];
    const checks: WorkflowRunInputCheckReportV1["checks"] = [];

    if (inputSpec.required && resolvedDocuments.length === 0) {
      checks.push(
        createValidationCheck({
          code: "missing_required_input",
          details: {
            input_key: inputSpec.input_key,
          },
          message: `Required input ${inputSpec.input_key} is missing.`,
          status: "fail",
        }),
      );
    }

    if (inputSpec.csv_rules?.freshness?.kind === "max_document_age_hours") {
      const maxAgeHours = inputSpec.csv_rules.freshness.max_age_hours;

      for (const documentRow of resolvedDocuments) {
        const ageHours = (checkedAt - documentRow.updatedAt) / (60 * 60 * 1000);

        if (ageHours > maxAgeHours) {
          checks.push(
            createValidationCheck({
              code: "freshness_sla_failed",
              details: {
                age_hours: Number(ageHours.toFixed(2)),
                document_id: documentRow.id,
                input_key: inputSpec.input_key,
                max_age_hours: maxAgeHours,
                source_path: documentRow.sourcePath,
                updated_at: documentRow.updatedAt,
              },
              message: `${documentRow.displayName} is ${ageHours.toFixed(1)} hours old, which exceeds the ${maxAgeHours}-hour freshness SLA.`,
              status: "fail",
            }),
          );
        }
      }
    }

    const needsCsvValidation =
      inputSpec.data_kind === "table" ||
      Boolean(inputSpec.csv_rules?.required_columns?.length) ||
      typeof inputSpec.csv_rules?.min_row_count === "number" ||
      Boolean(inputSpec.csv_rules?.max_null_ratio_by_column) ||
      inputSpec.csv_rules?.freshness?.kind === "max_column_age_days";

    if (needsCsvValidation) {
      for (const documentRow of resolvedDocuments) {
        const csvResult = await getCsvForDocument(documentRow);

        if ("error" in csvResult) {
          checks.push(
            createValidationCheck({
              code: "missing_required_input",
              details: {
                document_id: documentRow.id,
                error: csvResult.error,
                input_key: inputSpec.input_key,
                source_path: documentRow.sourcePath,
              },
              message: `Could not load ${documentRow.displayName} for validation: ${csvResult.error}`,
              status: "fail",
            }),
          );
          continue;
        }

        const csv = csvResult.csv;

        if (inputSpec.csv_rules?.required_columns && inputSpec.csv_rules.required_columns.length > 0) {
          const missingColumns = inputSpec.csv_rules.required_columns.filter(
            (requiredColumn) => findColumnIndex(csv, requiredColumn) < 0,
          );

          if (missingColumns.length > 0) {
            checks.push(
              createValidationCheck({
                code: "column_missing",
                details: {
                  columns_present: csv.columns,
                  document_id: documentRow.id,
                  input_key: inputSpec.input_key,
                  missing_columns: missingColumns,
                  source_path: documentRow.sourcePath,
                },
                message: `${documentRow.displayName} is missing required columns: ${missingColumns.join(", ")}.`,
                status: "fail",
              }),
            );
          }
        }

        if (typeof inputSpec.csv_rules?.min_row_count === "number") {
          if (csv.rowCount < inputSpec.csv_rules.min_row_count) {
            checks.push(
              createValidationCheck({
                code: "row_count_below_minimum",
                details: {
                  actual_row_count: csv.rowCount,
                  document_id: documentRow.id,
                  input_key: inputSpec.input_key,
                  min_row_count: inputSpec.csv_rules.min_row_count,
                  source_path: documentRow.sourcePath,
                },
                message: `${documentRow.displayName} has ${csv.rowCount} rows; minimum required is ${inputSpec.csv_rules.min_row_count}.`,
                status: "fail",
              }),
            );
          }
        }

        const nullRatioByColumn = inputSpec.csv_rules?.max_null_ratio_by_column;

        if (nullRatioByColumn) {
          for (const [columnName, maxNullRatio] of Object.entries(nullRatioByColumn)) {
            const columnIndex = findColumnIndex(csv, columnName);

            if (columnIndex < 0) {
              checks.push(
                createValidationCheck({
                  code: "column_missing",
                  details: {
                    document_id: documentRow.id,
                    input_key: inputSpec.input_key,
                    missing_column: columnName,
                    source_path: documentRow.sourcePath,
                  },
                  message: `${documentRow.displayName} is missing null-ratio check column ${columnName}.`,
                  status: "fail",
                }),
              );
              continue;
            }

            const nullCount = csv.rows.reduce((count, row) => {
              const value = row[columnIndex] ?? "";
              return isNullishCellValue(value) ? count + 1 : count;
            }, 0);
            const denominator = Math.max(1, csv.rowCount);
            const nullRatio = nullCount / denominator;

            if (nullRatio > maxNullRatio) {
              checks.push(
                createValidationCheck({
                  code: "null_ratio_exceeded",
                  details: {
                    actual_null_ratio: Number(nullRatio.toFixed(6)),
                    column: columnName,
                    document_id: documentRow.id,
                    input_key: inputSpec.input_key,
                    max_null_ratio: maxNullRatio,
                    source_path: documentRow.sourcePath,
                  },
                  message: `${documentRow.displayName} column ${columnName} has null ratio ${nullRatio.toFixed(3)} above allowed ${maxNullRatio}.`,
                  status: "fail",
                }),
              );
            }
          }
        }

        if (inputSpec.csv_rules?.freshness?.kind === "max_column_age_days") {
          const freshnessRule = inputSpec.csv_rules.freshness;
          const columnIndex = findColumnIndex(csv, freshnessRule.column);

          if (columnIndex < 0) {
            checks.push(
              createValidationCheck({
                code: "column_missing",
                details: {
                  document_id: documentRow.id,
                  input_key: inputSpec.input_key,
                  missing_column: freshnessRule.column,
                  source_path: documentRow.sourcePath,
                },
                message: `${documentRow.displayName} is missing freshness column ${freshnessRule.column}.`,
                status: "fail",
              }),
            );
          } else {
            let maxTimestamp: number | null = null;
            let parseableCount = 0;

            for (const row of csv.rows) {
              const parsedTimestamp = parseDateValue(
                row[columnIndex] ?? "",
                freshnessRule.date_format,
              );

              if (parsedTimestamp === null) {
                continue;
              }

              parseableCount += 1;
              maxTimestamp =
                maxTimestamp === null
                  ? parsedTimestamp
                  : Math.max(maxTimestamp, parsedTimestamp);
            }

            if (maxTimestamp === null) {
              checks.push(
                createValidationCheck({
                  code: "freshness_sla_failed",
                  details: {
                    column: freshnessRule.column,
                    date_format: freshnessRule.date_format ?? "auto",
                    document_id: documentRow.id,
                    input_key: inputSpec.input_key,
                    parseable_value_count: parseableCount,
                    source_path: documentRow.sourcePath,
                  },
                  message: `${documentRow.displayName} has no parseable dates in ${freshnessRule.column}.`,
                  status: "fail",
                }),
              );
            } else {
              const ageDays = (checkedAt - maxTimestamp) / (24 * 60 * 60 * 1000);

              if (ageDays > freshnessRule.max_age_days) {
                checks.push(
                  createValidationCheck({
                    code: "freshness_sla_failed",
                    details: {
                      actual_age_days: Number(ageDays.toFixed(2)),
                      column: freshnessRule.column,
                      document_id: documentRow.id,
                      input_key: inputSpec.input_key,
                      max_age_days: freshnessRule.max_age_days,
                      max_timestamp: maxTimestamp,
                      source_path: documentRow.sourcePath,
                    },
                    message: `${documentRow.displayName} freshest ${freshnessRule.column} value is ${ageDays.toFixed(1)} days old; maximum allowed is ${freshnessRule.max_age_days}.`,
                    status: "fail",
                  }),
                );
              }
            }
          }
        }
      }
    }

    if (inputSpec.duplicate_policy && resolvedDocuments.length > 0) {
      const currentHashes = normalizeShaList(
        resolvedDocuments.map((documentRow) => documentRow.contentSha256),
      );
      const historicalHashes =
        historicalHashesByInput.get(inputSpec.input_key) ?? [];
      const lookbackWindow = Math.max(1, inputSpec.duplicate_policy.lookback_successful_runs);
      const recentHashes = historicalHashes.slice(0, lookbackWindow);
      const unchanged = recentHashes.some((historicalValue) =>
        arraysEqual(historicalValue, currentHashes),
      );

      if (unchanged && inputSpec.duplicate_policy.mode !== "allow") {
        checks.push(
          createValidationCheck({
            code: "duplicate_unchanged_input",
            details: {
              content_sha256: currentHashes,
              input_key: inputSpec.input_key,
              lookback_successful_runs: lookbackWindow,
              mode: inputSpec.duplicate_policy.mode,
            },
            message: `Input ${inputSpec.input_key} is unchanged from a recent successful run.`,
            status: inputSpec.duplicate_policy.mode === "warn_if_unchanged" ? "warn" : "fail",
          }),
        );
      }
    }

    const reportStatus = getReportStatus(checks);

    reports.push({
      checked_at: checkedAt,
      checks,
      input_key: inputSpec.input_key,
      resolved_documents: resolvedDocuments.map((documentRow) => ({
        content_sha256: documentRow.contentSha256,
        display_name: documentRow.displayName,
        document_id: documentRow.id,
        mime_type: documentRow.mimeType,
        updated_at: documentRow.updatedAt,
      })),
      schema_version: 1,
      status: reportStatus,
    });
  }

  await persistWorkflowInputCheckReports({
    organizationId: input.organizationId,
    reports,
    runId: input.runId,
  });

  const failedCheckCount = reports.reduce((count, report) => {
    return count + report.checks.filter((check) => check.status === "fail").length;
  }, 0);
  const warningCheckCount = reports.reduce((count, report) => {
    return count + report.checks.filter((check) => check.status === "warn").length;
  }, 0);
  const failedInputCount = reports.filter((report) => report.status === "fail").length;
  const warningInputCount = reports.filter((report) => report.status === "warn").length;
  const missingRequiredInputCount = reports.reduce((count, report) => {
    const missingRequiredChecks = report.checks.filter(
      (check) => check.code === "missing_required_input" && check.status === "fail",
    ).length;

    return count + missingRequiredChecks;
  }, 0);
  const status: WorkflowValidationOutcomeStatus =
    missingRequiredInputCount > 0
      ? "waiting_for_input"
      : failedInputCount > 0
        ? "blocked_validation"
        : "pass";

  return {
    reports,
    status,
    summary: {
      checkedAt,
      failedCheckCount,
      failedInputCount,
      missingRequiredInputCount,
      warningCheckCount,
      warningInputCount,
    },
  };
}
