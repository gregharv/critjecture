export type SandboxGeneratedAsset = {
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

export type SandboxToolResponse = {
  exitCode: number;
  generatedAssets: SandboxGeneratedAsset[];
  pythonExecutable: string;
  stagedFiles: Array<{
    sourcePath: string;
    stagedPath: string;
  }>;
  stderr: string;
  stdout: string;
  summary: string;
  workspaceDir: string;
  runId: string;
};

export type GeneratedAssetToolResponse = SandboxToolResponse & {
  generatedAsset: SandboxGeneratedAsset;
};
