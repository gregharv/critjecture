export type SandboxGeneratedAsset = {
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  relativePath: string;
  workspaceId: string;
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
};

export type GeneratedAssetToolResponse = SandboxToolResponse & {
  generatedAsset: SandboxGeneratedAsset;
};
