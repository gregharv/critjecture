import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let ripgrepAvailabilityPromise: Promise<boolean> | null = null;
let pdftotextAvailabilityPromise: Promise<boolean> | null = null;

async function isCommandAvailable(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, {
      maxBuffer: 64 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export async function isRipgrepAvailable() {
  if (!ripgrepAvailabilityPromise) {
    ripgrepAvailabilityPromise = isCommandAvailable("rg", ["--version"]);
  }

  return ripgrepAvailabilityPromise;
}

export async function isPdfTextExtractionAvailable() {
  if (!pdftotextAvailabilityPromise) {
    pdftotextAvailabilityPromise = isCommandAvailable("pdftotext", ["-v"]);
  }

  return pdftotextAvailabilityPromise;
}

export async function getKnowledgeSearchToolchainHealth() {
  const ripgrepAvailable = await isRipgrepAvailable();

  return {
    available: true,
    backend: ripgrepAvailable ? ("ripgrep" as const) : ("node_fallback" as const),
    detail: ripgrepAvailable
      ? "Knowledge search is using ripgrep for file scans."
      : "Knowledge search is using the Node fallback scanner because ripgrep is unavailable.",
    ripgrepAvailable,
  };
}

export async function getPdfIngestionToolchainHealth() {
  const available = await isPdfTextExtractionAvailable();

  return {
    available,
    detail: available
      ? "pdftotext is available for PDF uploads and imports."
      : "pdftotext is unavailable; PDF uploads and imports will fail until it is installed.",
  };
}

export function resetRuntimeToolchainStateForTests() {
  ripgrepAvailabilityPromise = null;
  pdftotextAvailabilityPromise = null;
}
