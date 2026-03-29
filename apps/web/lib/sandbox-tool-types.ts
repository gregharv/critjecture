export type SandboxGeneratedAsset = {
  byteSize: number;
  downloadUrl: string;
  expiresAt: number;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

export type SandboxLimits = {
  artifactMaxBytes: number;
  artifactTtlMs: number;
  cpuLimitSeconds: number;
  maxProcesses: number;
  memoryLimitBytes: number;
  stdoutMaxBytes: number;
  timeoutMs: number;
};

export type CsvSchemaSummary = {
  columns: string[];
  file: string;
};

export type SandboxToolResponse = {
  exitCode: number;
  generatedAssets: SandboxGeneratedAsset[];
  limits: SandboxLimits;
  runner: string;
  sandboxRunId: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
  status: "running" | "completed" | "failed" | "timed_out" | "rejected" | "abandoned";
  stderr: string;
  stdout: string;
  summary: string;
};

export type DataAnalysisToolResponse = SandboxToolResponse & {
  analysisResultId?: string;
  chartReady?: boolean;
  csvSchemas?: CsvSchemaSummary[];
};

export type GeneratedAssetToolResponse = SandboxToolResponse & {
  generatedAsset: SandboxGeneratedAsset;
};
