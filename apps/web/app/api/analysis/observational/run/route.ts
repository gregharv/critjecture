import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth-state";
import { executeObservationalRun } from "@/lib/observational-analysis";

export const runtime = "nodejs";

type ObservationalRunRequest = {
  datasetVersionId?: unknown;
  featureColumns?: unknown;
  forecastHorizonUnit?: unknown;
  forecastHorizonValue?: unknown;
  preset?: unknown;
  targetColumn?: unknown;
  taskKind?: unknown;
  timeColumn?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseRequestBody(body: ObservationalRunRequest):
  | { error: string }
  | {
      datasetVersionId: string;
      featureColumns: string[];
      forecastConfig: null | {
        horizonUnit: string;
        horizonValue: number;
        timeColumnName: string | null;
      };
      preset: "forecast" | "standard";
      targetColumn: string;
      taskKind: string | null;
    } {
  const datasetVersionId =
    typeof body.datasetVersionId === "string" ? body.datasetVersionId.trim() : "";
  const targetColumn = typeof body.targetColumn === "string" ? body.targetColumn.trim() : "";
  const featureColumns = Array.isArray(body.featureColumns)
    ? body.featureColumns.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    : [];
  const taskKind = typeof body.taskKind === "string" ? body.taskKind.trim() : null;
  const preset = body.preset === "forecast" ? "forecast" : "standard";
  const timeColumn = typeof body.timeColumn === "string" ? body.timeColumn.trim() : null;
  const forecastHorizonUnit =
    typeof body.forecastHorizonUnit === "string" && body.forecastHorizonUnit.trim().length > 0
      ? body.forecastHorizonUnit.trim()
      : "rows";
  const forecastHorizonValue =
    typeof body.forecastHorizonValue === "number" && Number.isInteger(body.forecastHorizonValue)
      ? body.forecastHorizonValue
      : null;

  if (!datasetVersionId) {
    return { error: "datasetVersionId must be a non-empty string." } as const;
  }

  if (!targetColumn) {
    return { error: "targetColumn must be a non-empty string." } as const;
  }

  if (featureColumns.length === 0) {
    return { error: "featureColumns must include at least one column name." } as const;
  }

  if (preset === "forecast" && (!forecastHorizonValue || forecastHorizonValue <= 0)) {
    return { error: "forecastHorizonValue must be a positive integer when preset is forecast." } as const;
  }

  return {
    datasetVersionId,
    featureColumns,
    forecastConfig:
      preset === "forecast"
        ? {
            horizonUnit: forecastHorizonUnit,
            horizonValue: forecastHorizonValue ?? 0,
            timeColumnName: timeColumn,
          }
        : null,
    preset,
    targetColumn,
    taskKind,
  } as const;
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return jsonError("Authentication required.", 401);
  }

  if (!user.access.canUseAnswerTools) {
    return jsonError("This membership cannot run observational analysis tools.", 403);
  }

  let body: ObservationalRunRequest;

  try {
    body = (await request.json()) as ObservationalRunRequest;
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsed = parseRequestBody(body);
  if ("error" in parsed) {
    return jsonError(parsed.error, 400);
  }

  try {
    const result = await executeObservationalRun({
      datasetVersionId: parsed.datasetVersionId,
      featureColumns: parsed.featureColumns,
      forecastConfig: parsed.forecastConfig,
      organizationId: user.organizationId,
      organizationSlug: user.organizationSlug,
      preset: parsed.preset,
      requestedByUserId: user.id,
      targetColumn: parsed.targetColumn,
      taskKind: parsed.taskKind === "classification" || parsed.taskKind === "regression" ? parsed.taskKind : null,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Observational analysis failed.";
    const status = /not found/i.test(message) ? 404 : 400;
    return jsonError(message, status);
  }
}
