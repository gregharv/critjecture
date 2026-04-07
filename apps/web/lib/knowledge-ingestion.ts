import "server-only";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { TextDecoder } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 200;
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const FALLBACK_TEXT_DECODERS = [
  new TextDecoder("windows-1252"),
  new TextDecoder("iso-8859-1"),
] as const;

export type TextChunkRecord = {
  chunkIndex: number;
  chunkText: string;
  contentSha256: string;
  endOffset: number;
  startOffset: number;
  tokenCount: number;
};

function normalizeTextContent(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function countTokens(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

export function buildTextChunks(text: string) {
  const chunks: TextChunkRecord[] = [];
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

export function decodeTextBuffer(buffer: Buffer) {
  try {
    return normalizeTextContent(UTF8_TEXT_DECODER.decode(buffer));
  } catch {
    for (const decoder of FALLBACK_TEXT_DECODERS) {
      try {
        return normalizeTextContent(decoder.decode(buffer));
      } catch {
        continue;
      }
    }

    throw new Error("Text uploads must be valid UTF-8 or Windows-1252.");
  }
}

export function decodeUtf8Text(buffer: Buffer) {
  return decodeTextBuffer(buffer);
}

export function normalizeCsvLineEndings<T extends ArrayBufferLike>(buffer: Buffer<T>) {
  const hasCarriageReturn = buffer.includes(0x0d);
  const hasLineFeed = buffer.includes(0x0a);

  if (!hasCarriageReturn || hasLineFeed) {
    return buffer;
  }

  const normalized = Buffer.from(buffer) as Buffer<T>;

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === 0x0d) {
      normalized[index] = 0x0a;
    }
  }

  return normalized;
}

export async function extractPdfText(absolutePath: string, maxBytes: number) {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", "-nopgbrk", absolutePath, "-"],
      {
        maxBuffer: maxBytes * 4,
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
