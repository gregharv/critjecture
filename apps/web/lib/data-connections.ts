import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { dataConnections } from "@/lib/app-schema";

export type DataConnectionSourceKind = "bulk_import" | "filesystem" | "upload";

function parseJsonRecord(value: string | null | undefined) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

export function getConnectionSpecForSource(input: {
  sourceKind: DataConnectionSourceKind;
}) {
  if (input.sourceKind === "filesystem") {
    return {
      configJson: {
        root: "company_data",
      },
      displayName: "Local filesystem",
      kind: "filesystem" as const,
    };
  }

  if (input.sourceKind === "bulk_import") {
    return {
      configJson: {
        pipeline: "knowledge_imports",
        source_type: "bulk_import",
      },
      displayName: "Bulk imports",
      kind: "bulk_import" as const,
    };
  }

  return {
    configJson: {
      pipeline: "knowledge_imports",
      source_type: "uploaded",
    },
    displayName: "Uploaded knowledge",
    kind: "upload" as const,
  };
}

export async function ensureDataConnection(input: {
  configJson?: Record<string, unknown>;
  credentialsRef?: string | null;
  displayName: string;
  kind: "bulk_import" | "filesystem" | "google_drive" | "google_sheets" | "s3" | "upload";
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const rows = await db
    .select()
    .from(dataConnections)
    .where(
      and(
        eq(dataConnections.organizationId, input.organizationId),
        eq(dataConnections.kind, input.kind),
      ),
    )
    .orderBy(desc(dataConnections.updatedAt), desc(dataConnections.createdAt))
    .limit(1);
  const existing = rows[0] ?? null;

  if (existing) {
    await db
      .update(dataConnections)
      .set({
        configJson: JSON.stringify({
          ...parseJsonRecord(existing.configJson),
          ...(input.configJson ?? {}),
        }),
        credentialsRef: input.credentialsRef ?? existing.credentialsRef,
        displayName: input.displayName,
        status: "active",
        updatedAt: now,
      })
      .where(eq(dataConnections.id, existing.id));

    const refreshed = await db.query.dataConnections.findFirst({
      where: eq(dataConnections.id, existing.id),
    });

    if (!refreshed) {
      throw new Error(`Connection disappeared during update: ${existing.id}`);
    }

    return refreshed;
  }

  const connectionId = randomUUID();
  await db.insert(dataConnections).values({
    configJson: JSON.stringify(input.configJson ?? {}),
    createdAt: now,
    credentialsRef: input.credentialsRef ?? null,
    displayName: input.displayName,
    id: connectionId,
    kind: input.kind,
    lastSyncAt: null,
    organizationId: input.organizationId,
    status: "active",
    updatedAt: now,
  });

  const created = await db.query.dataConnections.findFirst({
    where: eq(dataConnections.id, connectionId),
  });

  if (!created) {
    throw new Error(`Failed to create connection for ${input.kind}`);
  }

  return created;
}
