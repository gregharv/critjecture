import "server-only";

import { getDeploymentMode } from "@/lib/deployment-mode";

const MEBIBYTE = 1024 * 1024;

export const SANDBOX_EXECUTION_BACKENDS = [
  "container_supervisor",
  "local_supervisor",
  "hosted_supervisor",
] as const;

export type SandboxExecutionBackend = (typeof SANDBOX_EXECUTION_BACKENDS)[number];

function parseStringEnv(name: string, fallback = "") {
  const value = process.env[name]?.trim();
  return value || fallback;
}

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
export const SANDBOX_LOCAL_RUNNER = "bubblewrap";
export const SANDBOX_CONTAINER_RUNNER = "oci-container";
export const SANDBOX_HOSTED_RUNNER = "hosted-supervisor";
export const SANDBOX_WORKSPACE_DIR = "/tmp/workspace";
export const SANDBOX_OUTPUTS_DIR = "outputs";
export const SANDBOX_TIMEOUT_MS = parseIntegerEnv("CRITJECTURE_SANDBOX_TIMEOUT_MS", 10_000);
export const SANDBOX_CPU_LIMIT_SECONDS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_CPU_LIMIT_SECONDS",
  8,
);
export const SANDBOX_MEMORY_LIMIT_BYTES = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_MEMORY_LIMIT_BYTES",
  4 * 1024 * MEBIBYTE,
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
export const SANDBOX_SUPERVISOR_HEARTBEAT_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_SUPERVISOR_HEARTBEAT_MS",
  1_000,
);
export const SANDBOX_SUPERVISOR_LEASE_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_SUPERVISOR_LEASE_MS",
  SANDBOX_TIMEOUT_MS + 15_000,
);
export const SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_WAIT_FOR_RESULT_TIMEOUT_MS",
  SANDBOX_TIMEOUT_MS + 20_000,
);
export const SANDBOX_HOSTED_SUPERVISOR_TIMEOUT_MS = parseIntegerEnv(
  "CRITJECTURE_SANDBOX_SUPERVISOR_TIMEOUT_MS",
  SANDBOX_TIMEOUT_MS + 5_000,
);

export function getSandboxExecutionBackend(): SandboxExecutionBackend {
  const configuredValue = parseStringEnv("CRITJECTURE_SANDBOX_EXECUTION_BACKEND").toLowerCase();

  if (
    configuredValue &&
    (SANDBOX_EXECUTION_BACKENDS as readonly string[]).includes(configuredValue)
  ) {
    return configuredValue as SandboxExecutionBackend;
  }

  return getDeploymentMode() === "hosted" ? "hosted_supervisor" : "container_supervisor";
}

export function getSandboxSupervisorUrl() {
  return parseStringEnv("CRITJECTURE_SANDBOX_SUPERVISOR_URL");
}

export function getSandboxSupervisorToken() {
  return parseStringEnv("CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN");
}

export function getSandboxContainerImage() {
  return parseStringEnv("CRITJECTURE_SANDBOX_CONTAINER_IMAGE");
}

export function getSandboxRunnerForBackend(backend: SandboxExecutionBackend) {
  if (backend === "local_supervisor") {
    return SANDBOX_LOCAL_RUNNER;
  }

  if (backend === "container_supervisor") {
    return SANDBOX_CONTAINER_RUNNER;
  }

  return SANDBOX_HOSTED_RUNNER;
}

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
  return now - (SANDBOX_SUPERVISOR_LEASE_MS + SANDBOX_STALE_RUN_GRACE_MS);
}
