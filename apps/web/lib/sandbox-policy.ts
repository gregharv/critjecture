import "server-only";

const MEBIBYTE = 1024 * 1024;

function parseIntegerEnv(name: string, fallback: number) {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

export const SANDBOX_BWRAP_PATH = process.env.CRITJECTURE_SANDBOX_BWRAP_PATH?.trim() || "/usr/bin/bwrap";
export const SANDBOX_PRLIMIT_PATH =
  process.env.CRITJECTURE_SANDBOX_PRLIMIT_PATH?.trim() || "/usr/bin/prlimit";
export const SANDBOX_RUNNER = "bubblewrap";
export const SANDBOX_WORKSPACE_DIR = "/tmp/workspace";
export const SANDBOX_OUTPUTS_DIR = "outputs";
export const SANDBOX_TIMEOUT_MS = parseIntegerEnv("CRITJECTURE_SANDBOX_TIMEOUT_MS", 10_000);
export const SANDBOX_CPU_LIMIT_SECONDS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_CPU_LIMIT_SECONDS",
  8,
);
export const SANDBOX_MEMORY_LIMIT_BYTES = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_MEMORY_LIMIT_BYTES",
  512 * MEBIBYTE,
);
export const SANDBOX_MAX_PROCESSES = parseIntegerEnv("CRITJECTURE_SANDBOX_MAX_PROCESSES", 64);
export const SANDBOX_MAX_BUFFER = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_STDIO_MAX_BYTES",
  1 * MEBIBYTE,
);
export const SANDBOX_ARTIFACT_MAX_BYTES = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_ARTIFACT_MAX_BYTES",
  10 * MEBIBYTE,
);
export const SANDBOX_ARTIFACT_TTL_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_ARTIFACT_TTL_MS",
  24 * 60 * 60 * 1000,
);
export const SANDBOX_MAX_ACTIVE_RUNS_PER_USER = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_MAX_ACTIVE_RUNS_PER_USER",
  1,
);
export const SANDBOX_MAX_ACTIVE_RUNS_GLOBAL = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_MAX_ACTIVE_RUNS_GLOBAL",
  4,
);
export const SANDBOX_STALE_RUN_GRACE_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_STALE_RUN_GRACE_MS",
  5_000,
);

export type SandboxLimitsSnapshot = {
  artifactMaxBytes: number;
  artifactTtlMs: number;
  cpuLimitSeconds: number;
  maxProcesses: number;
  memoryLimitBytes: number;
  stdoutMaxBytes: number;
  timeoutMs: number;
};

export function getSandboxLimitsSnapshot(): SandboxLimitsSnapshot {
  return {
    artifactMaxBytes: SANDBOX_ARTIFACT_MAX_BYTES,
    artifactTtlMs: SANDBOX_ARTIFACT_TTL_MS,
    cpuLimitSeconds: SANDBOX_CPU_LIMIT_SECONDS,
    maxProcesses: SANDBOX_MAX_PROCESSES,
    memoryLimitBytes: SANDBOX_MEMORY_LIMIT_BYTES,
    stdoutMaxBytes: SANDBOX_MAX_BUFFER,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  };
}

export function getSandboxStaleThreshold(now = Date.now()) {
  return now - (SANDBOX_TIMEOUT_MS + SANDBOX_STALE_RUN_GRACE_MS);
}
