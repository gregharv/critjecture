import "server-only";

export type CorrelationFields = {
  governanceJobId?: string | null;
  knowledgeImportJobId?: string | null;
  organizationId?: string | null;
  requestId?: string | null;
  routeGroup?: string | null;
  routeKey?: string | null;
  runtimeToolCallId?: string | null;
  sandboxRunId?: string | null;
  turnId?: string | null;
  userId?: string | null;
};

type StructuredLogFields = CorrelationFields & Record<string, unknown>;

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "failed-to-serialize" });
  }
}

function buildEnvelope(event: string, fields: StructuredLogFields) {
  return {
    ...fields,
    event,
    timestamp: new Date().toISOString(),
  };
}

export function asErrorMessage(caughtError: unknown, fallback: string) {
  return caughtError instanceof Error ? caughtError.message : fallback;
}

export function mergeCorrelationFields(
  ...sources: Array<CorrelationFields | null | undefined>
): CorrelationFields {
  const merged: CorrelationFields = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== "undefined") {
        merged[key as keyof CorrelationFields] = value;
      }
    }
  }

  return merged;
}

export function logStructuredEvent(event: string, fields: StructuredLogFields = {}) {
  console.info(safeJsonStringify(buildEnvelope(event, fields)));
}

export function logStructuredError(
  event: string,
  caughtError: unknown,
  fields: StructuredLogFields = {},
) {
  console.error(
    safeJsonStringify(
      buildEnvelope(event, {
        ...fields,
        error: asErrorMessage(caughtError, "unknown-error"),
      }),
    ),
  );
}
