import { execFile } from "node:child_process";
import http from "node:http";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  getSupervisorAuthMode,
  verifyHostedSupervisorRequest,
} from "./auth.mjs";

const execFileAsync = promisify(execFile);
const OUTPUTS_DIR = "outputs";
const RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PORT = Number.parseInt(process.env.PORT ?? "4100", 10) || 4100;
const SUPERVISOR_TOKEN = process.env.CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN?.trim() || "";
const SUPERVISOR_KEY_ID = process.env.CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID?.trim() || "";
const SUPERVISOR_HMAC_SECRET = process.env.CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET?.trim() || "";
const BOUND_ORGANIZATION_SLUG =
  process.env.CRITJECTURE_HOSTED_ORGANIZATION_SLUG?.trim().toLowerCase() || "";
const CONTAINER_IMAGE = process.env.CRITJECTURE_SANDBOX_CONTAINER_IMAGE?.trim() || "";
const DOCKER_BIN = process.env.CRITJECTURE_SANDBOX_DOCKER_BIN?.trim() || "docker";
const WORKSPACE_ROOT =
  process.env.CRITJECTURE_SANDBOX_WORKSPACE_ROOT?.trim() ||
  path.join(os.tmpdir(), "critjecture-sandbox-supervisor");
const AUTH_MODE = getSupervisorAuthMode(process.env);
const MAX_CLOCK_SKEW_MS =
  Number.parseInt(process.env.CRITJECTURE_SANDBOX_SUPERVISOR_MAX_CLOCK_SKEW_MS ?? "", 10) ||
  DEFAULT_MAX_CLOCK_SKEW_MS;
const seenSignedNonces = new Map();

function jsonResponse(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return "";
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(bodyText) {
  if (!bodyText) {
    return {};
  }

  return JSON.parse(bodyText);
}

function getSupervisorHealthPayload(input = {}) {
  return {
    authMode: AUTH_MODE === "none" ? "unknown" : AUTH_MODE,
    boundOrganizationSlug: BOUND_ORGANIZATION_SLUG || null,
    runner: "oci-container",
    ...input,
  };
}

function authorizeRequest(request, input = {}) {
  if (AUTH_MODE === "none") {
    return {
      detail:
        "Sandbox supervisor auth is not configured. Set CRITJECTURE_SANDBOX_SUPERVISOR_TOKEN for bearer mode or CRITJECTURE_SANDBOX_SUPERVISOR_KEY_ID, CRITJECTURE_SANDBOX_SUPERVISOR_HMAC_SECRET, and CRITJECTURE_HOSTED_ORGANIZATION_SLUG for signed hosted mode.",
      error: "auth_not_configured",
      ok: false,
      statusCode: 503,
    };
  }

  if (AUTH_MODE === "bearer") {
    if (request.headers.authorization === `Bearer ${SUPERVISOR_TOKEN}`) {
      return {
        detail: "Bearer supervisor request verified.",
        ok: true,
      };
    }

    return {
      detail: "Sandbox supervisor authorization failed.",
      error: "unauthorized",
      ok: false,
      statusCode: 401,
    };
  }

  const verification = verifyHostedSupervisorRequest({
    body: input.body ?? "",
    endpoint: input.endpoint ?? request.url ?? "",
    expectedKeyId: SUPERVISOR_KEY_ID,
    expectedOrganizationSlug: BOUND_ORGANIZATION_SLUG,
    headers: request.headers,
    maxClockSkewMs: MAX_CLOCK_SKEW_MS,
    method: request.method ?? "GET",
    secret: SUPERVISOR_HMAC_SECRET,
    seenNonces: seenSignedNonces,
  });

  if (verification.ok) {
    return verification;
  }

  return {
    detail: verification.detail,
    error: verification.code ?? "unauthorized",
    ok: false,
    statusCode: verification.code === "organization_mismatch" ? 403 : 401,
  };
}

function normalizeRelativePath(relativePath, errorPrefix) {
  const trimmed = String(relativePath ?? "").trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error(`${errorPrefix} must not be empty.`);
  }

  if (trimmed.startsWith("/")) {
    throw new Error(`${errorPrefix} must be relative.`);
  }

  const normalized = path.posix.normalize(trimmed);

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`${errorPrefix} must stay inside the sandbox workspace.`);
  }

  return normalized;
}

function normalizeOutputRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath, "Generated asset path");

  if (normalized !== OUTPUTS_DIR && !normalized.startsWith(`${OUTPUTS_DIR}/`)) {
    throw new Error("Generated asset path must stay inside the sandbox outputs directory.");
  }

  return normalized;
}

async function readFirstLine(filePath) {
  const fileHandle = await open(filePath, "r");
  const buffer = Buffer.alloc(4096);

  try {
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0]?.trim() ?? "";
  } finally {
    await fileHandle.close();
  }
}

function splitCsvHeaderColumns(headerLine) {
  return headerLine
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function extractPolarsColumnReferences(code) {
  return [
    ...new Set(
      [...code.matchAll(/\bpl\.col\(\s*(['"])([^"'\\]+)\1\s*\)/g)].map((match) => match[2] ?? ""),
    ),
  ].filter(Boolean);
}

function extractPolarsAliasDefinitions(code) {
  return [
    ...new Set(
      [...code.matchAll(/\.alias\(\s*(['"])([^"'\\]+)\1\s*\)/g)].map((match) => match[2] ?? ""),
    ),
  ].filter(Boolean);
}

async function validateCsvAnalysisCode(code, stagedFiles, workspaceDir) {
  if (/\b(?:import|from)\s+pandas\b/i.test(code) || /\bpd\.read_csv\s*\(/i.test(code)) {
    throw new Error("CSV analysis must use Polars LazyFrames. pandas and pd.read_csv(...) are not allowed.");
  }

  if (/\bpl\.read_csv\s*\(/i.test(code)) {
    throw new Error("CSV analysis must use pl.scan_csv(...). Eager pl.read_csv(...) is not allowed.");
  }

  if (!/\bpl\.scan_csv\s*\(/i.test(code) || !/\.collect\s*\(/i.test(code)) {
    throw new Error(
      "CSV analysis must use pl.scan_csv(...) with a final .collect() before printing the answer.",
    );
  }

  if (/\.groupby\s*\(/i.test(code)) {
    throw new Error("Polars uses group_by(...), not groupby(...).");
  }

  if (/\.sort\s*\([\s\S]*?\breverse\s*=/.test(code)) {
    throw new Error("Polars sort(...) uses descending=True, not reverse=True.");
  }

  if (/\.sort\s*\([\s\S]*?,\s*['\"](asc|desc|ascending|descending)['\"]/.test(code)) {
    throw new Error(
      "Polars sort(...) does not accept string direction arguments like 'desc'. Use descending=True instead.",
    );
  }

  if (/\.rows\b(?!\s*\()/i.test(code)) {
    throw new Error("Polars DataFrame rows is a method. Use rows() or convert named columns with to_list().");
  }

  const referencedColumns = extractPolarsColumnReferences(code);

  if (referencedColumns.length === 0) {
    return;
  }

  const availableColumnsByFile = new Map();

  for (const stagedFile of stagedFiles.filter((file) => file.sourcePath.toLowerCase().endsWith(".csv"))) {
    const stagedAbsolutePath = path.join(workspaceDir, ...stagedFile.stagedPath.split("/"));
    availableColumnsByFile.set(
      stagedFile.sourcePath,
      splitCsvHeaderColumns(await readFirstLine(stagedAbsolutePath)),
    );
  }

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

  throw new Error(
    `CSV analysis referenced unknown column(s): ${missingColumns.join(", ")}. Available staged CSV columns: ${availableColumnsSummary}`,
  );
}

async function ensureDockerAvailable() {
  await execFileAsync(DOCKER_BIN, ["info"], { maxBuffer: 1024 * 1024 });

  if (!CONTAINER_IMAGE) {
    throw new Error("CRITJECTURE_SANDBOX_CONTAINER_IMAGE is not configured.");
  }

  await execFileAsync(DOCKER_BIN, ["image", "inspect", CONTAINER_IMAGE], {
    maxBuffer: 1024 * 1024,
  });
}

function buildContainerArgs({ containerName, limits, pythonArgs, workspaceDir }) {
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=bind,src=${workspaceDir},dst=/workspace`,
    "--workdir",
    "/workspace",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--memory",
    String(limits.memoryLimitBytes),
    "--pids-limit",
    String(limits.maxProcesses),
    "--ulimit",
    `cpu=${limits.cpuLimitSeconds}`,
    "--ulimit",
    `fsize=${limits.artifactMaxBytes}`,
    "--env",
    "HOME=/workspace",
    "--env",
    "MPLCONFIGDIR=/workspace/.matplotlib",
    "--env",
    "PYTHONNOUSERSITE=1",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    "--env",
    "PYTHONUNBUFFERED=1",
    "--env",
    "POLARS_MAX_THREADS=2",
    "--env",
    "RAYON_NUM_THREADS=2",
    "--env",
    "OMP_NUM_THREADS=1",
    "--env",
    "OPENBLAS_NUM_THREADS=1",
    "--env",
    "MKL_NUM_THREADS=1",
    "--env",
    "NUMEXPR_NUM_THREADS=1",
    CONTAINER_IMAGE,
    "python",
    ...pythonArgs,
  ];
}

async function runDockerContainer({ containerName, limits, pythonArgs, workspaceDir }) {
  try {
    return await execFileAsync(
      DOCKER_BIN,
      buildContainerArgs({ containerName, limits, pythonArgs, workspaceDir }),
      {
        maxBuffer: limits.stdoutMaxBytes,
        timeout: limits.timeoutMs + 1_000,
      },
    );
  } catch (error) {
    throw error;
  } finally {
    await execFileAsync(DOCKER_BIN, ["rm", "-f", containerName], {
      maxBuffer: 1024 * 1024,
    }).catch(() => {});
  }
}

async function stageWorkspaceFiles(payload, workspaceDir) {
  const stagedFiles = [];

  for (const file of payload.stagedInputFiles ?? []) {
    const relativePath = normalizeRelativePath(file.relativePath, "Input file path");
    const absolutePath = path.join(workspaceDir, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(String(file.base64Data ?? ""), "base64"));
    stagedFiles.push({
      sourcePath: String(file.sourcePath ?? ""),
      stagedPath: relativePath,
    });
  }

  for (const file of payload.inlineWorkspaceFiles ?? []) {
    const relativePath = normalizeRelativePath(file.relativePath, "Inline workspace file path");
    const absolutePath = path.join(workspaceDir, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, String(file.content ?? ""), "utf8");
  }

  return stagedFiles;
}

async function collectOutputFiles(workspaceDir) {
  const outputsDir = path.join(workspaceDir, OUTPUTS_DIR);
  const files = [];

  async function walk(currentAbsoluteDir, currentRelativeDir) {
    const entries = await readdir(currentAbsoluteDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const absolutePath = path.join(currentAbsoluteDir, entry.name);
      const relativePath = currentRelativeDir
        ? path.posix.join(currentRelativeDir, entry.name)
        : entry.name;

      if (entry.isSymbolicLink()) {
        throw new Error(`Generated output must be a regular file, not a symbolic link: ${relativePath}`);
      }

      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile()) {
        throw new Error(`Generated output must be a regular file: ${relativePath}`);
      }

      const normalizedRelativePath = normalizeOutputRelativePath(relativePath);
      const fileStats = await stat(absolutePath);
      files.push({
        base64Data: (await readFile(absolutePath)).toString("base64"),
        byteSize: fileStats.size,
        relativePath: normalizedRelativePath,
      });
    }
  }

  await walk(outputsDir, OUTPUTS_DIR);

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function executeRun(payload) {
  if (!RUN_ID_PATTERN.test(String(payload.runId ?? ""))) {
    throw new Error("runId must be a UUID.");
  }

  if (typeof payload.code !== "string" || !payload.code.trim()) {
    throw new Error("code must be a non-empty string.");
  }

  const limits = payload.limits ?? {};
  const workspaceDir = path.join(WORKSPACE_ROOT, payload.runId);
  const containerName = `critjecture-sandbox-${payload.runId}`;
  let stagedFiles = [];

  await ensureDockerAvailable();
  await mkdir(path.join(workspaceDir, OUTPUTS_DIR), { recursive: true });
  await mkdir(path.join(workspaceDir, ".matplotlib"), { recursive: true });

  try {
    stagedFiles = await stageWorkspaceFiles(payload, workspaceDir);

    try {
      await runDockerContainer({
        containerName: `${containerName}-compile`,
        limits,
        pythonArgs: ["-c", "import sys; compile(sys.argv[1], '<sandbox>', 'exec')", payload.code],
        workspaceDir,
      });

      if (stagedFiles.some((file) => file.sourcePath.toLowerCase().endsWith(".csv"))) {
        await validateCsvAnalysisCode(payload.code, stagedFiles, workspaceDir);
      }
    } catch (error) {
      return {
        failureReason: "validation-error",
        generatedAssets: [],
        runner: "oci-container",
        stagedFiles,
        status: "failed",
        stderr: error instanceof Error ? error.message : String(error),
        stdout: "",
      };
    }

    try {
      const { stdout, stderr } = await runDockerContainer({
        containerName,
        limits,
        pythonArgs: ["-c", payload.code],
        workspaceDir,
      });

      return {
        exitCode: 0,
        generatedAssets: await collectOutputFiles(workspaceDir),
        runner: "oci-container",
        stagedFiles,
        status: "completed",
        stderr,
        stdout,
      };
    } catch (error) {
      const stdout =
        typeof error === "object" && error !== null && "stdout" in error
          ? String(error.stdout ?? "")
          : "";
      const stderr =
        typeof error === "object" && error !== null && "stderr" in error
          ? String(error.stderr ?? "")
          : "";
      const signal =
        typeof error === "object" && error !== null && "signal" in error
          ? String(error.signal ?? "")
          : "";
      const killed =
        typeof error === "object" && error !== null && "killed" in error
          ? Boolean(error.killed)
          : false;
      const exitCode =
        typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
          ? error.code
          : -1;
      const timedOut = killed || signal === "SIGTERM";

      return {
        exitCode,
        failureReason: timedOut ? "timeout" : "execution-error",
        generatedAssets: [],
        runner: "oci-container",
        stagedFiles,
        status: timedOut ? "timed_out" : "failed",
        stderr:
          stderr ||
          (error instanceof Error ? error.message : "Container sandbox execution failed."),
        stdout,
      };
    }
  } finally {
    await rm(workspaceDir, { force: true, recursive: true }).catch(() => {});
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      const authorization = authorizeRequest(request, {
        body: "",
        endpoint: "/health",
      });

      if (!authorization.ok) {
        jsonResponse(response, authorization.statusCode, getSupervisorHealthPayload({
          available: false,
          detail: authorization.detail,
          error: authorization.error,
        }));
        return;
      }

      try {
        await ensureDockerAvailable();
        jsonResponse(response, 200, getSupervisorHealthPayload({
          available: true,
          detail: `Container supervisor is ready with image ${CONTAINER_IMAGE}.`,
        }));
      } catch (error) {
        jsonResponse(response, 503, getSupervisorHealthPayload({
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }));
      }
      return;
    }

    if (request.method === "POST" && request.url === "/runs/execute") {
      const bodyText = await readRequestBody(request);
      const authorization = authorizeRequest(request, {
        body: bodyText,
        endpoint: "/runs/execute",
      });

      if (!authorization.ok) {
        jsonResponse(response, authorization.statusCode, {
          detail: authorization.detail,
          error: authorization.error,
        });
        return;
      }

      const payload = parseJsonBody(bodyText);

      if (
        AUTH_MODE === "signed" &&
        String(payload.organizationSlug ?? "").trim().toLowerCase() !== BOUND_ORGANIZATION_SLUG
      ) {
        jsonResponse(response, 403, {
          detail: `Sandbox supervisor is bound to organization "${BOUND_ORGANIZATION_SLUG}", but the request payload targeted "${String(payload.organizationSlug ?? "").trim().toLowerCase()}".`,
          error: "organization_mismatch",
        });
        return;
      }

      const result = await executeRun(payload);
      jsonResponse(response, 200, result);
      return;
    }

    jsonResponse(response, 404, {
      error: "not_found",
    });
  } catch (error) {
    jsonResponse(response, 500, {
      detail: error instanceof Error ? error.message : String(error),
      error: "internal_error",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Sandbox supervisor listening on http://127.0.0.1:${PORT}`);
});
