import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lte } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { workflowInputRequests } from "@/lib/app-schema";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";
import {
  parseWorkflowJsonStringArray,
  type WorkflowDeliveryChannelV1,
  type WorkflowEmailAlertEvent,
} from "@/lib/workflow-types";

export const WORKFLOW_INPUT_REQUEST_NOTIFICATION_CHANNELS = [
  "in_app",
  "webhook",
] as const;

export type WorkflowInputRequestNotificationChannel =
  (typeof WORKFLOW_INPUT_REQUEST_NOTIFICATION_CHANNELS)[number];

export type EnsureWorkflowInputRequestNotificationResult = {
  knowledgeUploadPath: string;
  notificationChannels: WorkflowInputRequestNotificationChannel[];
  notificationDispatched: boolean;
  requestId: string;
  requestedInputKeys: string[];
};

const OPEN_REQUEST_STATUSES = ["open", "sent"] as const;

function parsePositiveIntegerEnv(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeInputKeys(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function areSameInputKeys(left: string[], right: string[]) {
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

function getInputRequestTtlMs() {
  const ttlHours = parsePositiveIntegerEnv(
    process.env.CRITJECTURE_WORKFLOW_INPUT_REQUEST_TTL_HOURS,
    72,
  );

  return ttlHours * 60 * 60 * 1000;
}

function getWorkflowInputRequestWebhookUrl() {
  return (process.env.CRITJECTURE_WORKFLOW_INPUT_REQUEST_WEBHOOK_URL ?? "").trim();
}

function getNotificationChannels(webhookUrl: string) {
  return (
    webhookUrl
      ? ["in_app", "webhook"]
      : ["in_app"]
  ) satisfies WorkflowInputRequestNotificationChannel[];
}

function buildKnowledgeUploadPath(runId: string, requestedInputKeys: string[]) {
  const params = new URLSearchParams();

  params.set("workflowRunId", runId);

  if (requestedInputKeys.length > 0) {
    params.set("requiredInputs", requestedInputKeys.join(","));
  }

  return `/knowledge?${params.toString()}`;
}

function buildInputRequestMessage(input: {
  knowledgeUploadPath: string;
  requestedInputKeys: string[];
  workflowName: string;
}) {
  const keys = input.requestedInputKeys.join(", ");

  return `Workflow \"${input.workflowName}\" is waiting for required inputs: ${keys}. Upload or refresh files at ${input.knowledgeUploadPath}.`;
}

function normalizeRecipientEmails(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function getWorkflowEmailProviderWebhookUrl() {
  return (process.env.CRITJECTURE_WORKFLOW_EMAIL_DELIVERY_WEBHOOK_URL ?? "").trim();
}

function getWorkflowEmailAlertChannel(channels: WorkflowDeliveryChannelV1[]) {
  return (
    channels.find(
      (channel): channel is Extract<WorkflowDeliveryChannelV1, { kind: "email" }> =>
        channel.kind === "email",
    ) ?? null
  );
}

export async function sendWorkflowRunEmailAlert(input: {
  channels: WorkflowDeliveryChannelV1[];
  event: Exclude<WorkflowEmailAlertEvent, "run_completed">;
  failureReason?: string | null;
  knowledgeUploadPath?: string | null;
  organizationId: string;
  requestedInputKeys?: string[];
  runId: string;
  runStatus: "waiting_for_input" | "blocked_validation" | "failed";
  workflowId: string;
  workflowName: string;
}) {
  const channel = getWorkflowEmailAlertChannel(input.channels);

  if (!channel || !channel.enabled) {
    return false;
  }

  const configuredEvents = new Set(
    channel.events.length > 0 ? channel.events : (["run_completed"] as WorkflowEmailAlertEvent[]),
  );

  if (!configuredEvents.has(input.event)) {
    return false;
  }

  const recipients = normalizeRecipientEmails(channel.recipients);

  if (recipients.length === 0) {
    return false;
  }

  const providerWebhookUrl = getWorkflowEmailProviderWebhookUrl();

  if (!providerWebhookUrl) {
    return false;
  }

  const requestedInputKeys = normalizeInputKeys(input.requestedInputKeys ?? []);

  const payload = {
    event: "workflow.alert.email",
    alert_event: input.event,
    failure_reason: input.failureReason ?? null,
    knowledge_upload_path: input.knowledgeUploadPath ?? null,
    organization_id: input.organizationId,
    recipients,
    requested_input_keys: requestedInputKeys,
    run: {
      id: input.runId,
      status: input.runStatus,
    },
    timestamp: new Date().toISOString(),
    workflow: {
      id: input.workflowId,
      name: input.workflowName,
    },
  };

  try {
    const response = await fetch(providerWebhookUrl, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Email alert provider responded with HTTP ${response.status}.`);
    }

    logStructuredEvent("workflow.email_alert_sent", {
      alert_event: input.event,
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.notifications.email_alert",
      workflowRunId: input.runId,
    });

    return true;
  } catch (caughtError) {
    logStructuredError("workflow.email_alert_failed", caughtError, {
      alert_event: input.event,
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.notifications.email_alert",
      workflowRunId: input.runId,
    });

    return false;
  }
}

async function sendWorkflowInputRequestWebhook(input: {
  knowledgeUploadPath: string;
  notificationChannels: WorkflowInputRequestNotificationChannel[];
  organizationId: string;
  requestId: string;
  requestedInputKeys: string[];
  runId: string;
  webhookUrl: string;
  workflowId: string;
  workflowName: string;
}) {
  if (!input.webhookUrl) {
    return;
  }

  const payload = {
    event: "workflow_input_request.sent",
    knowledge_upload_path: input.knowledgeUploadPath,
    notification_channels: input.notificationChannels,
    organization_id: input.organizationId,
    request_id: input.requestId,
    requested_input_keys: input.requestedInputKeys,
    run_id: input.runId,
    timestamp: new Date().toISOString(),
    workflow: {
      id: input.workflowId,
      name: input.workflowName,
    },
  };

  try {
    const response = await fetch(input.webhookUrl, {
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with HTTP ${response.status}.`);
    }
  } catch (caughtError) {
    logStructuredError("workflow.input_request_webhook_failed", caughtError, {
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.input_request.webhook",
    });
  }
}

async function expireRequestIfNeeded(input: {
  expiresAt: number | null;
  organizationId: string;
  requestId: string;
}) {
  if (!input.expiresAt || input.expiresAt > Date.now()) {
    return;
  }

  const db = await getAppDatabase();

  await db
    .update(workflowInputRequests)
    .set({
      status: "expired",
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(workflowInputRequests.organizationId, input.organizationId),
        eq(workflowInputRequests.id, input.requestId),
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
      ),
    );
}

async function loadLatestOpenInputRequest(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();

  const row =
    (await db.query.workflowInputRequests.findFirst({
      orderBy: [desc(workflowInputRequests.updatedAt), desc(workflowInputRequests.createdAt)],
      where: and(
        eq(workflowInputRequests.organizationId, input.organizationId),
        eq(workflowInputRequests.runId, input.runId),
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
      ),
    })) ?? null;

  if (!row) {
    return null;
  }

  await expireRequestIfNeeded({
    expiresAt: row.expiresAt,
    organizationId: input.organizationId,
    requestId: row.id,
  });

  if (row.expiresAt && row.expiresAt <= Date.now()) {
    return null;
  }

  return row;
}

export async function ensureWorkflowInputRequestNotification(input: {
  organizationId: string;
  requestedInputKeys: string[];
  runId: string;
  workflowId: string;
  workflowName: string;
}): Promise<EnsureWorkflowInputRequestNotificationResult | null> {
  const requestedInputKeys = normalizeInputKeys(input.requestedInputKeys);

  if (requestedInputKeys.length === 0) {
    return null;
  }

  const db = await getAppDatabase();
  const now = Date.now();
  const webhookUrl = getWorkflowInputRequestWebhookUrl();
  const notificationChannels = getNotificationChannels(webhookUrl);
  const knowledgeUploadPath = buildKnowledgeUploadPath(input.runId, requestedInputKeys);
  const message = buildInputRequestMessage({
    knowledgeUploadPath,
    requestedInputKeys,
    workflowName: input.workflowName,
  });
  const expiresAt = now + getInputRequestTtlMs();
  const existing = await loadLatestOpenInputRequest({
    organizationId: input.organizationId,
    runId: input.runId,
  });

  const requestId = existing?.id ?? randomUUID();
  let shouldSendNotification = !existing || existing.status === "open";

  if (!existing) {
    await db.insert(workflowInputRequests).values({
      createdAt: now,
      expiresAt,
      fulfilledAt: null,
      id: requestId,
      message,
      notificationChannelsJson: JSON.stringify(notificationChannels),
      organizationId: input.organizationId,
      requestedInputKeysJson: JSON.stringify(requestedInputKeys),
      runId: input.runId,
      sentAt: null,
      status: "open",
      updatedAt: now,
      workflowId: input.workflowId,
    });
  } else {
    const existingInputKeys = normalizeInputKeys(
      parseWorkflowJsonStringArray(existing.requestedInputKeysJson),
    );
    const inputKeysChanged = !areSameInputKeys(existingInputKeys, requestedInputKeys);

    if (inputKeysChanged) {
      shouldSendNotification = true;

      await db
        .update(workflowInputRequests)
        .set({
          expiresAt,
          message,
          notificationChannelsJson: JSON.stringify(notificationChannels),
          requestedInputKeysJson: JSON.stringify(requestedInputKeys),
          sentAt: null,
          status: "open",
          updatedAt: now,
        })
        .where(
          and(
            eq(workflowInputRequests.organizationId, input.organizationId),
            eq(workflowInputRequests.id, existing.id),
          ),
        );
    }
  }

  if (shouldSendNotification) {
    await sendWorkflowInputRequestWebhook({
      knowledgeUploadPath,
      notificationChannels,
      organizationId: input.organizationId,
      requestId,
      requestedInputKeys,
      runId: input.runId,
      webhookUrl,
      workflowId: input.workflowId,
      workflowName: input.workflowName,
    });

    await db
      .update(workflowInputRequests)
      .set({
        expiresAt,
        message,
        notificationChannelsJson: JSON.stringify(notificationChannels),
        requestedInputKeysJson: JSON.stringify(requestedInputKeys),
        sentAt: now,
        status: "sent",
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowInputRequests.organizationId, input.organizationId),
          eq(workflowInputRequests.id, requestId),
        ),
      );

    logStructuredEvent("workflow.input_request_sent", {
      organizationId: input.organizationId,
      routeGroup: "workflow",
      routeKey: "workflow.input_request",
      workflowRunId: input.runId,
    });
  }

  return {
    knowledgeUploadPath,
    notificationChannels,
    notificationDispatched: shouldSendNotification,
    requestId,
    requestedInputKeys,
  };
}

export async function fulfillWorkflowInputRequestsForRun(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(workflowInputRequests)
    .set({
      fulfilledAt: now,
      status: "fulfilled",
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowInputRequests.organizationId, input.organizationId),
        eq(workflowInputRequests.runId, input.runId),
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
      ),
    );
}

export async function cancelWorkflowInputRequestsForRun(input: {
  organizationId: string;
  reason?: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();

  await db
    .update(workflowInputRequests)
    .set({
      message: input.reason ? `Cancelled: ${input.reason}` : null,
      status: "cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowInputRequests.organizationId, input.organizationId),
        eq(workflowInputRequests.runId, input.runId),
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
      ),
    );
}

export async function expireStaleWorkflowInputRequests(input?: {
  now?: number;
  organizationId?: string;
}) {
  const db = await getAppDatabase();
  const now = input?.now ?? Date.now();

  const whereClause = input?.organizationId
    ? and(
        eq(workflowInputRequests.organizationId, input.organizationId),
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
        lte(workflowInputRequests.expiresAt, now),
      )
    : and(
        inArray(workflowInputRequests.status, OPEN_REQUEST_STATUSES),
        lte(workflowInputRequests.expiresAt, now),
      );

  await db
    .update(workflowInputRequests)
    .set({
      status: "expired",
      updatedAt: now,
    })
    .where(whereClause);
}
