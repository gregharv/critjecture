import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import type { SessionUser } from "@/lib/auth-state";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import { getAppDatabase } from "@/lib/app-db";
import { documents, documentChunks, users } from "@/lib/app-schema";
import { KNOWLEDGE_MANAGED_SOURCE_TYPES } from "@/lib/knowledge-import-types";
import { decodeTextBuffer, normalizeCsvLineEndings } from "@/lib/knowledge-ingestion";
import {
  isKnowledgeAccessScope,
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  type KnowledgeAccessScope,
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

function pathExists(targetPath: string) {
  return access(targetPath).then(
    () => true,
    () => false,
  );
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

async function resolveUniqueUploadDestination(
  companyDataRoot: string,
  scope: KnowledgeAccessScope,
  originalFileName: string,
) {
  const { ext, fileName } = sanitizeFileName(originalFileName);

  if (!ext) {
    throw new Error("Uploaded files must include a supported file extension.");
  }

  getAllowedUploadConfig(ext);

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const relativeDirectory = path.posix.join(scope, "uploads", year, month);
  const absoluteDirectory = path.join(companyDataRoot, relativeDirectory);
  const parsedName = path.parse(fileName);

  await mkdir(absoluteDirectory, { recursive: true });

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const candidateName =
      attempt === 0
        ? fileName
        : `${parsedName.name}--${attempt}${parsedName.ext}`;
    const relativePath = path.posix.join(relativeDirectory, candidateName);
    const absolutePath = path.join(companyDataRoot, relativePath);

    if (!(await pathExists(absolutePath))) {
      return {
        absolutePath,
        extension: ext as AllowedUploadExtension,
        relativePath,
      };
    }
  }

  throw new Error("Unable to allocate a unique upload path for this file.");
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
  const uploadDestination = await resolveUniqueUploadDestination(
    companyDataRoot,
    scope,
    file.name,
  );
  const { normalizedMimeType } = getAllowedUploadConfig(uploadDestination.extension);

  assertMimeMatchesExtension(file, uploadDestination.extension);

  let fileBuffer = Buffer.from(await file.arrayBuffer());

  if (uploadDestination.extension === ".csv") {
    fileBuffer = normalizeCsvLineEndings(fileBuffer);
  }

  const fileContentSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const now = Date.now();
  const db = await getAppDatabase();
  const documentId = randomUUID();

  await writeUploadAtomically(uploadDestination.absolutePath, fileBuffer);

  await db.insert(documents).values({
    accessScope: scope,
    byteSize: file.size,
    contentSha256: fileContentSha256,
    createdAt: now,
    displayName: sanitizeFileName(file.name).displayName,
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
