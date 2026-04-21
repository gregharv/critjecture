import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { dataAssets, dataAssetVersions, dataConnections, organizations } from "@/lib/legacy-app-schema";
import {
  ensureDataConnection,
  getConnectionSpecForSource,
} from "@/lib/data-connections";
import {
  normalizeCompanyDataRelativePath,
  resolveCompanyDataRoot,
} from "@/lib/company-data";
import { countCsvDelimiters, splitCsvRecord } from "@/lib/csv-utils";

export type AssetBackedDocumentDescriptor = {
  accessScope: "admin" | "public";
  byteSize: number | null;
  contentSha256: string;
  displayName: string;
  documentId: string;
  lastIndexedAt?: number | null;
  mimeType: string | null;
  organizationId: string;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserId: string | null;
};

export type DataAssetRecord = typeof dataAssets.$inferSelect;
export type DataAssetVersionRecord = typeof dataAssetVersions.$inferSelect;
export type DataConnectionRecord = typeof dataConnections.$inferSelect;

type AssetSnapshot = {
  byteSize: number | null;
  contentHash: string;
  indexedAt: number | null;
  materializedPath: string;
  metadata: Record<string, unknown>;
  mimeType: string | null;
  rowCount: number | null;
  schemaHash: string | null;
  sourceModifiedAt: number | null;
  sourceVersionToken: string | null;
};

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

function inferAccessScopeFromPath(relativePath: string) {
  return relativePath.startsWith("admin/") ? ("admin" as const) : ("public" as const);
}

function inferMimeTypeFromPath(relativePath: string) {
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (extension === ".csv") {
    return "text/csv";
  }

  if (extension === ".md") {
    return "text/markdown";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".json") {
    return "application/json";
  }

  if (extension === ".txt" || extension === ".log") {
    return "text/plain";
  }

  if (extension === ".tsv") {
    return "text/tab-separated-values";
  }

  return null;
}

export function inferDataKindFromPath(relativePath: string, mimeType: string | null) {
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (mimeType === "application/pdf" || extension === ".pdf") {
    return "pdf" as const;
  }

  if (mimeType === "text/csv" || extension === ".csv" || extension === ".tsv") {
    return "table" as const;
  }

  if (extension === ".xlsx" || extension === ".xls") {
    return "spreadsheet" as const;
  }

  return "text_document" as const;
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

function buildCsvInsights(fileBuffer: Buffer, relativePath: string) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const mimeType = inferMimeTypeFromPath(relativePath);

  if (mimeType !== "text/csv" && extension !== ".tsv") {
    return {
      rowCount: null,
      schemaHash: null,
    };
  }

  try {
    const normalizedText = fileBuffer.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const lines = normalizedText.split("\n");
    const headerIndex = lines.findIndex((line) => line.trim().length > 0);

    if (headerIndex < 0) {
      return {
        rowCount: 0,
        schemaHash: null,
      };
    }

    const headerLine = lines[headerIndex] ?? "";
    const delimiter = chooseCsvDelimiter(headerLine);
    const columns = splitCsvRecord(headerLine, delimiter).map((column) => column.trim());
    const rowCount = lines.slice(headerIndex + 1).filter((line) => line.trim().length > 0).length;
    const normalizedColumns = columns.map((column) => column.toLowerCase());

    return {
      rowCount,
      schemaHash:
        normalizedColumns.length > 0
          ? createHash("sha256").update(JSON.stringify(normalizedColumns)).digest("hex")
          : null,
    };
  } catch {
    return {
      rowCount: null,
      schemaHash: null,
    };
  }
}

async function resolveOrganizationSlugById(organizationId: string) {
  const db = await getAppDatabase();
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
  });

  if (!row) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  return row.slug;
}

async function buildFilesystemSnapshot(input: {
  additionalMetadata?: Record<string, unknown>;
  indexedAt?: number | null;
  organizationSlug: string;
  relativePath: string;
  sourceKind: "connector" | "document" | "filesystem";
  sourceType?: string | null;
  sourceVersionToken?: string | null;
}) {
  const companyDataRoot = await resolveCompanyDataRoot(input.organizationSlug);
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.relativePath);
  const absolutePath = path.resolve(companyDataRoot, normalizedRelativePath);
  const relativeFromRoot = path.relative(companyDataRoot, absolutePath);

  if (
    relativeFromRoot === "" ||
    relativeFromRoot === ".." ||
    relativeFromRoot.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Asset path must stay inside company_data.");
  }

  const fileStats = await stat(absolutePath);

  if (!fileStats.isFile()) {
    throw new Error(`Asset path is not a file: ${normalizedRelativePath}`);
  }

  const fileBuffer = await readFile(absolutePath);
  const { rowCount, schemaHash } = buildCsvInsights(fileBuffer, normalizedRelativePath);
  const sourceModifiedAt = Number.isFinite(fileStats.mtimeMs) ? Math.trunc(fileStats.mtimeMs) : null;

  return {
    byteSize: fileBuffer.byteLength,
    contentHash: createHash("sha256").update(fileBuffer).digest("hex"),
    indexedAt: input.indexedAt ?? null,
    materializedPath: normalizedRelativePath,
    metadata: {
      file_mtime_ms: fileStats.mtimeMs,
      relative_path: normalizedRelativePath,
      source_kind: input.sourceKind,
      ...(input.sourceType ? { source_type: input.sourceType } : {}),
      ...(input.additionalMetadata ?? {}),
    },
    mimeType: inferMimeTypeFromPath(normalizedRelativePath),
    rowCount,
    schemaHash,
    sourceModifiedAt,
    sourceVersionToken:
      input.sourceVersionToken ??
      (sourceModifiedAt === null ? null : `${sourceModifiedAt}:${fileStats.size}`),
  } satisfies AssetSnapshot;
}

function buildDocumentMetadataSnapshot(input: AssetBackedDocumentDescriptor) {
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.sourcePath);

  return {
    byteSize: input.byteSize,
    contentHash: input.contentSha256,
    indexedAt: input.lastIndexedAt ?? null,
    materializedPath: normalizedRelativePath,
    metadata: {
      document_id: input.documentId,
      relative_path: normalizedRelativePath,
      source_kind: "document",
      source_type: input.sourceType,
      uploaded_by_user_id: input.uploadedByUserId,
    },
    mimeType: input.mimeType ?? inferMimeTypeFromPath(normalizedRelativePath),
    rowCount: null,
    schemaHash: null,
    sourceModifiedAt: input.updatedAt,
    sourceVersionToken: input.contentSha256,
  } satisfies AssetSnapshot;
}

export async function upsertPathAsset(input: {
  accessScope: "admin" | "public";
  connectionId: string | null;
  dataKind: "pdf" | "spreadsheet" | "table" | "text_document";
  displayName: string;
  externalObjectId?: string | null;
  metadata: Record<string, unknown>;
  organizationId: string;
  relativePath: string;
}) {
  const db = await getAppDatabase();
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.relativePath);
  const now = Date.now();
  const existing = await findAssetByPath({
    organizationId: input.organizationId,
    relativePath: normalizedRelativePath,
  });

  if (existing) {
    await db
      .update(dataAssets)
      .set({
        accessScope: input.accessScope,
        connectionId: input.connectionId,
        dataKind: input.dataKind,
        displayName: input.displayName,
        externalObjectId: input.externalObjectId ?? null,
        metadataJson: JSON.stringify({
          ...parseJsonRecord(existing.metadataJson),
          ...input.metadata,
        }),
        status: "active",
        updatedAt: now,
      })
      .where(eq(dataAssets.id, existing.id));

    const refreshed = await db.query.dataAssets.findFirst({
      where: eq(dataAssets.id, existing.id),
    });

    if (!refreshed) {
      throw new Error(`Asset disappeared during update: ${existing.id}`);
    }

    return refreshed;
  }

  const assetId = randomUUID();
  await db.insert(dataAssets).values({
    accessScope: input.accessScope,
    activeVersionId: null,
    assetKey: normalizedRelativePath,
    connectionId: input.connectionId,
    createdAt: now,
    dataKind: input.dataKind,
    displayName: input.displayName,
    externalObjectId: input.externalObjectId ?? null,
    id: assetId,
    metadataJson: JSON.stringify(input.metadata),
    organizationId: input.organizationId,
    status: "active",
    updatedAt: now,
  });

  const created = await db.query.dataAssets.findFirst({
    where: eq(dataAssets.id, assetId),
  });

  if (!created) {
    throw new Error(`Failed to create asset for ${normalizedRelativePath}`);
  }

  return created;
}

export async function findAssetByPath(input: {
  organizationId: string;
  relativePath: string;
}) {
  const db = await getAppDatabase();
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.relativePath);

  return db.query.dataAssets.findFirst({
    where: and(
      eq(dataAssets.organizationId, input.organizationId),
      eq(dataAssets.assetKey, normalizedRelativePath),
    ),
  });
}

export async function createOrUpdateFilesystemAsset(input: {
  connectionId?: string | null;
  organizationId: string;
  relativePath: string;
}) {
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.relativePath);
  const displayName = path.posix.basename(normalizedRelativePath);
  const mimeType = inferMimeTypeFromPath(normalizedRelativePath);
  const connectionSpec = getConnectionSpecForSource({
    sourceKind: "filesystem",
  });
  const connectionId =
    typeof input.connectionId === "string"
      ? input.connectionId
      : (
          await ensureDataConnection({
            configJson: connectionSpec.configJson,
            displayName: connectionSpec.displayName,
            kind: connectionSpec.kind,
            organizationId: input.organizationId,
          })
        ).id;

  return upsertPathAsset({
    accessScope: inferAccessScopeFromPath(normalizedRelativePath),
    connectionId,
    dataKind: inferDataKindFromPath(normalizedRelativePath, mimeType),
    displayName,
    externalObjectId: null,
    metadata: {
      relative_path: normalizedRelativePath,
      source_kind: "filesystem",
    },
    organizationId: input.organizationId,
    relativePath: normalizedRelativePath,
  });
}

export async function ensureDocumentAsset(input: {
  document: AssetBackedDocumentDescriptor;
}) {
  const normalizedRelativePath = normalizeCompanyDataRelativePath(input.document.sourcePath);
  const displayName = input.document.displayName.trim() || path.posix.basename(normalizedRelativePath);
  const connectionSpec = getConnectionSpecForSource({
    sourceKind: input.document.sourceType === "bulk_import" ? "bulk_import" : "upload",
  });
  const connection = await ensureDataConnection({
    configJson: connectionSpec.configJson,
    displayName: connectionSpec.displayName,
    kind: connectionSpec.kind,
    organizationId: input.document.organizationId,
  });

  const asset = await upsertPathAsset({
    accessScope: input.document.accessScope,
    connectionId: connection.id,
    dataKind: inferDataKindFromPath(normalizedRelativePath, input.document.mimeType),
    displayName,
    externalObjectId: input.document.documentId,
    metadata: {
      document_id: input.document.documentId,
      relative_path: normalizedRelativePath,
      source_kind: "document",
      source_type: input.document.sourceType,
      uploaded_by_user_id: input.document.uploadedByUserId,
    },
    organizationId: input.document.organizationId,
    relativePath: normalizedRelativePath,
  });

  const version = await createAssetVersionIfChanged({
    asset,
    document: input.document,
  });

  return {
    asset,
    version,
  };
}

export async function createAssetVersionIfChanged(input: {
  asset: DataAssetRecord;
  document?: AssetBackedDocumentDescriptor;
  organizationSlug?: string;
  relativePath?: string;
  snapshotSource?: {
    additionalMetadata?: Record<string, unknown>;
    indexedAt?: number | null;
    sourceKind: "connector" | "filesystem";
    sourceType?: string | null;
    sourceVersionToken?: string | null;
  };
}) {
  const db = await getAppDatabase();
  const assetMetadata = parseJsonRecord(input.asset.metadataJson);
  const relativePath = normalizeCompanyDataRelativePath(
    input.relativePath ??
      (typeof assetMetadata.relative_path === "string" ? assetMetadata.relative_path : input.asset.assetKey),
  );
  const organizationSlug = input.organizationSlug ?? (await resolveOrganizationSlugById(input.asset.organizationId));

  let snapshot: AssetSnapshot;

  if (input.document) {
    try {
      snapshot = await buildFilesystemSnapshot({
        additionalMetadata: {
          document_id: input.document.documentId,
          uploaded_by_user_id: input.document.uploadedByUserId,
        },
        indexedAt: input.document.lastIndexedAt ?? null,
        organizationSlug,
        relativePath,
        sourceKind: "document",
        sourceType: input.document.sourceType,
      });
    } catch {
      snapshot = buildDocumentMetadataSnapshot(input.document);
    }
  } else {
    snapshot = await buildFilesystemSnapshot({
      additionalMetadata: input.snapshotSource?.additionalMetadata,
      indexedAt: input.snapshotSource?.indexedAt,
      organizationSlug,
      relativePath,
      sourceKind: input.snapshotSource?.sourceKind ?? "filesystem",
      sourceType: input.snapshotSource?.sourceType,
      sourceVersionToken: input.snapshotSource?.sourceVersionToken,
    });
  }

  const latestVersion = await getLatestReadyAssetVersion({
    assetId: input.asset.id,
    organizationId: input.asset.organizationId,
  });
  const now = Date.now();

  if (
    latestVersion &&
    latestVersion.contentHash === snapshot.contentHash &&
    latestVersion.materializedPath === snapshot.materializedPath &&
    (latestVersion.schemaHash ?? null) === snapshot.schemaHash &&
    (latestVersion.rowCount ?? null) === snapshot.rowCount &&
    (latestVersion.sourceVersionToken ?? null) === snapshot.sourceVersionToken
  ) {
    await db
      .update(dataAssets)
      .set({
        activeVersionId: latestVersion.id,
        updatedAt: now,
      })
      .where(eq(dataAssets.id, input.asset.id));

    if (input.asset.connectionId) {
      await db
        .update(dataConnections)
        .set({
          lastSyncAt: now,
          updatedAt: now,
        })
        .where(eq(dataConnections.id, input.asset.connectionId));
    }

    return latestVersion;
  }

  const versionId = randomUUID();
  await db.insert(dataAssetVersions).values({
    assetId: input.asset.id,
    byteSize: snapshot.byteSize,
    contentHash: snapshot.contentHash,
    createdAt: now,
    id: versionId,
    indexedAt: snapshot.indexedAt,
    ingestionError: null,
    ingestionStatus: "ready",
    materializedPath: snapshot.materializedPath,
    metadataJson: JSON.stringify(snapshot.metadata),
    mimeType: snapshot.mimeType,
    organizationId: input.asset.organizationId,
    rowCount: snapshot.rowCount,
    schemaHash: snapshot.schemaHash,
    sourceModifiedAt: snapshot.sourceModifiedAt,
    sourceVersionToken: snapshot.sourceVersionToken,
    updatedAt: now,
  });

  await db
    .update(dataAssets)
    .set({
      activeVersionId: versionId,
      updatedAt: now,
    })
    .where(eq(dataAssets.id, input.asset.id));

  if (input.asset.connectionId) {
    await db
      .update(dataConnections)
      .set({
        lastSyncAt: now,
        updatedAt: now,
      })
      .where(eq(dataConnections.id, input.asset.connectionId));
  }

  const created = await db.query.dataAssetVersions.findFirst({
    where: eq(dataAssetVersions.id, versionId),
  });

  if (!created) {
    throw new Error(`Failed to create asset version for ${relativePath}`);
  }

  return created;
}

export async function getLatestReadyAssetVersion(input: {
  assetId: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(dataAssetVersions)
    .where(
      and(
        eq(dataAssetVersions.assetId, input.assetId),
        eq(dataAssetVersions.organizationId, input.organizationId),
        eq(dataAssetVersions.ingestionStatus, "ready"),
      ),
    )
    .orderBy(desc(dataAssetVersions.createdAt), desc(dataAssetVersions.updatedAt))
    .limit(1);

  return rows[0] ?? null;
}

export async function ensureFilesystemAssetVersion(input: {
  organizationId: string;
  organizationSlug?: string;
  relativePath: string;
}) {
  const asset = await createOrUpdateFilesystemAsset({
    organizationId: input.organizationId,
    relativePath: input.relativePath,
  });
  const version = await createAssetVersionIfChanged({
    asset,
    organizationSlug: input.organizationSlug,
    relativePath: input.relativePath,
  });

  return {
    asset,
    version,
  };
}
