import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import type { SessionUser } from "@/lib/auth-state";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { ensureDocumentAsset } from "@/lib/data-assets";
import { getAppDatabase } from "@/lib/app-db";
import { dataAssets, dataConnections, documents, documentChunks, users } from "@/lib/app-schema";
import { KNOWLEDGE_MANAGED_SOURCE_TYPES } from "@/lib/knowledge-import-types";
import { countCsvDelimiters, splitCsvRecord } from "@/lib/csv-utils";
import { decodeTextBuffer, normalizeCsvLineEndings } from "@/lib/knowledge-ingestion";
import {
  isKnowledgeAccessScope,
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  type KnowledgeAccessScope,
  type KnowledgeFilePreview,
  type KnowledgeFileRecord,
  type KnowledgeIngestionStatus,
} from "@/lib/knowledge-types";

const execFileAsync = promisify(execFile);

const MAX_UPLOAD_BYTES = KNOWLEDGE_UPLOAD_MAX_BYTES;
const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 200;

const ALLOWED_UPLOAD_TYPES = {
  ".csv": {
    mimeTypes: new Set(["application/csv", "text/csv", "text/plain", "application/vnd.ms-excel"]),
    normalizedMimeType: "text/csv",
  },
  ".md": {
    mimeTypes: new Set(["text/markdown", "text/plain"]),
    normalizedMimeType: "text/markdown",
  },
  ".pdf": {
    mimeTypes: new Set(["application/pdf"]),
    normalizedMimeType: "application/pdf",
  },
  ".txt": {
    mimeTypes: new Set(["text/plain"]),
    normalizedMimeType: "text/plain",
  },
} as const;

type AllowedUploadExtension = keyof typeof ALLOWED_UPLOAD_TYPES;

type KnowledgeFileFilters = {
  scope?: KnowledgeAccessScope;
  status?: KnowledgeIngestionStatus;
};

type UploadKnowledgeFileInput = {
  file: File;
  requestedScope: string;
  user: SessionUser;
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

function normalizeTextContent(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim();
  const ext = path.extname(trimmed).toLowerCase() as AllowedUploadExtension | "";
  const baseName = path.basename(trimmed, ext);
  const sanitizedBaseName = baseName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return {
    displayName: trimmed || "upload",
    ext,
    fileName: `${sanitizedBaseName || "upload"}${ext}`,
  };
}

function getAllowedUploadConfig(extension: string) {
  const normalizedExtension = extension.toLowerCase() as AllowedUploadExtension;

  if (!(normalizedExtension in ALLOWED_UPLOAD_TYPES)) {
    throw new Error("Only .csv, .txt, .md, and .pdf files are supported.");
  }

  return ALLOWED_UPLOAD_TYPES[normalizedExtension];
}

function resolveUploadScope(role: SessionUser["role"], requestedScope: string) {
  if (!canRoleAccessKnowledgeScope(role, "admin")) {
    return "public" as const;
  }

  if (!isKnowledgeAccessScope(requestedScope)) {
    throw new Error("Upload scope must be either public or admin.");
  }

  return requestedScope;
}

function assertMimeMatchesExtension(file: File, normalizedExtension: string) {
  const { mimeTypes } = getAllowedUploadConfig(normalizedExtension);
  const providedMimeType = file.type.trim().toLowerCase();

  if (!providedMimeType) {
    return;
  }

  if (!mimeTypes.has(providedMimeType)) {
    throw new Error(
      `Uploaded file type ${providedMimeType} does not match the ${normalizedExtension} extension.`,
    );
  }
}

function countTokens(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

function buildTextChunks(text: string) {
  const chunks: Array<{
    chunkIndex: number;
    chunkText: string;
    contentSha256: string;
    endOffset: number;
    startOffset: number;
    tokenCount: number;
  }> = [];

  let startOffset = 0;
  let chunkIndex = 0;

  while (startOffset < text.length) {
    const endOffset = Math.min(startOffset + CHUNK_SIZE, text.length);
    const chunkText = text.slice(startOffset, endOffset).trim();

    if (chunkText) {
      chunks.push({
        chunkIndex,
        chunkText,
        contentSha256: createHash("sha256").update(chunkText).digest("hex"),
        endOffset,
        startOffset,
        tokenCount: countTokens(chunkText),
      });
      chunkIndex += 1;
    }

    if (endOffset >= text.length) {
      break;
    }

    startOffset = Math.max(endOffset - CHUNK_OVERLAP, startOffset + 1);
  }

  return chunks;
}

async function extractPdfText(absolutePath: string) {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", "-nopgbrk", absolutePath, "-"],
      {
        maxBuffer: MAX_UPLOAD_BYTES * 4,
      },
    );
    const normalizedText = normalizeTextContent(stdout);

    if (!normalizedText) {
      throw new Error("PDF did not contain extractable text.");
    }

    return normalizedText;
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      throw new Error(caughtError.message || "PDF text extraction failed.");
    }

    throw new Error("PDF text extraction failed.");
  }
}

async function extractTextForUpload(
  absolutePath: string,
  buffer: Buffer,
  extension: AllowedUploadExtension,
) {
  if (extension === ".pdf") {
    return extractPdfText(absolutePath);
  }

  return decodeTextBuffer(buffer);
}

async function writeUploadAtomically(absolutePath: string, buffer: Buffer) {
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(directory, `.upload-${randomUUID()}.tmp`);

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(tempPath, buffer, { flag: "wx" });
    await rename(tempPath, absolutePath);
  } catch (caughtError) {
    await unlink(tempPath).catch(() => undefined);
    throw caughtError;
  }
}

async function findExistingUploadedDocument(input: {
  accessScope: KnowledgeAccessScope;
  displayName: string;
  organizationId: string;
}) {
  const db = await getAppDatabase();

  return db.query.documents.findFirst({
    orderBy: [asc(documents.createdAt), asc(documents.updatedAt)],
    where: and(
      eq(documents.organizationId, input.organizationId),
      eq(documents.accessScope, input.accessScope),
      eq(documents.sourceType, "uploaded"),
      eq(documents.displayName, input.displayName),
    ),
  });
}

async function resolveManagedUploadDestination(input: {
  accessScope: KnowledgeAccessScope;
  companyDataRoot: string;
  organizationId: string;
  originalFileName: string;
}) {
  const { displayName, ext, fileName } = sanitizeFileName(input.originalFileName);

  if (!ext) {
    throw new Error("Uploaded files must include a supported file extension.");
  }

  getAllowedUploadConfig(ext);

  const existingDocument = await findExistingUploadedDocument({
    accessScope: input.accessScope,
    displayName,
    organizationId: input.organizationId,
  });
  const relativePath =
    existingDocument?.sourcePath ?? path.posix.join(input.accessScope, "uploads", "current", fileName);
  const absolutePath = path.join(input.companyDataRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });

  return {
    absolutePath,
    displayName,
    existingDocumentId: existingDocument?.id ?? null,
    extension: ext as AllowedUploadExtension,
    relativePath,
  };
}

function mapKnowledgeFileRow(row: {
  accessScope: KnowledgeAccessScope;
  byteSize: number | null;
  createdAt: number;
  displayName: string;
  id: string;
  ingestionError: string | null;
  ingestionStatus: KnowledgeIngestionStatus;
  lastIndexedAt: number | null;
  mimeType: string | null;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserEmail: string | null;
  uploadedByUserId: string | null;
  uploadedByUserName: string | null;
}) {
  return {
    accessScope: row.accessScope,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    displayName: row.displayName,
    id: row.id,
    ingestionError: row.ingestionError,
    ingestionStatus: row.ingestionStatus,
    lastIndexedAt: row.lastIndexedAt,
    mimeType: row.mimeType,
    sourcePath: row.sourcePath,
    sourceType: row.sourceType,
    updatedAt: row.updatedAt,
    uploadedByUserEmail: row.uploadedByUserEmail,
    uploadedByUserId: row.uploadedByUserId,
    uploadedByUserName: row.uploadedByUserName,
  } satisfies KnowledgeFileRecord;
}

export async function listKnowledgeFiles(
  user: SessionUser,
  filters: KnowledgeFileFilters = {},
) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(documents.organizationId, user.organizationId),
    inArray(documents.sourceType, [...KNOWLEDGE_MANAGED_SOURCE_TYPES]),
  ];

  if (!canRoleAccessKnowledgeScope(user.role, "admin")) {
    whereClauses.push(eq(documents.accessScope, "public"));
  } else if (filters.scope) {
    whereClauses.push(eq(documents.accessScope, filters.scope));
  }

  if (filters.status) {
    whereClauses.push(eq(documents.ingestionStatus, filters.status));
  }

  const rows = await db
    .select({
      accessScope: documents.accessScope,
      byteSize: documents.byteSize,
      createdAt: documents.createdAt,
      displayName: documents.displayName,
      id: documents.id,
      ingestionError: documents.ingestionError,
      ingestionStatus: documents.ingestionStatus,
      lastIndexedAt: documents.lastIndexedAt,
      mimeType: documents.mimeType,
      sourcePath: documents.sourcePath,
      sourceType: documents.sourceType,
      updatedAt: documents.updatedAt,
      uploadedByUserEmail: users.email,
      uploadedByUserId: documents.uploadedByUserId,
      uploadedByUserName: users.name,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedByUserId))
    .where(and(...whereClauses))
    .orderBy(desc(documents.createdAt), desc(documents.updatedAt));

  return rows.map(mapKnowledgeFileRow);
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

function truncatePreviewCell(cell: string) {
  const trimmed = cell.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120).trimEnd()}…` : trimmed;
}

function buildCsvPreview(text: string): Extract<KnowledgeFilePreview, { kind: "csv" }> {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const [headerLine = "", ...dataLines] = lines;
  const delimiter = chooseCsvDelimiter(headerLine);
  const columns = headerLine ? splitCsvRecord(headerLine, delimiter).map(truncatePreviewCell) : [];
  const rows = dataLines.slice(0, 20).map((line) => splitCsvRecord(line, delimiter).map(truncatePreviewCell));

  return {
    columns,
    kind: "csv",
    rows,
    truncated: dataLines.length > 20,
  };
}

function buildTextPreview(text: string): Extract<KnowledgeFilePreview, { kind: "text" }> {
  const lines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    kind: "text",
    lines: lines.slice(0, 20).map((line) => (line.length > 240 ? `${line.slice(0, 240).trimEnd()}…` : line)),
    truncated: lines.length > 20,
  };
}

export async function getKnowledgeFilePreview(input: {
  fileId: string;
  user: SessionUser;
}) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(documents.id, input.fileId),
    eq(documents.organizationId, input.user.organizationId),
    inArray(documents.sourceType, [...KNOWLEDGE_MANAGED_SOURCE_TYPES]),
  ];

  if (!canRoleAccessKnowledgeScope(input.user.role, "admin")) {
    whereClauses.push(eq(documents.accessScope, "public"));
  }

  const row = await db.query.documents.findFirst({
    where: and(...whereClauses),
  });

  if (!row) {
    throw new Error("Knowledge file not found.");
  }

  if (row.ingestionStatus !== "ready") {
    throw new Error("Knowledge file preview is only available for ready files.");
  }

  const lowerPath = row.sourcePath.toLowerCase();
  const lowerMimeType = (row.mimeType ?? "").toLowerCase();

  if (lowerMimeType === "application/pdf") {
    const chunks = await db.query.documentChunks.findMany({
      columns: {
        chunkText: true,
      },
      limit: 3,
      orderBy: [asc(documentChunks.chunkIndex)],
      where: eq(documentChunks.documentId, row.id),
    });

    const text = chunks.map((chunk) => chunk.chunkText.trim()).filter(Boolean).join("\n");

    return text
      ? buildTextPreview(text)
      : {
          kind: "unsupported",
          message: "No preview text is available for this PDF yet.",
        } satisfies KnowledgeFilePreview;
  }

  const companyDataRoot = await resolveCompanyDataRoot(input.user.organizationSlug);
  const absolutePath = path.join(companyDataRoot, row.sourcePath);
  const buffer = await readFile(absolutePath);
  const text = decodeTextBuffer(buffer);

  if (lowerMimeType === "text/csv" || lowerPath.endsWith(".csv") || lowerPath.endsWith(".tsv")) {
    return buildCsvPreview(text);
  }

  if (
    lowerMimeType.startsWith("text/") ||
    lowerMimeType === "application/json" ||
    lowerPath.endsWith(".json") ||
    lowerPath.endsWith(".md") ||
    lowerPath.endsWith(".txt")
  ) {
    return buildTextPreview(text);
  }

  return {
    kind: "unsupported",
    message: "Preview is not available for this file type.",
  } satisfies KnowledgeFilePreview;
}

export async function deleteKnowledgeFile(input: {
  fileId: string;
  user: SessionUser;
}) {
  const db = await getAppDatabase();
  const whereClauses = [
    eq(documents.id, input.fileId),
    eq(documents.organizationId, input.user.organizationId),
    inArray(documents.sourceType, [...KNOWLEDGE_MANAGED_SOURCE_TYPES]),
  ];

  if (!canRoleAccessKnowledgeScope(input.user.role, "admin")) {
    whereClauses.push(eq(documents.accessScope, "public"));
  }

  const document = await db.query.documents.findFirst({
    where: and(...whereClauses),
  });

  if (!document) {
    throw new Error("Knowledge file not found.");
  }

  const companyDataRoot = await resolveCompanyDataRoot(input.user.organizationSlug);
  const absolutePath = path.join(companyDataRoot, document.sourcePath);
  await unlink(absolutePath).catch(() => undefined);

  const asset = await db.query.dataAssets.findFirst({
    where: and(
      eq(dataAssets.organizationId, input.user.organizationId),
      eq(dataAssets.assetKey, document.sourcePath),
    ),
  });
  const now = Date.now();

  await db.delete(documents).where(eq(documents.id, document.id));

  if (asset) {
    await db
      .update(dataAssets)
      .set({
        activeVersionId: null,
        metadataJson: JSON.stringify({
          ...parseJsonRecord(asset.metadataJson),
          deleted_at: now,
          deleted_document_id: document.id,
        }),
        status: "archived",
        updatedAt: now,
      })
      .where(eq(dataAssets.id, asset.id));

    const connection = asset.connectionId
      ? await db.query.dataConnections.findFirst({
          where: eq(dataConnections.id, asset.connectionId),
        })
      : null;

    if (connection?.kind === "google_drive" && asset.externalObjectId) {
      const config = parseJsonRecord(connection.configJson);
      const selectedFiles = Array.isArray(config.selected_files)
        ? config.selected_files.filter((entry) => {
            return !(
              typeof entry === "object" &&
              entry !== null &&
              !Array.isArray(entry) &&
              "file_id" in entry &&
              entry.file_id === asset.externalObjectId
            );
          })
        : [];

      await db
        .update(dataConnections)
        .set({
          configJson: JSON.stringify({
            ...config,
            selected_files: selectedFiles,
          }),
          updatedAt: now,
        })
        .where(eq(dataConnections.id, connection.id));
    }
  }

  return {
    deletedFileId: document.id,
    sourcePath: document.sourcePath,
  };
}

export async function uploadKnowledgeFile(input: UploadKnowledgeFileInput) {
  const { file, user } = input;

  if (!file.name.trim()) {
    throw new Error("Uploaded file must have a name.");
  }

  if (file.size <= 0) {
    throw new Error("Uploaded file must not be empty.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Uploaded file exceeds the 10 MiB size limit.");
  }

  const scope = resolveUploadScope(user.role, input.requestedScope.trim().toLowerCase());

  if (!canRoleAccessKnowledgeScope(user.role, scope)) {
    throw new Error("You do not have access to upload files to that scope.");
  }

  const companyDataRoot = await resolveCompanyDataRoot(user.organizationSlug);
  const uploadDestination = await resolveManagedUploadDestination({
    accessScope: scope,
    companyDataRoot,
    organizationId: user.organizationId,
    originalFileName: file.name,
  });
  const { normalizedMimeType } = getAllowedUploadConfig(uploadDestination.extension);

  assertMimeMatchesExtension(file, uploadDestination.extension);

  let fileBuffer = Buffer.from(await file.arrayBuffer());

  if (uploadDestination.extension === ".csv") {
    fileBuffer = normalizeCsvLineEndings(fileBuffer);
  }

  const fileContentSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const now = Date.now();
  const db = await getAppDatabase();
  const documentId = uploadDestination.existingDocumentId ?? randomUUID();

  await writeUploadAtomically(uploadDestination.absolutePath, fileBuffer);

  if (uploadDestination.existingDocumentId) {
    await db
      .update(documents)
      .set({
        accessScope: scope,
        byteSize: file.size,
        contentSha256: fileContentSha256,
        displayName: uploadDestination.displayName,
        ingestionError: null,
        ingestionStatus: "pending",
        lastIndexedAt: null,
        mimeType: normalizedMimeType,
        sourcePath: uploadDestination.relativePath,
        sourceType: "uploaded",
        updatedAt: now,
        uploadedByUserId: user.id,
      })
      .where(eq(documents.id, documentId));
  } else {
    await db.insert(documents).values({
      accessScope: scope,
      byteSize: file.size,
      contentSha256: fileContentSha256,
      createdAt: now,
      displayName: uploadDestination.displayName,
      id: documentId,
      ingestionError: null,
      ingestionStatus: "pending",
      lastIndexedAt: null,
      mimeType: normalizedMimeType,
      organizationId: user.organizationId,
      sourcePath: uploadDestination.relativePath,
      sourceType: "uploaded",
      updatedAt: now,
      uploadedByUserId: user.id,
    });
  }

  try {
    const extractedText = await extractTextForUpload(
      uploadDestination.absolutePath,
      fileBuffer,
      uploadDestination.extension,
    );
    const chunks = buildTextChunks(extractedText);

    if (chunks.length === 0) {
      throw new Error("Uploaded file did not contain enough text to index.");
    }

    const indexedAt = Date.now();

    await db.transaction((transaction) => {
      transaction.delete(documentChunks).where(eq(documentChunks.documentId, documentId)).run();

      transaction.insert(documentChunks).values(
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
      ).run();

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

    await ensureDocumentAsset({
      document: {
        accessScope: scope,
        byteSize: fileBuffer.length,
        contentSha256: fileContentSha256,
        displayName: uploadDestination.displayName,
        documentId,
        lastIndexedAt: indexedAt,
        mimeType: normalizedMimeType,
        organizationId: user.organizationId,
        sourcePath: uploadDestination.relativePath,
        sourceType: "uploaded",
        updatedAt: indexedAt,
        uploadedByUserId: user.id,
      },
    });
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : "Knowledge ingestion failed.";

    await db
      .update(documents)
      .set({
        ingestionError: message,
        ingestionStatus: "failed",
        updatedAt: Date.now(),
      })
      .where(eq(documents.id, documentId));
  }

  const uploadedFile = await db
    .select({
      accessScope: documents.accessScope,
      byteSize: documents.byteSize,
      createdAt: documents.createdAt,
      displayName: documents.displayName,
      id: documents.id,
      ingestionError: documents.ingestionError,
      ingestionStatus: documents.ingestionStatus,
      lastIndexedAt: documents.lastIndexedAt,
      mimeType: documents.mimeType,
      sourcePath: documents.sourcePath,
      sourceType: documents.sourceType,
      updatedAt: documents.updatedAt,
      uploadedByUserEmail: users.email,
      uploadedByUserId: documents.uploadedByUserId,
      uploadedByUserName: users.name,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedByUserId))
    .where(eq(documents.id, documentId))
    .limit(1);

  const row = uploadedFile[0];

  if (!row) {
    throw new Error("Uploaded file metadata was not found after ingestion.");
  }

  return mapKnowledgeFileRow(row);
}

export function parseKnowledgeScopeFilter(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return isKnowledgeAccessScope(value) ? value : null;
}

export function parseKnowledgeStatusFilter(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return value === "pending" || value === "ready" || value === "failed" ? value : null;
}

export function getKnowledgeUploadLimitBytes() {
  return MAX_UPLOAD_BYTES;
}

export function getKnowledgeUploadAcceptString() {
  return KNOWLEDGE_UPLOAD_ACCEPT;
}
