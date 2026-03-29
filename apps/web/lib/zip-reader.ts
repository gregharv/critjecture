import "server-only";

import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  compressedSize: number;
  compressionMethod: number;
  crc32: number;
  externalFileAttributes: number;
  fileName: string;
  generalPurposeBitFlag: number;
  localHeaderOffset: number;
  uncompressedSize: number;
  versionMadeBy: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_COMMENT_LENGTH = 0xffff;

function readUInt16LE(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readUInt32LE(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumLength = 22;

  if (buffer.length < minimumLength) {
    throw new Error("ZIP archive is truncated.");
  }

  const startOffset = Math.max(0, buffer.length - minimumLength - MAX_EOCD_COMMENT_LENGTH);

  for (let offset = buffer.length - minimumLength; offset >= startOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("ZIP end-of-central-directory record was not found.");
}

function decodeFileName(rawName: Buffer, utf8Flag: boolean) {
  return rawName.toString(utf8Flag ? "utf8" : "binary");
}

function assertZipNotZip64(fieldValue: number, fieldName: string) {
  if (fieldValue === 0xffff || fieldValue === 0xffffffff) {
    throw new Error(`ZIP64 archives are not supported for ${fieldName}.`);
  }
}

function isUnixSymlink(entry: ZipEntry) {
  const platform = (entry.versionMadeBy >> 8) & 0xff;

  if (platform !== 3) {
    return false;
  }

  const mode = (entry.externalFileAttributes >> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

export function listZipEntries(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = readUInt16LE(buffer, eocdOffset + 10);
  const centralDirectorySize = readUInt32LE(buffer, eocdOffset + 12);
  const centralDirectoryOffset = readUInt32LE(buffer, eocdOffset + 16);

  assertZipNotZip64(totalEntries, "entry count");
  assertZipNotZip64(centralDirectorySize, "central directory size");
  assertZipNotZip64(centralDirectoryOffset, "central directory offset");

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length) {
      throw new Error("ZIP central directory is truncated.");
    }

    if (readUInt32LE(buffer, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("ZIP central directory entry signature is invalid.");
    }

    const versionMadeBy = readUInt16LE(buffer, offset + 4);
    const generalPurposeBitFlag = readUInt16LE(buffer, offset + 8);
    const compressionMethod = readUInt16LE(buffer, offset + 10);
    const crc32 = readUInt32LE(buffer, offset + 16);
    const compressedSize = readUInt32LE(buffer, offset + 20);
    const uncompressedSize = readUInt32LE(buffer, offset + 24);
    const fileNameLength = readUInt16LE(buffer, offset + 28);
    const extraFieldLength = readUInt16LE(buffer, offset + 30);
    const fileCommentLength = readUInt16LE(buffer, offset + 32);
    const externalFileAttributes = readUInt32LE(buffer, offset + 38);
    const localHeaderOffset = readUInt32LE(buffer, offset + 42);

    assertZipNotZip64(compressedSize, "compressed size");
    assertZipNotZip64(uncompressedSize, "uncompressed size");
    assertZipNotZip64(localHeaderOffset, "local header offset");

    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > buffer.length) {
      throw new Error("ZIP file name extends past archive bounds.");
    }

    const fileName = decodeFileName(
      buffer.subarray(fileNameStart, fileNameEnd),
      (generalPurposeBitFlag & (1 << 11)) !== 0,
    );

    entries.push({
      compressedSize,
      compressionMethod,
      crc32,
      externalFileAttributes,
      fileName,
      generalPurposeBitFlag,
      localHeaderOffset,
      uncompressedSize,
      versionMadeBy,
    });

    offset = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

export function extractZipEntry(buffer: Buffer, requestedFileName: string) {
  const entry = listZipEntries(buffer).find((candidate) => candidate.fileName === requestedFileName);

  if (!entry) {
    throw new Error(`ZIP archive entry not found: ${requestedFileName}`);
  }

  if (isUnixSymlink(entry)) {
    throw new Error(`ZIP archive entry is a symlink: ${requestedFileName}`);
  }

  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`Encrypted ZIP archive entry is not supported: ${requestedFileName}`);
  }

  const localHeaderOffset = entry.localHeaderOffset;

  if (localHeaderOffset + 30 > buffer.length) {
    throw new Error(`ZIP local header is truncated for entry: ${requestedFileName}`);
  }

  if (readUInt32LE(buffer, localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`ZIP local header signature is invalid for entry: ${requestedFileName}`);
  }

  const localFileNameLength = readUInt16LE(buffer, localHeaderOffset + 26);
  const localExtraFieldLength = readUInt16LE(buffer, localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;

  if (dataEnd > buffer.length) {
    throw new Error(`ZIP entry data is truncated for entry: ${requestedFileName}`);
  }

  const compressedData = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return Buffer.from(compressedData);
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressedData);
  }

  throw new Error(
    `ZIP entry compression method ${entry.compressionMethod} is not supported for ${requestedFileName}`,
  );
}
