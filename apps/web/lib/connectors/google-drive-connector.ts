import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  dataAssets,
  dataConnections,
  documents,
  documentChunks,
  organizations,
} from "@/lib/app-schema";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import {
  createAssetVersionIfChanged,
  getLatestReadyAssetVersion,
  inferDataKindFromPath,
  upsertPathAsset,
} from "@/lib/data-assets";
import { ensureDataConnection } from "@/lib/data-connections";
import {
  buildTextChunks,
  decodeTextBuffer,
  extractPdfText,
  normalizeCsvLineEndings,
} from "@/lib/knowledge-ingestion";
import { KNOWLEDGE_UPLOAD_MAX_BYTES } from "@/lib/knowledge-types";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";

export type GoogleDriveSelectedFileConfig = {
  access_scope?: "admin" | "public";
  export_mime_type?: string | null;
  file_id: string;
  source_url?: string | null;
};

export type GoogleDriveConnectionConfig = {
  auth_mode?: "oauth" | "service_account" | "testing_stub";
  default_access_scope?: "admin" | "public";
  selected_files: GoogleDriveSelectedFileConfig[];
};

export type GoogleDriveRemoteFile = {
  exportMimeType?: string | null;
  fileId: string;
  md5Checksum?: string | null;
  mimeType: string;
  modifiedTime?: string | null;
  name: string;
  sourceUrl?: string | null;
  version?: string | null;
};

export type GoogleDriveDownloadedFile = {
  buffer: Buffer;
  fileExtension?: string | null;
  materializedMimeType?: string | null;
};

export type GoogleDriveSyncClient = {
  downloadFile: (input: {
    connection: typeof dataConnections.$inferSelect;
    connectionConfig: GoogleDriveConnectionConfig;
    file: GoogleDriveRemoteFile;
  }) => Promise<GoogleDriveDownloadedFile>;
  listSelectedFiles: (input: {
    connection: typeof dataConnections.$inferSelect;
    connectionConfig: GoogleDriveConnectionConfig;
  }) => Promise<GoogleDriveRemoteFile[]>;
};

export type GoogleDriveSyncResult = {
  completedAt: number;
  connectionId: string;
  createdAssetCount: number;
  existingAssetCount: number;
  organizationId: string;
  organizationSlug: string;
  scannedFileCount: number;
  startedAt: number;
  unchangedFileCount: number;
  versionCreatedCount: number;
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

function parseGoogleDriveConnectionConfig(value: string | null | undefined) {
  const root = parseJsonRecord(value);
  const selectedFiles: GoogleDriveSelectedFileConfig[] = [];

  if (Array.isArray(root.selected_files)) {
    for (const entry of root.selected_files) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }

      const fileId = typeof entry.file_id === "string" ? entry.file_id.trim() : "";

      if (!fileId) {
        continue;
      }

      selectedFiles.push({
        access_scope:
          entry.access_scope === "public" || entry.access_scope === "admin"
            ? entry.access_scope
            : undefined,
        export_mime_type:
          typeof entry.export_mime_type === "string" ? entry.export_mime_type : null,
        file_id: fileId,
        source_url: typeof entry.source_url === "string" ? entry.source_url : null,
      });
    }
  }

  return {
    auth_mode:
      root.auth_mode === "oauth" ||
      root.auth_mode === "service_account" ||
      root.auth_mode === "testing_stub"
        ? root.auth_mode
        : "oauth",
    default_access_scope:
      root.default_access_scope === "public" || root.default_access_scope === "admin"
        ? root.default_access_scope
        : "admin",
    selected_files: selectedFiles,
  } satisfies GoogleDriveConnectionConfig;
}

function sanitizePathComponent(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
}

function inferExtensionFromMimeType(mimeType: string | null | undefined) {
  switch ((mimeType ?? "").toLowerCase()) {
    case "text/csv":
      return ".csv";
    case "text/markdown":
      return ".md";
    case "application/pdf":
      return ".pdf";
    case "text/plain":
      return ".txt";
    case "application/json":
      return ".json";
    default:
      return null;
  }
}

function resolveMaterializedExtension(input: {
  downloadedExtension?: string | null;
  downloadedMimeType?: string | null;
  remoteMimeType: string;
  remoteName: string;
}) {
  if (input.downloadedExtension) {
    return input.downloadedExtension.startsWith(".")
      ? input.downloadedExtension.toLowerCase()
      : `.${input.downloadedExtension.toLowerCase()}`;
  }

  const fromMimeType = inferExtensionFromMimeType(input.downloadedMimeType ?? input.remoteMimeType);

  if (fromMimeType) {
    return fromMimeType;
  }

  const parsedExtension = path.posix.extname(input.remoteName).toLowerCase();
  return parsedExtension || ".txt";
}

function normalizeDownloadedBuffer(input: {
  buffer: Buffer;
  extension: string;
}) {
  return input.extension === ".csv" ? normalizeCsvLineEndings(input.buffer) : input.buffer;
}

function buildGoogleDriveSourceVersionToken(file: GoogleDriveRemoteFile) {
  if (file.version?.trim()) {
    return `revision:${file.version.trim()}`;
  }

  if (file.md5Checksum?.trim()) {
    return `checksum:${file.md5Checksum.trim()}`;
  }

  if (file.modifiedTime?.trim()) {
    const parsedModifiedTime = Date.parse(file.modifiedTime);

    if (Number.isFinite(parsedModifiedTime)) {
      return `modified:${Math.trunc(parsedModifiedTime)}`;
    }
  }

  return null;
}

function buildGoogleDriveSourcePath(input: {
  accessScope: "admin" | "public";
  connectionId: string;
  extension: string;
  fileId: string;
}) {
  return path.posix.join(
    input.accessScope,
    "connectors",
    "google-drive",
    input.connectionId,
    `${sanitizePathComponent(input.fileId)}${input.extension}`,
  );
}

async function writeBufferAtomically(absolutePath: string, buffer: Buffer) {
  const directory = path.dirname(absolutePath);
  const temporaryPath = path.join(directory, `.google-drive-${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, buffer, { flag: "wx" });
    await rename(temporaryPath, absolutePath);
  } catch (caughtError) {
    await unlink(temporaryPath).catch(() => undefined);
    throw caughtError;
  }
}

async function resolveOrganizationSlug(input: {
  organizationId: string;
  organizationSlug?: string;
}) {
  if (input.organizationSlug) {
    return input.organizationSlug;
  }

  const db = await getAppDatabase();
  const organization = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
  });

  if (!organization) {
    throw new Error(`Organization not found: ${input.organizationId}`);
  }

  return organization.slug;
}

async function upsertDocumentRecord(input: {
  accessScope: "admin" | "public";
  byteSize: number;
  contentSha256: string;
  displayName: string;
  mimeType: string | null;
  organizationId: string;
  sourcePath: string;
}) {
  const db = await getAppDatabase();
  const now = Date.now();
  const existing = await db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, input.organizationId),
      eq(documents.sourcePath, input.sourcePath),
    ),
  });

  if (existing) {
    await db
      .update(documents)
      .set({
        accessScope: input.accessScope,
        byteSize: input.byteSize,
        contentSha256: input.contentSha256,
        displayName: input.displayName,
        ingestionError: null,
        ingestionStatus: "ready",
        mimeType: input.mimeType,
        sourceType: "google_drive",
        updatedAt: now,
        uploadedByUserId: null,
      })
      .where(eq(documents.id, existing.id));

    return existing.id;
  }

  const documentId = randomUUID();
  await db.insert(documents).values({
    accessScope: input.accessScope,
    byteSize: input.byteSize,
    contentSha256: input.contentSha256,
    createdAt: now,
    displayName: input.displayName,
    id: documentId,
    ingestionError: null,
    ingestionStatus: "ready",
    lastIndexedAt: null,
    mimeType: input.mimeType,
    organizationId: input.organizationId,
    sourcePath: input.sourcePath,
    sourceType: "google_drive",
    updatedAt: now,
    uploadedByUserId: null,
  });

  return documentId;
}

async function replaceDocumentChunks(documentId: string, extractedText: string) {
  const db = await getAppDatabase();
  const chunks = buildTextChunks(extractedText);

  if (chunks.length === 0) {
    throw new Error("Google Drive file did not contain enough text to index.");
  }

  const indexedAt = Date.now();

  await db.transaction((transaction) => {
    transaction.delete(documentChunks).where(eq(documentChunks.documentId, documentId)).run();

    transaction
      .insert(documentChunks)
      .values(
        chunks.map((chunk) => ({
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          contentSha256: chunk.contentSha256,
          createdAt: indexedAt,
          documentId,
          endOffset: chunk.endOffset,
          id: randomUUID(),
          startOffset: chunk.startOffset,
          tokenCount: chunk.tokenCount,
        })),
      )
      .run();

    transaction
      .update(documents)
      .set({
        ingestionError: null,
        ingestionStatus: "ready",
        lastIndexedAt: indexedAt,
        updatedAt: indexedAt,
      })
      .where(eq(documents.id, documentId))
      .run();
  });

  return indexedAt;
}

async function extractTextForFile(input: {
  absolutePath: string;
  buffer: Buffer;
  extension: string;
}) {
  if (input.extension === ".pdf") {
    return extractPdfText(input.absolutePath, KNOWLEDGE_UPLOAD_MAX_BYTES);
  }

  return decodeTextBuffer(input.buffer);
}

function pickAccessScope(input: {
  connectionConfig: GoogleDriveConnectionConfig;
  selectedFileConfig: GoogleDriveSelectedFileConfig | null;
}) {
  return input.selectedFileConfig?.access_scope ?? input.connectionConfig.default_access_scope ?? "admin";
}

async function loadConnection(connectionId: string) {
  const db = await getAppDatabase();
  const connection = await db.query.dataConnections.findFirst({
    where: eq(dataConnections.id, connectionId),
  });

  if (!connection) {
    throw new Error(`Google Drive connection not found: ${connectionId}`);
  }

  if (connection.kind !== "google_drive") {
    throw new Error(`Connection ${connectionId} is not a Google Drive connection.`);
  }

  return connection;
}

export async function ensureGoogleDriveConnection(input: {
  config: GoogleDriveConnectionConfig;
  credentialsRef?: string | null;
  displayName?: string;
  organizationId: string;
}) {
  return ensureDataConnection({
    configJson: {
      auth_mode: input.config.auth_mode ?? "oauth",
      default_access_scope: input.config.default_access_scope ?? "admin",
      provider: "google_drive",
      selected_files: input.config.selected_files,
    },
    credentialsRef: input.credentialsRef ?? null,
    displayName: input.displayName ?? "Google Drive",
    kind: "google_drive",
    organizationId: input.organizationId,
  });
}

export async function syncGoogleDriveDataConnection(input: {
  client: GoogleDriveSyncClient;
  connectionId: string;
  organizationSlug?: string;
}) {
  const startedAt = Date.now();
  const connection = await loadConnection(input.connectionId);
  const organizationSlug = await resolveOrganizationSlug({
    organizationId: connection.organizationId,
    organizationSlug: input.organizationSlug,
  });
  const connectionConfig = parseGoogleDriveConnectionConfig(connection.configJson);
  const listedFiles = await input.client.listSelectedFiles({
    connection,
    connectionConfig,
  });
  const companyDataRoot = await resolveCompanyDataRoot(organizationSlug);

  let createdAssetCount = 0;
  let existingAssetCount = 0;
  let unchangedFileCount = 0;
  let versionCreatedCount = 0;

  try {
    for (const remoteFile of listedFiles) {
      const selectedFileConfig =
        connectionConfig.selected_files.find((entry) => entry.file_id === remoteFile.fileId) ?? null;
      const accessScope = pickAccessScope({
        connectionConfig,
        selectedFileConfig,
      });
      const detectionToken = buildGoogleDriveSourceVersionToken(remoteFile);
      const existingAsset = await getAppDatabase().then((db) =>
        db.query.dataAssets.findFirst({
          where: and(
            eq(dataAssets.organizationId, connection.organizationId),
            eq(dataAssets.connectionId, connection.id),
            eq(dataAssets.externalObjectId, remoteFile.fileId),
          ),
        }),
      );

      if (existingAsset) {
        existingAssetCount += 1;
      }

      const latestVersion = existingAsset
        ? await getLatestReadyAssetVersion({
            assetId: existingAsset.id,
            organizationId: connection.organizationId,
          })
        : null;

      const selectedExportMimeType =
        selectedFileConfig?.export_mime_type ?? remoteFile.exportMimeType ?? null;

      if (existingAsset && detectionToken && latestVersion?.sourceVersionToken === detectionToken) {
        const existingMaterializedPath = latestVersion?.materializedPath ?? existingAsset.assetKey;
        await upsertPathAsset({
          accessScope,
          connectionId: connection.id,
          dataKind: inferDataKindFromPath(
            existingMaterializedPath,
            selectedExportMimeType ?? remoteFile.mimeType,
          ),
          displayName: remoteFile.name,
          externalObjectId: remoteFile.fileId,
          metadata: {
            google_drive: {
              export_mime_type: selectedExportMimeType,
              file_id: remoteFile.fileId,
              md5_checksum: remoteFile.md5Checksum ?? null,
              mime_type: remoteFile.mimeType,
              modified_time: remoteFile.modifiedTime ?? null,
              source_url: selectedFileConfig?.source_url ?? remoteFile.sourceUrl ?? null,
              version: remoteFile.version ?? null,
            },
            relative_path: existingMaterializedPath,
            source_kind: "connector",
            source_type: "google_drive",
          },
          organizationId: connection.organizationId,
          relativePath: existingMaterializedPath,
        });
        unchangedFileCount += 1;
        continue;
      }

      const downloadedFile = await input.client.downloadFile({
        connection,
        connectionConfig,
        file: remoteFile,
      });
      const extension = resolveMaterializedExtension({
        downloadedExtension: downloadedFile.fileExtension,
        downloadedMimeType: downloadedFile.materializedMimeType,
        remoteMimeType: selectedExportMimeType ?? remoteFile.mimeType,
        remoteName: remoteFile.name,
      });
      const normalizedBuffer = normalizeDownloadedBuffer({
        buffer: downloadedFile.buffer,
        extension,
      });

      if (normalizedBuffer.length <= 0) {
        throw new Error(`Google Drive file ${remoteFile.fileId} is empty.`);
      }

      if (normalizedBuffer.length > KNOWLEDGE_UPLOAD_MAX_BYTES) {
        throw new Error(`Google Drive file ${remoteFile.fileId} exceeds the 10 MiB size limit.`);
      }

      const materializedPath = buildGoogleDriveSourcePath({
        accessScope,
        connectionId: connection.id,
        extension,
        fileId: remoteFile.fileId,
      });
      const absolutePath = path.join(companyDataRoot, materializedPath);
      await writeBufferAtomically(absolutePath, normalizedBuffer);

      const contentSha256 = createHash("sha256").update(normalizedBuffer).digest("hex");
      const documentId = await upsertDocumentRecord({
        accessScope,
        byteSize: normalizedBuffer.length,
        contentSha256,
        displayName: remoteFile.name,
        mimeType: downloadedFile.materializedMimeType ?? selectedExportMimeType ?? remoteFile.mimeType,
        organizationId: connection.organizationId,
        sourcePath: materializedPath,
      });
      const indexedAt = await replaceDocumentChunks(
        documentId,
        await extractTextForFile({
          absolutePath,
          buffer: normalizedBuffer,
          extension,
        }),
      );
      const asset = await upsertPathAsset({
        accessScope,
        connectionId: connection.id,
        dataKind: inferDataKindFromPath(
          materializedPath,
          downloadedFile.materializedMimeType ?? selectedExportMimeType ?? remoteFile.mimeType,
        ),
        displayName: remoteFile.name,
        externalObjectId: remoteFile.fileId,
        metadata: {
          document_id: documentId,
          google_drive: {
            export_mime_type: selectedExportMimeType,
            file_id: remoteFile.fileId,
            md5_checksum: remoteFile.md5Checksum ?? null,
            mime_type: remoteFile.mimeType,
            modified_time: remoteFile.modifiedTime ?? null,
            source_url: selectedFileConfig?.source_url ?? remoteFile.sourceUrl ?? null,
            version: remoteFile.version ?? null,
          },
          relative_path: materializedPath,
          source_kind: "connector",
          source_type: "google_drive",
        },
        organizationId: connection.organizationId,
        relativePath: materializedPath,
      });
      const version = await createAssetVersionIfChanged({
        asset,
        organizationSlug,
        relativePath: materializedPath,
        snapshotSource: {
          additionalMetadata: {
            document_id: documentId,
            google_drive: {
              export_mime_type: selectedExportMimeType,
              file_id: remoteFile.fileId,
              md5_checksum: remoteFile.md5Checksum ?? null,
              mime_type: remoteFile.mimeType,
              modified_time: remoteFile.modifiedTime ?? null,
              source_url: selectedFileConfig?.source_url ?? remoteFile.sourceUrl ?? null,
              version: remoteFile.version ?? null,
            },
          },
          indexedAt,
          sourceKind: "connector",
          sourceType: "google_drive",
          sourceVersionToken: detectionToken ?? contentSha256,
        },
      });

      if (!existingAsset) {
        createdAssetCount += 1;
      }

      if (latestVersion?.id === version.id) {
        unchangedFileCount += 1;
      } else {
        versionCreatedCount += 1;
      }
    }

    const completedAt = Date.now();
    const db = await getAppDatabase();
    await db
      .update(dataConnections)
      .set({
        lastSyncAt: completedAt,
        status: "active",
        updatedAt: completedAt,
      })
      .where(eq(dataConnections.id, connection.id));

    const result: GoogleDriveSyncResult = {
      completedAt,
      connectionId: connection.id,
      createdAssetCount,
      existingAssetCount,
      organizationId: connection.organizationId,
      organizationSlug,
      scannedFileCount: listedFiles.length,
      startedAt,
      unchangedFileCount,
      versionCreatedCount,
    };

    logStructuredEvent("data_connection.google_drive_sync_completed", {
      completed_at: completedAt,
      connection_id: result.connectionId,
      created_asset_count: result.createdAssetCount,
      existing_asset_count: result.existingAssetCount,
      organizationId: result.organizationId,
      organizationSlug: result.organizationSlug,
      routeGroup: "data_connection",
      routeKey: "data_connection.google_drive.sync",
      scanned_file_count: result.scannedFileCount,
      started_at: result.startedAt,
      unchanged_file_count: result.unchangedFileCount,
      version_created_count: result.versionCreatedCount,
    });

    return result;
  } catch (caughtError) {
    const failedAt = Date.now();
    const db = await getAppDatabase();
    await db
      .update(dataConnections)
      .set({
        status: "error",
        updatedAt: failedAt,
      })
      .where(eq(dataConnections.id, connection.id));

    logStructuredError("data_connection.google_drive_sync_failed", caughtError, {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      organizationSlug,
      routeGroup: "data_connection",
      routeKey: "data_connection.google_drive.sync",
    });

    throw caughtError;
  }
}
