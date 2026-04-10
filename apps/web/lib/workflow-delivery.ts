import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  sandboxGeneratedAssets,
  workflowDeliveries,
  workflowRunInputChecks,
  workflowRuns,
  workflowRunSteps,
  workflowVersions,
  workflows,
} from "@/lib/app-schema";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import {
  parseWorkflowDeliverySnapshotJson,
  parseWorkflowJsonRecord,
  parseWorkflowRunInputCheckReportJson,
  parseWorkflowVersionContracts,
  type WorkflowDeliveryChannelKind,
  type WorkflowDeliveryChannelV1,
  type WorkflowDeliverySnapshotV1,
  type WorkflowVersionContractsV1,
} from "@/lib/workflow-types";

type DeliveryAttemptOutcome =
  | {
      ok: true;
      responseBody: string | null;
      responseStatusCode: number | null;
      sentAt: number;
    }
  | {
      errorMessage: string;
      ok: false;
      responseBody: string | null;
      responseStatusCode: number | null;
      transient: boolean;
    };

type WorkflowDeliveryContext = {
  artifactManifest: DeliveryArtifactManifestEntry[];
  contracts: WorkflowVersionContractsV1;
  metadata: Record<string, unknown>;
  run: {
    completedAt: number | null;
    id: string;
    organizationId: string;
    runAsRole: "member" | "admin" | "owner";
    runAsUserId: string | null;
    startedAt: number | null;
    status:
      | "queued"
      | "running"
      | "waiting_for_input"
      | "blocked_validation"
      | "completed"
      | "failed"
      | "cancelled";
    triggerKind: "manual" | "scheduled" | "resume";
    triggerWindowKey: string | null;
    workflowId: string;
    workflowVersionId: string;
    workflowVersionNumber: number;
  };
  snapshot: WorkflowDeliverySnapshotV1;
  workflow: {
    id: string;
    name: string;
  };
};

type DeliveryArtifactManifestEntry = {
  asset_id: string;
  byte_size: number;
  created_at: number;
  expires_at: number;
  file_name: string;
  mime_type: string;
  relative_path: string;
  run_id: string;
  storage_path: string;
};

export type WorkflowDeliveryProcessSummary = {
  failedCount: number;
  pendingCount: number;
  processedCount: number;
  requeuedCount: number;
  sentCount: number;
};

const DEFAULT_RETRY_SCAN_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function truncateText(value: string, maxLength = 8_000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}… [truncated]`;
}

function parsePositiveInteger(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.trunc(value));
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) {
    return [] as unknown[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as unknown[];
  }
}

function computeRetryDelayMs(input: {
  attemptNumber: number;
  backoffMultiplier: number;
  initialBackoffSeconds: number;
}) {
  const exponent = Math.max(0, input.attemptNumber - 1);
  const delaySeconds = input.initialBackoffSeconds * Math.pow(input.backoffMultiplier, exponent);

  return Math.round(delaySeconds * 1_000);
}

function isTransientHttpStatus(statusCode: number) {
  return statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
}

function normalizeEndpointEnvKey(endpointId: string) {
  return endpointId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function parseWebhookEndpointsJson() {
  const raw = (process.env.CRITJECTURE_WORKFLOW_WEBHOOK_ENDPOINTS_JSON ?? "").trim();

  if (!raw) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function resolveWebhookEndpointConfig(endpointId: string) {
  const normalizedEndpointId = endpointId.trim();

  if (!normalizedEndpointId) {
    return { error: "Webhook endpoint_id is required.", secret: null, url: null };
  }

  if (normalizedEndpointId.startsWith("http://") || normalizedEndpointId.startsWith("https://")) {
    const signingSecret = (process.env.CRITJECTURE_WORKFLOW_WEBHOOK_SIGNING_SECRET ?? "").trim();

    return {
      error: null,
      secret: signingSecret || null,
      url: normalizedEndpointId,
    };
  }

  const endpointMap = parseWebhookEndpointsJson();
  const mappedValue = endpointMap[normalizedEndpointId];

  if (typeof mappedValue === "string") {
    const mapSigningSecret =
      (process.env.CRITJECTURE_WORKFLOW_WEBHOOK_SIGNING_SECRET ?? "").trim() || null;

    return {
      error: null,
      secret: mapSigningSecret,
      url: mappedValue.trim() || null,
    };
  }

  if (isRecord(mappedValue)) {
    const mappedUrl = normalizeText(mappedValue.url);
    const mappedSecret = normalizeText(mappedValue.secret) || null;

    return {
      error: mappedUrl ? null : `Webhook endpoint ${normalizedEndpointId} is missing url in JSON map.`,
      secret: mappedSecret,
      url: mappedUrl || null,
    };
  }

  const endpointEnvKey = normalizeEndpointEnvKey(normalizedEndpointId);
  const envUrl = (
    process.env[`CRITJECTURE_WORKFLOW_WEBHOOK_ENDPOINT_${endpointEnvKey}`] ??
    (normalizedEndpointId === "default"
      ? process.env.CRITJECTURE_WORKFLOW_DELIVERY_WEBHOOK_URL ?? ""
      : "")
  ).trim();
  const envSecret = (
    process.env[`CRITJECTURE_WORKFLOW_WEBHOOK_SECRET_${endpointEnvKey}`] ??
    process.env.CRITJECTURE_WORKFLOW_WEBHOOK_SIGNING_SECRET ??
    ""
  ).trim();

  if (!envUrl) {
    return {
      error: `Webhook endpoint ${normalizedEndpointId} is not configured.`,
      secret: envSecret || null,
      url: null,
    };
  }

  return {
    error: null,
    secret: envSecret || null,
    url: envUrl,
  };
}

function buildChannelByKind(channels: WorkflowVersionContractsV1["delivery"]["channels"]) {
  const byKind = new Map<WorkflowDeliveryChannelKind, WorkflowDeliveryChannelV1>();

  for (const channel of channels) {
    if (!byKind.has(channel.kind)) {
      byKind.set(channel.kind, channel);
      continue;
    }

    logStructuredEvent("workflow.delivery_channel_duplicate_ignored", {
      channel_kind: channel.kind,
      routeGroup: "workflow",
      routeKey: "workflow.delivery",
    });
  }

  return byKind;
}

function collectMetadataInputSummary(metadata: Record<string, unknown>) {
  const summary: WorkflowDeliverySnapshotV1["inputs"] = [];
  const resolvedInputs = metadata.resolved_inputs;

  if (!Array.isArray(resolvedInputs)) {
    return summary;
  }

  for (const inputEntry of resolvedInputs) {
    if (!isRecord(inputEntry)) {
      continue;
    }

    const inputKey = normalizeText(inputEntry.input_key);

    if (!inputKey) {
      continue;
    }

    const documents = inputEntry.documents;

    if (!Array.isArray(documents)) {
      continue;
    }

    for (const documentEntry of documents) {
      if (!isRecord(documentEntry)) {
        continue;
      }

      const documentId = normalizeText(documentEntry.document_id);
      const displayName = normalizeText(documentEntry.display_name);
      const contentSha = normalizeText(documentEntry.content_sha256);

      if (!documentId || !displayName || !contentSha) {
        continue;
      }

      summary.push({
        content_sha256: contentSha,
        display_name: displayName,
        document_id: documentId,
        input_key: inputKey,
        mime_type:
          documentEntry.mime_type === null
            ? null
            : normalizeText(documentEntry.mime_type) || null,
      });
    }
  }

  return summary;
}

async function loadWorkflowDeliveryContext(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select({
      completedAt: workflowRuns.completedAt,
      deliveryJson: workflowVersions.deliveryJson,
      executionIdentityJson: workflowVersions.executionIdentityJson,
      id: workflowRuns.id,
      inputBindingsJson: workflowVersions.inputBindingsJson,
      inputContractJson: workflowVersions.inputContractJson,
      metadataJson: workflowRuns.metadataJson,
      organizationId: workflowRuns.organizationId,
      outputsJson: workflowVersions.outputsJson,
      provenanceJson: workflowVersions.provenanceJson,
      recipeJson: workflowVersions.recipeJson,
      runAsRole: workflowRuns.runAsRole,
      runAsUserId: workflowRuns.runAsUserId,
      scheduleJson: workflowVersions.scheduleJson,
      startedAt: workflowRuns.startedAt,
      status: workflowRuns.status,
      thresholdsJson: workflowVersions.thresholdsJson,
      triggerKind: workflowRuns.triggerKind,
      triggerWindowKey: workflowRuns.triggerWindowKey,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      workflowVersionId: workflowRuns.workflowVersionId,
      workflowVersionNumber: workflowVersions.versionNumber,
    })
    .from(workflowRuns)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowRuns.workflowVersionId))
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(
      and(
        eq(workflowRuns.organizationId, input.organizationId),
        eq(workflowRuns.id, input.runId),
      ),
    )
    .limit(1);

  const row = rows[0] ?? null;

  if (!row) {
    return null;
  }

  const contracts = parseWorkflowVersionContracts({
    deliveryJson: row.deliveryJson,
    executionIdentityJson: row.executionIdentityJson,
    inputBindingsJson: row.inputBindingsJson,
    inputContractJson: row.inputContractJson,
    outputsJson: row.outputsJson,
    provenanceJson: row.provenanceJson,
    recipeJson: row.recipeJson,
    scheduleJson: row.scheduleJson,
    thresholdsJson: row.thresholdsJson,
  });
  const metadata = parseWorkflowJsonRecord(row.metadataJson);

  const inputCheckRows = await db.query.workflowRunInputChecks.findMany({
    orderBy: [asc(workflowRunInputChecks.createdAt)],
    where: and(
      eq(workflowRunInputChecks.organizationId, row.organizationId),
      eq(workflowRunInputChecks.runId, row.id),
    ),
  });
  const inputCheckReports = inputCheckRows.map((inputCheckRow) =>
    parseWorkflowRunInputCheckReportJson(inputCheckRow.reportJson),
  );

  const stepRows = await db.query.workflowRunSteps.findMany({
    orderBy: [asc(workflowRunSteps.stepOrder), asc(workflowRunSteps.createdAt)],
    where: and(
      eq(workflowRunSteps.organizationId, row.organizationId),
      eq(workflowRunSteps.runId, row.id),
    ),
  });

  const sandboxRunIdsFromSteps = normalizeUniqueStrings(
    stepRows
      .map((stepRow) => (stepRow.sandboxRunId ? stepRow.sandboxRunId.trim() : ""))
      .filter(Boolean),
  );
  const sandboxRunIdsFromMetadata = Array.isArray(metadata.sandbox_run_ids)
    ? normalizeUniqueStrings(
        metadata.sandbox_run_ids.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        ),
      )
    : [];
  const sandboxRunIds = normalizeUniqueStrings([
    ...sandboxRunIdsFromSteps,
    ...sandboxRunIdsFromMetadata,
  ]);

  const assetRows =
    sandboxRunIds.length === 0
      ? []
      : await db.query.sandboxGeneratedAssets.findMany({
          orderBy: [asc(sandboxGeneratedAssets.createdAt), asc(sandboxGeneratedAssets.relativePath)],
          where: inArray(sandboxGeneratedAssets.runId, sandboxRunIds),
        });

  const artifactManifest = assetRows.map((assetRow) => ({
    asset_id: assetRow.id,
    byte_size: assetRow.byteSize,
    created_at: assetRow.createdAt,
    expires_at: assetRow.expiresAt,
    file_name: assetRow.fileName,
    mime_type: assetRow.mimeType,
    relative_path: assetRow.relativePath,
    run_id: assetRow.runId,
    storage_path: assetRow.storagePath,
  })) satisfies DeliveryArtifactManifestEntry[];

  const snapshotInputsFromMetadata = collectMetadataInputSummary(metadata);
  const snapshotInputsFromChecks = inputCheckReports.flatMap((report) =>
    report.resolved_documents.map((documentRow) => ({
      content_sha256: documentRow.content_sha256,
      display_name: documentRow.display_name,
      document_id: documentRow.document_id,
      input_key: report.input_key,
      mime_type: documentRow.mime_type,
    })),
  );
  const snapshotInputs =
    snapshotInputsFromMetadata.length > 0 ? snapshotInputsFromMetadata : snapshotInputsFromChecks;

  const failedCheckCount = inputCheckReports.reduce((count, report) => {
    return count + report.checks.filter((check) => check.status === "fail").length;
  }, 0);
  const warningCheckCount = inputCheckReports.reduce((count, report) => {
    return count + report.checks.filter((check) => check.status === "warn").length;
  }, 0);
  const validationStatus =
    failedCheckCount > 0
      ? "fail"
      : warningCheckCount > 0
        ? "warn"
        : "pass";

  const snapshot: WorkflowDeliverySnapshotV1 = parseWorkflowDeliverySnapshotJson({
    artifacts: artifactManifest.map((artifact) => ({
      asset_id: artifact.asset_id,
      byte_size: artifact.byte_size,
      file_name: artifact.file_name,
      mime_type: artifact.mime_type,
      storage_path: artifact.storage_path,
    })),
    execution_identity: {
      run_as_role: row.runAsRole,
      run_as_user_id: row.runAsUserId ?? "unknown",
    },
    inputs: snapshotInputs,
    run: {
      completed_at: row.completedAt,
      id: row.id,
      started_at: row.startedAt,
      status: row.status,
      trigger_kind: row.triggerKind,
      trigger_window_key: row.triggerWindowKey,
    },
    schema_version: 1,
    steps: stepRows.map((stepRow) => ({
      duration_ms:
        stepRow.startedAt === null || stepRow.completedAt === null
          ? null
          : Math.max(0, stepRow.completedAt - stepRow.startedAt),
      sandbox_run_id: stepRow.sandboxRunId,
      status: stepRow.status,
      step_key: stepRow.stepKey,
      tool: stepRow.toolName,
    })),
    thresholds: [],
    validation_summary: {
      failed_check_count: failedCheckCount,
      status: validationStatus,
      warning_check_count: warningCheckCount,
    },
    workflow: {
      id: row.workflowId,
      name: row.workflowName,
      version_id: row.workflowVersionId,
    },
  });

  return {
    artifactManifest,
    contracts,
    metadata,
    run: {
      completedAt: row.completedAt,
      id: row.id,
      organizationId: row.organizationId,
      runAsRole: row.runAsRole,
      runAsUserId: row.runAsUserId,
      startedAt: row.startedAt,
      status: row.status,
      triggerKind: row.triggerKind,
      triggerWindowKey: row.triggerWindowKey,
      workflowId: row.workflowId,
      workflowVersionId: row.workflowVersionId,
      workflowVersionNumber: row.workflowVersionNumber,
    },
    snapshot,
    workflow: {
      id: row.workflowId,
      name: row.workflowName,
    },
  } satisfies WorkflowDeliveryContext;
}

function parseManifestEntries(value: string | null | undefined) {
  const values = parseJsonArray(value);

  return values
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const assetId = normalizeText(entry.asset_id);
      const fileName = normalizeText(entry.file_name);
      const mimeType = normalizeText(entry.mime_type);
      const storagePath = normalizeText(entry.storage_path);
      const runId = normalizeText(entry.run_id);
      const relativePath = normalizeText(entry.relative_path);

      if (!assetId || !fileName || !mimeType || !storagePath) {
        return null;
      }

      return {
        asset_id: assetId,
        byte_size: typeof entry.byte_size === "number" ? entry.byte_size : 0,
        created_at: typeof entry.created_at === "number" ? entry.created_at : 0,
        expires_at: typeof entry.expires_at === "number" ? entry.expires_at : 0,
        file_name: fileName,
        mime_type: mimeType,
        relative_path: relativePath,
        run_id: runId,
        storage_path: storagePath,
      } satisfies DeliveryArtifactManifestEntry;
    })
    .filter((entry): entry is DeliveryArtifactManifestEntry => entry !== null);
}

async function attemptWebhookDelivery(input: {
  attemptNumber: number;
  channel: Extract<WorkflowDeliveryChannelV1, { kind: "webhook" }>;
  context: WorkflowDeliveryContext;
  manifest: DeliveryArtifactManifestEntry[];
  payloadSnapshot: WorkflowDeliverySnapshotV1;
}) {
  const endpoint = resolveWebhookEndpointConfig(input.channel.endpoint_id);

  if (endpoint.error || !endpoint.url) {
    return {
      errorMessage: endpoint.error ?? "Webhook endpoint is not configured.",
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: false,
    } satisfies DeliveryAttemptOutcome;
  }

  if (input.channel.signing === "hmac_sha256" && !endpoint.secret) {
    return {
      errorMessage: `Webhook signing secret is missing for endpoint ${input.channel.endpoint_id}.`,
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: false,
    } satisfies DeliveryAttemptOutcome;
  }

  const eventPayload = {
    artifact_manifest: input.manifest,
    attempt_number: input.attemptNumber,
    channel_kind: "webhook",
    delivery_snapshot: input.payloadSnapshot,
    event: "workflow.delivery",
    organization_id: input.context.run.organizationId,
    run_id: input.context.run.id,
    timestamp: new Date().toISOString(),
    workflow_id: input.context.run.workflowId,
  };

  const bodyText = JSON.stringify(eventPayload);
  const signature = endpoint.secret
    ? createHmac("sha256", endpoint.secret).update(bodyText).digest("hex")
    : null;

  try {
    const response = await fetch(endpoint.url, {
      body: bodyText,
      headers: {
        "Content-Type": "application/json",
        ...(signature
          ? {
              "x-critjecture-signature-sha256": signature,
            }
          : {}),
      },
      method: "POST",
    });

    const responseBody = truncateText(await response.text().catch(() => ""));

    if (!response.ok) {
      return {
        errorMessage: `Webhook delivery failed with HTTP ${response.status}.`,
        ok: false,
        responseBody,
        responseStatusCode: response.status,
        transient: isTransientHttpStatus(response.status),
      } satisfies DeliveryAttemptOutcome;
    }

    return {
      ok: true,
      responseBody,
      responseStatusCode: response.status,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  } catch (caughtError) {
    return {
      errorMessage:
        caughtError instanceof Error
          ? `Webhook delivery failed: ${caughtError.message}`
          : "Webhook delivery failed.",
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: true,
    } satisfies DeliveryAttemptOutcome;
  }
}

function selectArtifactByMimeType(
  manifest: DeliveryArtifactManifestEntry[],
  mimeType: string,
) {
  return manifest.find((entry) => entry.mime_type === mimeType) ?? null;
}

async function attemptEmailDelivery(input: {
  attemptNumber: number;
  channel: Extract<WorkflowDeliveryChannelV1, { kind: "email" }>;
  context: WorkflowDeliveryContext;
  manifest: DeliveryArtifactManifestEntry[];
  payloadSnapshot: WorkflowDeliverySnapshotV1;
}) {
  if (!input.channel.enabled) {
    return {
      ok: true,
      responseBody: "Email channel disabled in workflow configuration.",
      responseStatusCode: null,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  }

  const recipients = normalizeUniqueStrings(input.channel.recipients);

  if (recipients.length === 0) {
    return {
      errorMessage: "Email channel has no recipients configured.",
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: false,
    } satisfies DeliveryAttemptOutcome;
  }

  const providerWebhookUrl = (process.env.CRITJECTURE_WORKFLOW_EMAIL_DELIVERY_WEBHOOK_URL ?? "").trim();

  if (!providerWebhookUrl) {
    return {
      errorMessage: "Email delivery provider webhook is not configured.",
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: false,
    } satisfies DeliveryAttemptOutcome;
  }

  const payload = {
    artifact_manifest: input.manifest,
    attempt_number: input.attemptNumber,
    channel_kind: "email",
    delivery_snapshot: input.payloadSnapshot,
    event: "workflow.delivery.email",
    recipients,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(providerWebhookUrl, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const responseBody = truncateText(await response.text().catch(() => ""));

    if (!response.ok) {
      return {
        errorMessage: `Email delivery provider returned HTTP ${response.status}.`,
        ok: false,
        responseBody,
        responseStatusCode: response.status,
        transient: isTransientHttpStatus(response.status),
      } satisfies DeliveryAttemptOutcome;
    }

    return {
      ok: true,
      responseBody,
      responseStatusCode: response.status,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  } catch (caughtError) {
    return {
      errorMessage:
        caughtError instanceof Error
          ? `Email delivery failed: ${caughtError.message}`
          : "Email delivery failed.",
      ok: false,
      responseBody: null,
      responseStatusCode: null,
      transient: true,
    } satisfies DeliveryAttemptOutcome;
  }
}

async function attemptChannelDelivery(input: {
  attemptNumber: number;
  channel: WorkflowDeliveryChannelV1;
  context: WorkflowDeliveryContext;
  manifest: DeliveryArtifactManifestEntry[];
  payloadSnapshot: WorkflowDeliverySnapshotV1;
}) {
  if (input.channel.kind === "webhook") {
    return attemptWebhookDelivery({
      attemptNumber: input.attemptNumber,
      channel: input.channel,
      context: input.context,
      manifest: input.manifest,
      payloadSnapshot: input.payloadSnapshot,
    });
  }

  if (input.channel.kind === "chart_pack") {
    if (input.manifest.length === 0) {
      return {
        errorMessage: "Chart pack delivery requires at least one generated artifact.",
        ok: false,
        responseBody: null,
        responseStatusCode: null,
        transient: false,
      } satisfies DeliveryAttemptOutcome;
    }

    return {
      ok: true,
      responseBody: `Chart pack prepared with ${input.manifest.length} artifact(s).`,
      responseStatusCode: null,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  }

  if (input.channel.kind === "ranked_table") {
    const targetMimeType = input.channel.format === "csv" ? "text/csv" : "text/markdown";
    const fallbackMimeType = input.channel.format === "markdown" ? "text/plain" : targetMimeType;
    const selectedAsset =
      selectArtifactByMimeType(input.manifest, targetMimeType) ??
      (fallbackMimeType === targetMimeType
        ? null
        : selectArtifactByMimeType(input.manifest, fallbackMimeType));

    if (!selectedAsset) {
      return {
        errorMessage: `Ranked-table delivery could not find a ${input.channel.format} artifact.`,
        ok: false,
        responseBody: null,
        responseStatusCode: null,
        transient: false,
      } satisfies DeliveryAttemptOutcome;
    }

    return {
      ok: true,
      responseBody: `Ranked-table output uses ${selectedAsset.file_name}.`,
      responseStatusCode: null,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  }

  if (input.channel.kind === "generated_document") {
    const selectedAsset = selectArtifactByMimeType(input.manifest, "application/pdf");

    if (!selectedAsset) {
      return {
        errorMessage: "Generated-document delivery requires a PDF artifact.",
        ok: false,
        responseBody: null,
        responseStatusCode: null,
        transient: false,
      } satisfies DeliveryAttemptOutcome;
    }

    return {
      ok: true,
      responseBody: `Generated-document output uses ${selectedAsset.file_name}.`,
      responseStatusCode: null,
      sentAt: Date.now(),
    } satisfies DeliveryAttemptOutcome;
  }

  return attemptEmailDelivery({
    attemptNumber: input.attemptNumber,
    channel: input.channel,
    context: input.context,
    manifest: input.manifest,
    payloadSnapshot: input.payloadSnapshot,
  });
}

async function queueInitialDeliveryAttempts(input: {
  context: WorkflowDeliveryContext;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const channelByKind = buildChannelByKind(input.context.contracts.delivery.channels);
  const existingRows = await db.query.workflowDeliveries.findMany({
    where: and(
      eq(workflowDeliveries.organizationId, input.context.run.organizationId),
      eq(workflowDeliveries.runId, input.context.run.id),
    ),
  });

  const existingAttemptOneKinds = new Set<WorkflowDeliveryChannelKind>(
    existingRows
      .filter((row) => row.attemptNumber === 1)
      .map((row) => row.channelKind),
  );

  if (channelByKind.size === 0) {
    return;
  }

  const newRows = [...channelByKind.keys()]
    .filter((channelKind) => !existingAttemptOneKinds.has(channelKind))
    .map((channelKind) => ({
      artifactManifestJson: JSON.stringify(input.context.artifactManifest),
      attemptNumber: 1,
      channelKind,
      createdAt: now,
      errorMessage: null,
      id: randomUUID(),
      nextRetryAt: now,
      organizationId: input.context.run.organizationId,
      payloadSnapshotJson: JSON.stringify(input.context.snapshot),
      responseBody: null,
      responseStatusCode: null,
      runId: input.context.run.id,
      sentAt: null,
      status: "pending" as const,
      updatedAt: now,
      workflowId: input.context.run.workflowId,
    }));

  if (newRows.length > 0) {
    await db.insert(workflowDeliveries).values(newRows);
  }
}

async function loadContextCacheEntry(input: {
  cache: Map<string, WorkflowDeliveryContext | null>;
  organizationId: string;
  runId: string;
}) {
  if (input.cache.has(input.runId)) {
    return input.cache.get(input.runId) ?? null;
  }

  const context = await loadWorkflowDeliveryContext({
    organizationId: input.organizationId,
    runId: input.runId,
  });
  input.cache.set(input.runId, context);
  return context;
}

export async function processDueWorkflowDeliveryRetries(input?: {
  limit?: number;
  organizationId?: string;
  runId?: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const limit = parsePositiveInteger(input?.limit, DEFAULT_RETRY_SCAN_LIMIT);
  const whereClauses = [
    eq(workflowDeliveries.status, "pending"),
    lte(workflowDeliveries.nextRetryAt, now),
  ];

  if (input?.organizationId) {
    whereClauses.push(eq(workflowDeliveries.organizationId, input.organizationId));
  }

  if (input?.runId) {
    whereClauses.push(eq(workflowDeliveries.runId, input.runId));
  }

  const pendingRows = await db.query.workflowDeliveries.findMany({
    limit,
    orderBy: [asc(workflowDeliveries.nextRetryAt), asc(workflowDeliveries.createdAt)],
    where: and(...whereClauses),
  });

  const summary: WorkflowDeliveryProcessSummary = {
    failedCount: 0,
    pendingCount: pendingRows.length,
    processedCount: 0,
    requeuedCount: 0,
    sentCount: 0,
  };
  const contextCache = new Map<string, WorkflowDeliveryContext | null>();

  for (const pendingRow of pendingRows) {
    summary.processedCount += 1;

    const context = await loadContextCacheEntry({
      cache: contextCache,
      organizationId: pendingRow.organizationId,
      runId: pendingRow.runId,
    });

    if (!context) {
      summary.failedCount += 1;

      await db
        .update(workflowDeliveries)
        .set({
          errorMessage: "Workflow run context could not be loaded for delivery retry.",
          nextRetryAt: null,
          status: "failed",
          updatedAt: Date.now(),
        })
        .where(eq(workflowDeliveries.id, pendingRow.id));

      continue;
    }

    const channelByKind = buildChannelByKind(context.contracts.delivery.channels);
    const channel = channelByKind.get(pendingRow.channelKind);

    if (!channel) {
      summary.failedCount += 1;

      await db
        .update(workflowDeliveries)
        .set({
          errorMessage: `Workflow delivery channel ${pendingRow.channelKind} is no longer available in version ${context.run.workflowVersionId}.`,
          nextRetryAt: null,
          status: "failed",
          updatedAt: Date.now(),
        })
        .where(eq(workflowDeliveries.id, pendingRow.id));

      continue;
    }

    let payloadSnapshot: WorkflowDeliverySnapshotV1;

    try {
      payloadSnapshot = parseWorkflowDeliverySnapshotJson(pendingRow.payloadSnapshotJson);
    } catch {
      payloadSnapshot = context.snapshot;
    }

    const manifest = parseManifestEntries(pendingRow.artifactManifestJson);
    const outcome = await attemptChannelDelivery({
      attemptNumber: pendingRow.attemptNumber,
      channel,
      context,
      manifest,
      payloadSnapshot,
    });

    if (outcome.ok) {
      summary.sentCount += 1;

      await db
        .update(workflowDeliveries)
        .set({
          errorMessage: null,
          nextRetryAt: null,
          responseBody: outcome.responseBody,
          responseStatusCode: outcome.responseStatusCode,
          sentAt: outcome.sentAt,
          status: "sent",
          updatedAt: Date.now(),
        })
        .where(eq(workflowDeliveries.id, pendingRow.id));

      continue;
    }

    const retryPolicy = context.contracts.delivery.retry_policy;
    const canRetry = outcome.transient && pendingRow.attemptNumber < retryPolicy.max_attempts;

    await db
      .update(workflowDeliveries)
      .set({
        errorMessage: truncateText(outcome.errorMessage),
        nextRetryAt: null,
        responseBody: outcome.responseBody,
        responseStatusCode: outcome.responseStatusCode,
        status: "failed",
        updatedAt: Date.now(),
      })
      .where(eq(workflowDeliveries.id, pendingRow.id));

    if (canRetry) {
      summary.requeuedCount += 1;
      const nextAttemptNumber = pendingRow.attemptNumber + 1;
      const retryDelayMs = computeRetryDelayMs({
        attemptNumber: pendingRow.attemptNumber,
        backoffMultiplier: retryPolicy.backoff_multiplier,
        initialBackoffSeconds: retryPolicy.initial_backoff_seconds,
      });
      const nextRetryAt = Date.now() + retryDelayMs;
      const existingNextAttempt = await db.query.workflowDeliveries.findFirst({
        where: and(
          eq(workflowDeliveries.runId, pendingRow.runId),
          eq(workflowDeliveries.channelKind, pendingRow.channelKind),
          eq(workflowDeliveries.attemptNumber, nextAttemptNumber),
        ),
      });

      if (!existingNextAttempt) {
        await db.insert(workflowDeliveries).values({
          artifactManifestJson: pendingRow.artifactManifestJson,
          attemptNumber: nextAttemptNumber,
          channelKind: pendingRow.channelKind,
          createdAt: Date.now(),
          errorMessage: null,
          id: randomUUID(),
          nextRetryAt,
          organizationId: pendingRow.organizationId,
          payloadSnapshotJson: pendingRow.payloadSnapshotJson,
          responseBody: null,
          responseStatusCode: null,
          runId: pendingRow.runId,
          sentAt: null,
          status: "pending",
          updatedAt: Date.now(),
          workflowId: pendingRow.workflowId,
        });
      }
    } else {
      summary.failedCount += 1;
    }
  }

  logStructuredEvent("workflow.delivery_retry_scan_finished", {
    failed_count: summary.failedCount,
    pending_count: summary.pendingCount,
    processed_count: summary.processedCount,
    requeued_count: summary.requeuedCount,
    routeGroup: "workflow",
    routeKey: "workflow.delivery.retry",
    sent_count: summary.sentCount,
  });

  return summary;
}

export async function deliverWorkflowRunOutputs(input: {
  organizationId: string;
  runId: string;
}) {
  const context = await loadWorkflowDeliveryContext(input);

  if (!context) {
    throw new Error("Workflow delivery context was not found.");
  }

  if (context.run.status !== "completed") {
    return {
      failedCount: 0,
      pendingCount: 0,
      processedCount: 0,
      requeuedCount: 0,
      sentCount: 0,
    } satisfies WorkflowDeliveryProcessSummary;
  }

  try {
    await queueInitialDeliveryAttempts({
      context,
    });

    const summary = await processDueWorkflowDeliveryRetries({
      limit: Math.max(20, context.contracts.delivery.channels.length * 4),
      organizationId: input.organizationId,
      runId: input.runId,
    });

    logStructuredEvent("workflow.delivery_run_completed", {
      failed_count: summary.failedCount,
      organizationId: input.organizationId,
      processed_count: summary.processedCount,
      requeued_count: summary.requeuedCount,
      routeGroup: "workflow",
      routeKey: "workflow.delivery",
      run_id: input.runId,
      sent_count: summary.sentCount,
      workflow_id: context.workflow.id,
    });

    return summary;
  } catch (caughtError) {
    logStructuredError("workflow.delivery_run_failed", caughtError, {
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.delivery",
      run_id: input.runId,
      workflow_id: context.workflow.id,
    });

    throw caughtError;
  }
}
