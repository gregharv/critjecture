import "server-only";

import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { resolveAuthorizedCompanyDataFile } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";
import {
  attachSandboxRunToToolCall,
  cleanupExpiredSandboxArtifacts,
  completeSandboxRun,
  ensureSandboxAssetStorageRoot,
  markSandboxRunCleanup,
  replaceSandboxGeneratedAssets,
  startSandboxRun,
} from "@/lib/sandbox-runs";
import {
  SANDBOX_ARTIFACT_MAX_BYTES,
  SANDBOX_ARTIFACT_TTL_MS,
  SANDBOX_BWRAP_PATH,
  SANDBOX_MAX_BUFFER,
  SANDBOX_OUTPUTS_DIR,
  SANDBOX_PRLIMIT_PATH,
  SANDBOX_RUNNER,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_WORKSPACE_DIR,
  type SandboxLimitsSnapshot,
} from "@/lib/sandbox-policy";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GENERATED_ASSET_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
};

const TOOL_OUTPUT_POLICIES = {
  generate_document: {
    expectedRelativePath: "outputs/notice.pdf",
    mimeType: "application/pdf",
  },
  generate_visual_graph: {
    expectedRelativePath: "outputs/chart.png",
    mimeType: "image/png",
  },
  run_data_analysis: null,
} as const;

type SandboxToolName = keyof typeof TOOL_OUTPUT_POLICIES;

type OutputFileRecord = {
  absolutePath: string;
  byteSize: number;
  mimeType: string;
  relativePath: string;
};

export type StagedSandboxFile = {
  sourcePath: string;
  stagedPath: string;
};

export type GeneratedSandboxAsset = {
  byteSize: number;
  downloadUrl: string;
  expiresAt: number;
  fileName: string;
  mimeType: string;
  relativePath: string;
  runId: string;
};

export type SandboxedCommandResult = {
  exitCode: number;
  generatedAssets: GeneratedSandboxAsset[];
  limits: SandboxLimitsSnapshot;
  runner: string;
  sandboxRunId: string;
  stagedFiles: StagedSandboxFile[];
  status: "completed" | "failed" | "timed_out" | "rejected" | "abandoned";
  stderr: string;
  stdout: string;
};

export class SandboxAdmissionError extends Error {
  readonly sandboxRunId: string;

  constructor(message: string, sandboxRunId: string) {
    super(message);
    this.name = "SandboxAdmissionError";
    this.sandboxRunId = sandboxRunId;
  }
}

export class SandboxExecutionError extends Error {
  readonly exitCode: number;
  readonly sandboxRunId: string;
  readonly status: "failed" | "timed_out";
  readonly stderr: string;
  readonly stdout: string;

  constructor(
    message: string,
    options: {
      exitCode: number;
      sandboxRunId: string;
      status: "failed" | "timed_out";
      stderr: string;
      stdout: string;
    },
  ) {
    super(message);
    this.name = "SandboxExecutionError";
    this.exitCode = options.exitCode;
    this.sandboxRunId = options.sandboxRunId;
    this.status = options.status;
    this.stderr = options.stderr;
    this.stdout = options.stdout;
  }
}

export class SandboxValidationError extends Error {
  readonly sandboxRunId: string | null;

  constructor(message: string, sandboxRunId: string | null = null) {
    super(message);
    this.name = "SandboxValidationError";
    this.sandboxRunId = sandboxRunId;
  }
}

async function pathExists(targetPath: string, mode = fsConstants.R_OK) {
  try {
    await access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}

function buildGeneratedAssetDownloadUrl(runId: string, relativePath: string) {
  const encodedRelativePath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/api/generated-files/${runId}/${encodedRelativePath}`;
}

export function normalizeGeneratedAssetRelativePath(relativePath: string) {
  const trimmed = relativePath.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error("Generated asset path must not be empty.");
  }

  if (trimmed.startsWith("/")) {
    throw new Error("Generated asset path must be relative.");
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Generated asset path must stay inside the sandbox outputs directory.");
  }

  if (
    normalized !== SANDBOX_OUTPUTS_DIR &&
    !normalized.startsWith(`${SANDBOX_OUTPUTS_DIR}/`)
  ) {
    throw new Error("Generated asset path must stay inside the sandbox outputs directory.");
  }

  return normalized;
}

function getGeneratedAssetMimeType(relativePath: string) {
  return GENERATED_ASSET_MIME_TYPES[path.extname(relativePath).toLowerCase()] ?? null;
}

async function resolvePythonSandboxRoot() {
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "packages/python-sandbox"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../packages/python-sandbox"),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "../../packages/python-sandbox"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "pyproject.toml"))) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate packages/python-sandbox. Initialize the Step 3 uv project before running sandboxed Python.",
  );
}

async function resolvePythonExecutable() {
  const sandboxRoot = await resolvePythonSandboxRoot();
  const pythonExecutable = path.join(sandboxRoot, ".venv/bin/python");
  const sitePackagesRoot = path.join(sandboxRoot, ".venv/lib");

  if (!(await pathExists(pythonExecutable, fsConstants.X_OK))) {
    throw new Error(
      "Python sandbox interpreter is missing at packages/python-sandbox/.venv/bin/python. Run `uv sync` in packages/python-sandbox before testing the sandbox.",
    );
  }

  const resolvedPythonExecutable = await realpath(pythonExecutable);
  const sitePackagesEntries = await readdir(sitePackagesRoot, { withFileTypes: true });
  const pythonLibDir = sitePackagesEntries.find(
    (entry) => entry.isDirectory() && /^python\d+\.\d+$/.test(entry.name),
  );

  if (!pythonLibDir) {
    throw new Error("Python sandbox site-packages directory is missing from the uv environment.");
  }

  return {
    pythonExecutable,
    resolvedPythonExecutable,
    sandboxRoot,
    sitePackagesPath: path.join(sandboxRoot, ".venv/lib", pythonLibDir.name, "site-packages"),
  };
}

async function validateHostSandboxDependencies() {
  const missing: string[] = [];

  if (!(await pathExists(SANDBOX_BWRAP_PATH, fsConstants.X_OK))) {
    missing.push(SANDBOX_BWRAP_PATH);
  }

  if (!(await pathExists(SANDBOX_PRLIMIT_PATH, fsConstants.X_OK))) {
    missing.push(SANDBOX_PRLIMIT_PATH);
  }

  if (missing.length > 0) {
    throw new Error(
      `Sandbox hardening requires executable host dependencies: ${missing.join(", ")}`,
    );
  }
}

async function validatePythonSyntax(pythonExecutable: string, code: string) {
  try {
    await execFileAsync(
      pythonExecutable,
      ["-c", "import sys; compile(sys.argv[1], '<sandbox>', 'exec')", code],
      {
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "production",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONUNBUFFERED: "1",
        },
        maxBuffer: SANDBOX_MAX_BUFFER,
        timeout: SANDBOX_TIMEOUT_MS,
      },
    );
  } catch (caughtError) {
    const stderr =
      typeof caughtError === "object" &&
      caughtError !== null &&
      "stderr" in caughtError &&
      typeof caughtError.stderr === "string"
        ? caughtError.stderr.trim()
        : "";
    const stdout =
      typeof caughtError === "object" &&
      caughtError !== null &&
      "stdout" in caughtError &&
      typeof caughtError.stdout === "string"
        ? caughtError.stdout.trim()
        : "";
    const combinedOutput = [stderr, stdout].filter(Boolean).join("\n");

    throw new SandboxValidationError(
      combinedOutput || "Python syntax preflight failed before sandbox execution.",
    );
  }
}

function extractPolarsColumnReferences(code: string) {
  return [
    ...new Set(
      [...code.matchAll(/\bpl\.col\(\s*(['"])([^"'\\]+)\1\s*\)/g)].map((match) => match[2] ?? ""),
    ),
  ].filter(Boolean);
}

function extractPolarsAliasDefinitions(code: string) {
  return [
    ...new Set(
      [...code.matchAll(/\.alias\(\s*(['"])([^"'\\]+)\1\s*\)/g)].map((match) => match[2] ?? ""),
    ),
  ].filter(Boolean);
}

async function readFirstLine(filePath: string) {
  const fileHandle = await open(filePath, "r");
  const buffer = Buffer.alloc(4096);

  try {
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);

    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0]?.trim() ?? "";
  } finally {
    await fileHandle.close();
  }
}

function splitCsvHeaderColumns(headerLine: string) {
  return headerLine
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

async function getAvailableCsvColumns(stagedFiles: StagedSandboxFile[], workspaceDir: string) {
  const csvFiles = stagedFiles.filter((file) => file.sourcePath.toLowerCase().endsWith(".csv"));
  const availableColumnsByFile = new Map<string, string[]>();

  for (const stagedFile of csvFiles) {
    const stagedAbsolutePath = path.join(workspaceDir, ...stagedFile.stagedPath.split("/"));
    const headerLine = await readFirstLine(stagedAbsolutePath);

    availableColumnsByFile.set(stagedFile.sourcePath, splitCsvHeaderColumns(headerLine));
  }

  return availableColumnsByFile;
}

export async function validateCsvAnalysisCode(
  code: string,
  stagedFiles: StagedSandboxFile[],
  workspaceDir: string,
) {
  if (/\b(?:import|from)\s+pandas\b/i.test(code) || /\bpd\.read_csv\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use Polars LazyFrames. pandas and pd.read_csv(...) are not allowed.",
    );
  }

  if (/\bpl\.read_csv\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use pl.scan_csv(...). Eager pl.read_csv(...) is not allowed.",
    );
  }

  if (!/\bpl\.scan_csv\s*\(/i.test(code) || !/\.collect\s*\(/i.test(code)) {
    throw new SandboxValidationError(
      "CSV analysis must use pl.scan_csv(...) with a final .collect() before printing the answer.",
    );
  }

  if (/\.groupby\s*\(/i.test(code)) {
    throw new SandboxValidationError("Polars uses group_by(...), not groupby(...).");
  }

  if (/\.sort\s*\([\s\S]*?\breverse\s*=/.test(code)) {
    throw new SandboxValidationError(
      "Polars sort(...) uses descending=True, not reverse=True.",
    );
  }

  if (/\.sort\s*\([\s\S]*?,\s*['"](asc|desc|ascending|descending)['"]/.test(code)) {
    throw new SandboxValidationError(
      "Polars sort(...) does not accept string direction arguments like 'desc'. Use descending=True instead.",
    );
  }

  if (/\.rows\b(?!\s*\()/i.test(code)) {
    throw new SandboxValidationError(
      "Polars DataFrame rows is a method. Use rows() or convert named columns with to_list().",
    );
  }

  const referencedColumns = extractPolarsColumnReferences(code);

  if (referencedColumns.length === 0) {
    return;
  }

  const availableColumnsByFile = await getAvailableCsvColumns(stagedFiles, workspaceDir);
  const availableColumns = new Set([...availableColumnsByFile.values()].flatMap((columns) => columns));
  const definedAliases = new Set(extractPolarsAliasDefinitions(code));
  const missingColumns = referencedColumns.filter(
    (column) => !availableColumns.has(column) && !definedAliases.has(column),
  );

  if (missingColumns.length === 0) {
    return;
  }

  const availableColumnsSummary = [...availableColumnsByFile.entries()]
    .map(([filePath, columns]) => `${filePath}: ${columns.join(", ")}`)
    .join(" | ");

  throw new SandboxValidationError(
    `CSV analysis referenced unknown column(s): ${missingColumns.join(", ")}. Available staged CSV columns: ${availableColumnsSummary}`,
  );
}

async function stageInputFiles(
  inputFiles: string[],
  organizationId: string,
  organizationSlug: string,
  role: UserRole,
  workspaceDir: string,
): Promise<StagedSandboxFile[]> {
  const uniquePaths = [...new Set(inputFiles.map((filePath) => filePath.trim()).filter(Boolean))];
  const stagedFiles: StagedSandboxFile[] = [];

  for (const requestedPath of uniquePaths) {
    const resolvedFile = await resolveAuthorizedCompanyDataFile(
      requestedPath,
      organizationSlug,
      role,
      organizationId,
    );
    const stagedPath = path.posix.join("inputs", resolvedFile.relativePath);
    const stagedAbsolutePath = path.join(workspaceDir, ...stagedPath.split("/"));

    await mkdir(path.dirname(stagedAbsolutePath), { recursive: true });
    await copyFile(resolvedFile.absolutePath, stagedAbsolutePath);

    stagedFiles.push({
      sourcePath: resolvedFile.relativePath,
      stagedPath,
    });
  }

  return stagedFiles;
}

async function readMagicHeader(absolutePath: string, length = 8) {
  const fileHandle = await open(absolutePath, "r");
  const buffer = Buffer.alloc(length);

  try {
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function detectValidatedMimeType(record: { absolutePath: string; relativePath: string }) {
  const expectedMimeType = getGeneratedAssetMimeType(record.relativePath);

  if (!expectedMimeType) {
    throw new SandboxValidationError(
      `Unsupported generated asset type: ${path.extname(record.relativePath) || record.relativePath}`,
    );
  }

  const header = await readMagicHeader(record.absolutePath, expectedMimeType === "image/png" ? 8 : 5);

  if (
    expectedMimeType === "image/png" &&
    !header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    throw new SandboxValidationError(`Generated PNG has an invalid file signature: ${record.relativePath}`);
  }

  if (
    expectedMimeType === "application/pdf" &&
    header.toString("utf8", 0, 5) !== "%PDF-"
  ) {
    throw new SandboxValidationError(`Generated PDF has an invalid file signature: ${record.relativePath}`);
  }

  return expectedMimeType;
}

async function collectWorkspaceOutputFiles(workspaceDir: string) {
  const outputsDir = path.join(workspaceDir, SANDBOX_OUTPUTS_DIR);

  if (!(await pathExists(outputsDir))) {
    return [] as OutputFileRecord[];
  }

  const collected: OutputFileRecord[] = [];

  async function walk(currentAbsoluteDir: string, currentRelativeDir: string) {
    const entries = await readdir(currentAbsoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentAbsoluteDir, entry.name);
      const relativePath = path.posix.join(currentRelativeDir, entry.name);

      if (entry.isSymbolicLink()) {
        throw new SandboxValidationError(
          `Generated output must be a regular file, not a symbolic link: ${relativePath}`,
        );
      }

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        throw new SandboxValidationError(
          `Generated output must be a regular file: ${relativePath}`,
        );
      }

      const normalizedRelativePath = normalizeGeneratedAssetRelativePath(relativePath);
      const fileStats = await stat(absolutePath);

      if (fileStats.size > SANDBOX_ARTIFACT_MAX_BYTES) {
        throw new SandboxValidationError(
          `Generated output exceeded the ${SANDBOX_ARTIFACT_MAX_BYTES} byte limit: ${normalizedRelativePath}`,
        );
      }

      collected.push({
        absolutePath,
        byteSize: fileStats.size,
        mimeType: await detectValidatedMimeType({
          absolutePath,
          relativePath: normalizedRelativePath,
        }),
        relativePath: normalizedRelativePath,
      });
    }
  }

  await walk(outputsDir, SANDBOX_OUTPUTS_DIR);

  return collected.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function validateGeneratedOutputs(toolName: SandboxToolName, workspaceDir: string) {
  const outputPolicy = TOOL_OUTPUT_POLICIES[toolName];
  const outputFiles = await collectWorkspaceOutputFiles(workspaceDir);

  if (!outputPolicy) {
    if (outputFiles.length > 0) {
      throw new SandboxValidationError(
        "run_data_analysis may not persist generated files. Print the final answer to stdout instead.",
      );
    }

    return [] as OutputFileRecord[];
  }

  if (outputFiles.length !== 1) {
    throw new SandboxValidationError(
      `${toolName} must save exactly one file at ${outputPolicy.expectedRelativePath}.`,
    );
  }

  const [outputFile] = outputFiles;

  if (outputFile.relativePath !== outputPolicy.expectedRelativePath) {
    throw new SandboxValidationError(
      `${toolName} must save the generated file exactly at ${outputPolicy.expectedRelativePath}.`,
    );
  }

  if (outputFile.mimeType !== outputPolicy.mimeType) {
    throw new SandboxValidationError(
      `${toolName} generated the wrong file type for ${outputPolicy.expectedRelativePath}.`,
    );
  }

  return outputFiles;
}

async function persistGeneratedAssets(
  outputFiles: OutputFileRecord[],
  organizationSlug: string,
  runId: string,
) {
  if (outputFiles.length === 0) {
    await replaceSandboxGeneratedAssets({
      assets: [],
      runId,
    });

    return [] as GeneratedSandboxAsset[];
  }

  const { runRoot, storagePrefix } = await ensureSandboxAssetStorageRoot(organizationSlug, runId);
  const expiresAt = Date.now() + SANDBOX_ARTIFACT_TTL_MS;
  const persistedAssets: Array<GeneratedSandboxAsset & { storagePath: string }> = [];

  for (const outputFile of outputFiles) {
    const absoluteStoragePath = path.join(runRoot, ...outputFile.relativePath.split("/"));
    const storagePath = path.posix.join(storagePrefix, outputFile.relativePath);

    await mkdir(path.dirname(absoluteStoragePath), { recursive: true });
    await copyFile(outputFile.absolutePath, absoluteStoragePath);

    persistedAssets.push({
      byteSize: outputFile.byteSize,
      downloadUrl: buildGeneratedAssetDownloadUrl(runId, outputFile.relativePath),
      expiresAt,
      fileName: path.posix.basename(outputFile.relativePath),
      mimeType: outputFile.mimeType,
      relativePath: outputFile.relativePath,
      runId,
      storagePath,
    });
  }

  await replaceSandboxGeneratedAssets({
    assets: persistedAssets,
    runId,
  });

  return persistedAssets.map((asset) => {
    const { storagePath, ...publicAsset } = asset;
    void storagePath;

    return publicAsset;
  });
}

async function buildBubblewrapArgs(input: {
  code: string;
  limits: SandboxLimitsSnapshot;
  resolvedPythonExecutable: string;
  sandboxRoot: string;
  sitePackagesPath: string;
  workspaceDir: string;
}) {
  const hostInputsDir = path.join(input.workspaceDir, "inputs");
  const hostOutputsDir = path.join(input.workspaceDir, SANDBOX_OUTPUTS_DIR);
  const hostMatplotlibDir = path.join(input.workspaceDir, ".matplotlib");
  const hostResolvedPythonRoot = path.dirname(path.dirname(input.resolvedPythonExecutable));
  const sandboxPythonRoot = "/sandbox-root";
  const sandboxInterpreterRoot = "/sandbox-python";
  const sandboxPythonExecutable = path.posix.join(
    sandboxInterpreterRoot,
    path.basename(path.dirname(input.resolvedPythonExecutable)),
    path.basename(input.resolvedPythonExecutable),
  );
  const sandboxSitePackagesPath = path.posix.join(
    sandboxPythonRoot,
    path.relative(input.sandboxRoot, input.sitePackagesPath).replaceAll(path.sep, "/"),
  );
  const roBindCandidates = ["/usr", "/bin", "/lib", "/lib64", "/etc"];
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--uid",
    "0",
    "--gid",
    "0",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/workspace",
    "--dir",
    "/workspace/.matplotlib",
    "--dir",
    "/workspace/outputs",
  ];

  if (await pathExists(hostInputsDir)) {
    args.push("--ro-bind", hostInputsDir, "/workspace/inputs");
  } else {
    args.push("--dir", "/workspace/inputs");
  }

  for (const candidate of roBindCandidates) {
    if (await pathExists(candidate)) {
      args.push("--ro-bind", candidate, candidate);
    }
  }

  args.push(
    "--ro-bind",
    input.sandboxRoot,
    sandboxPythonRoot,
    "--ro-bind",
    hostResolvedPythonRoot,
    sandboxInterpreterRoot,
    "--bind",
    hostOutputsDir,
    "/workspace/outputs",
    "--bind",
    hostMatplotlibDir,
    "/workspace/.matplotlib",
    "--chdir",
    "/workspace",
    "--clearenv",
    "--setenv",
    "HOME",
    "/workspace",
    "--setenv",
    "MPLCONFIGDIR",
    "/workspace/.matplotlib",
    "--setenv",
    "VIRTUAL_ENV",
    `${sandboxPythonRoot}/.venv`,
    "--setenv",
    "PATH",
    `${sandboxPythonRoot}/.venv/bin:/usr/bin:/bin`,
    "--setenv",
    "POLARS_MAX_THREADS",
    "2",
    "--setenv",
    "RAYON_NUM_THREADS",
    "2",
    "--setenv",
    "OMP_NUM_THREADS",
    "1",
    "--setenv",
    "OPENBLAS_NUM_THREADS",
    "1",
    "--setenv",
    "MKL_NUM_THREADS",
    "1",
    "--setenv",
    "NUMEXPR_NUM_THREADS",
    "1",
    "--setenv",
    "MALLOC_CONF",
    "background_thread:false",
    "--setenv",
    "PYTHONPATH",
    sandboxSitePackagesPath,
    "--setenv",
    "PYTHONNOUSERSITE",
    "1",
    "--setenv",
    "PYTHONDONTWRITEBYTECODE",
    "1",
    "--setenv",
    "PYTHONUNBUFFERED",
    "1",
    "--setenv",
    "NODE_ENV",
    process.env.NODE_ENV ?? "production",
    SANDBOX_PRLIMIT_PATH,
    `--cpu=${input.limits.cpuLimitSeconds}`,
    `--as=${input.limits.memoryLimitBytes}`,
    `--nproc=${input.limits.maxProcesses}`,
    `--fsize=${input.limits.artifactMaxBytes}`,
    sandboxPythonExecutable,
    "-c",
    input.code,
  );

  return args;
}

async function runSandboxProcess(input: {
  code: string;
  limits: SandboxLimitsSnapshot;
  resolvedPythonExecutable: string;
  sandboxRoot: string;
  sitePackagesPath: string;
  workspaceDir: string;
}) {
  return execFileAsync(SANDBOX_BWRAP_PATH, await buildBubblewrapArgs(input), {
    maxBuffer: input.limits.stdoutMaxBytes,
    timeout: input.limits.timeoutMs + 1_000,
  });
}

function describeAdmissionRejection(reason: string) {
  if (reason === "per-user-concurrency-limit") {
    return "A sandbox job is already running for this user. Wait for it to finish before starting another.";
  }

  if (reason === "global-concurrency-limit") {
    return "The sandbox is at capacity right now. Retry after an active job finishes.";
  }

  return "Sandbox admission was rejected.";
}

export async function executeSandboxedCommand(options: {
  code: string;
  inputFiles?: string[];
  organizationId: string;
  organizationSlug: string;
  role: UserRole;
  runtimeToolCallId?: string;
  toolName: SandboxToolName;
  turnId?: string;
  userId: string;
}): Promise<SandboxedCommandResult> {
  const normalizedCode = options.code.trim();

  if (!normalizedCode) {
    throw new Error("Sandbox code must not be empty.");
  }

  await validateHostSandboxDependencies();
  await cleanupExpiredSandboxArtifacts({
    organizationId: options.organizationId,
    organizationSlug: options.organizationSlug,
  });

  const admission = await startSandboxRun({
    organizationId: options.organizationId,
    runtimeToolCallId: options.runtimeToolCallId,
    toolName: options.toolName,
    turnId: options.turnId,
    userId: options.userId,
  });

  if (admission.rejected) {
    if (options.runtimeToolCallId && options.turnId) {
      await attachSandboxRunToToolCall({
        runtimeToolCallId: options.runtimeToolCallId,
        sandboxRunId: admission.runId,
        turnId: options.turnId,
      });
    }

    throw new SandboxAdmissionError(describeAdmissionRejection(admission.reason), admission.runId);
  }

  const sandboxRunId = admission.runId;
  const limits = admission.limits;
  const workspaceDir = path.join(SANDBOX_WORKSPACE_DIR, sandboxRunId);
  let cleanupStatus: "completed" | "failed" = "completed";
  let cleanupError: string | null = null;

  if (options.runtimeToolCallId && options.turnId) {
    await attachSandboxRunToToolCall({
      runtimeToolCallId: options.runtimeToolCallId,
      sandboxRunId,
      turnId: options.turnId,
    });
  }

  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, SANDBOX_OUTPUTS_DIR), { recursive: true });
  await mkdir(path.join(workspaceDir, ".matplotlib"), { recursive: true });

  try {
    const stagedFiles = await stageInputFiles(
      options.inputFiles ?? [],
      options.organizationId,
      options.organizationSlug,
      options.role,
      workspaceDir,
    );
    const hasCsvInputs = stagedFiles.some((file) => file.sourcePath.toLowerCase().endsWith(".csv"));
    const { pythonExecutable, resolvedPythonExecutable, sandboxRoot, sitePackagesPath } =
      await resolvePythonExecutable();

    try {
      await validatePythonSyntax(pythonExecutable, normalizedCode);

      if (hasCsvInputs) {
        await validateCsvAnalysisCode(normalizedCode, stagedFiles, workspaceDir);
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Sandbox validation failed before execution.";
      await completeSandboxRun({
        failureReason: "validation-error",
        generatedAssets: [],
        runId: sandboxRunId,
        status: "failed",
      });
      throw new SandboxValidationError(message, sandboxRunId);
    }

    try {
      const { stdout, stderr } = await runSandboxProcess({
        code: normalizedCode,
        limits,
        resolvedPythonExecutable,
        sandboxRoot,
        sitePackagesPath,
        workspaceDir,
      });
      const outputFiles = await validateGeneratedOutputs(options.toolName, workspaceDir);
      const generatedAssets = await persistGeneratedAssets(
        outputFiles,
        options.organizationSlug,
        sandboxRunId,
      );

      await completeSandboxRun({
        exitCode: 0,
        generatedAssets,
        runId: sandboxRunId,
        status: "completed",
      });

      return {
        exitCode: 0,
        generatedAssets,
        limits,
        runner: SANDBOX_RUNNER,
        sandboxRunId,
        stagedFiles,
        status: "completed",
        stderr,
        stdout,
      };
    } catch (caughtError) {
      const stdout = "stdout" in Object(caughtError) ? String((caughtError as { stdout?: unknown }).stdout ?? "") : "";
      const stderr = "stderr" in Object(caughtError) ? String((caughtError as { stderr?: unknown }).stderr ?? "") : "";
      const signal = "signal" in Object(caughtError) ? String((caughtError as { signal?: unknown }).signal ?? "") : "";
      const killed = "killed" in Object(caughtError) ? Boolean((caughtError as { killed?: unknown }).killed) : false;
      const exitCode =
        "code" in Object(caughtError) && typeof (caughtError as { code?: unknown }).code === "number"
          ? ((caughtError as { code?: number }).code ?? -1)
          : -1;
      const isTimeout = killed || signal === "SIGTERM";
      const status = isTimeout ? "timed_out" : "failed";
      const failureReason =
        caughtError instanceof SandboxValidationError
          ? "output-validation-error"
          : status === "timed_out"
            ? "timeout"
            : "execution-error";
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : stderr.trim() || stdout.trim() || "Python sandbox execution failed.";

      await completeSandboxRun({
        exitCode,
        failureReason,
        generatedAssets: [],
        runId: sandboxRunId,
        status,
      });

      if (caughtError instanceof SandboxValidationError) {
        throw new SandboxValidationError(message, sandboxRunId);
      }

      throw new SandboxExecutionError(message, {
        exitCode,
        sandboxRunId,
        status,
        stderr,
        stdout,
      });
    }
  } finally {
    try {
      await rm(workspaceDir, { force: true, recursive: true });
    } catch (caughtError) {
      cleanupStatus = "failed";
      cleanupError = caughtError instanceof Error ? caughtError.message : String(caughtError);
    }

    await markSandboxRunCleanup({
      cleanupError,
      cleanupStatus,
      runId: sandboxRunId,
    });
  }
}

export function assertValidSandboxRunId(runId: string) {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("Invalid sandbox run id.");
  }
}

export async function resolvePersistedGeneratedAssetPath(
  organizationRoot: string,
  storagePath: string,
) {
  const absolutePath = path.resolve(organizationRoot, ...storagePath.split("/"));
  const relativeFromRoot = path.relative(organizationRoot, absolutePath);

  if (
    relativeFromRoot === "" ||
    relativeFromRoot === ".." ||
    relativeFromRoot.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Generated asset path must stay inside organization storage.");
  }

  const fileStats = await stat(absolutePath).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    throw new Error("Generated asset not found.");
  }

  await access(absolutePath, fsConstants.R_OK);

  return absolutePath;
}

export async function readPersistedGeneratedAssetSignature(absolutePath: string) {
  return readFile(absolutePath);
}
