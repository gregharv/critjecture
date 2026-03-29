import "server-only";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { TextDecoder } from "node:util";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 200;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

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

export function decodeUtf8Text(buffer: Buffer) {
  try {
    return normalizeTextContent(TEXT_DECODER.decode(buffer));
  } catch {
    throw new Error("Text uploads must be valid UTF-8.");
  }
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
