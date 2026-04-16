import "server-only";

type ZipEntryInput = {
  content: Buffer | string;
  fileName: string;
};

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 1 << 11;
const STORE_COMPRESSION_METHOD = 0;
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let iteration = 0; iteration < 8; iteration += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function normalizeZipFileName(fileName: string) {
  const normalized = fileName.trim().replaceAll("\\", "/");

  if (!normalized || normalized.startsWith("/") || normalized.includes("../")) {
    throw new Error(`Invalid ZIP entry path: ${fileName}`);
  }

  return normalized;
}

function toBuffer(content: Buffer | string) {
  return typeof content === "string" ? Buffer.from(content, "utf8") : content;
}

function computeCrc32(buffer: Buffer) {
  let value = 0xffffffff;

  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

export function createZipArchive(entries: ZipEntryInput[]) {
  const localFileParts: Buffer[] = [];
  const centralDirectoryParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = normalizeZipFileName(entry.fileName);
    const content = toBuffer(entry.content);
    const fileNameBuffer = Buffer.from(fileName, "utf8");
    const crc32 = computeCrc32(content);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORE_COMPRESSION_METHOD, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(fileNameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localFileParts.push(localHeader, fileNameBuffer, content);

    const centralDirectoryHeader = Buffer.alloc(46);
    centralDirectoryHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
    centralDirectoryHeader.writeUInt16LE(20, 4);
    centralDirectoryHeader.writeUInt16LE(20, 6);
    centralDirectoryHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralDirectoryHeader.writeUInt16LE(STORE_COMPRESSION_METHOD, 10);
    centralDirectoryHeader.writeUInt16LE(0, 12);
    centralDirectoryHeader.writeUInt16LE(0, 14);
    centralDirectoryHeader.writeUInt32LE(crc32, 16);
    centralDirectoryHeader.writeUInt32LE(content.length, 20);
    centralDirectoryHeader.writeUInt32LE(content.length, 24);
    centralDirectoryHeader.writeUInt16LE(fileNameBuffer.length, 28);
    centralDirectoryHeader.writeUInt16LE(0, 30);
    centralDirectoryHeader.writeUInt16LE(0, 32);
    centralDirectoryHeader.writeUInt16LE(0, 34);
    centralDirectoryHeader.writeUInt16LE(0, 36);
    centralDirectoryHeader.writeUInt32LE(0, 38);
    centralDirectoryHeader.writeUInt32LE(offset, 42);

    centralDirectoryParts.push(centralDirectoryHeader, fileNameBuffer);
    offset += localHeader.length + fileNameBuffer.length + content.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectoryParts);
  const eocd = Buffer.alloc(22);

  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectoryBuffer.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localFileParts, centralDirectoryBuffer, eocd]);
}
