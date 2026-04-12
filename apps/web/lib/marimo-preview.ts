import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { resolveOrganizationStorageRoot } from "@/lib/app-paths";
import {
  getAnalysisPreviewSessionByTokenHash,
  getAnalysisWorkspaceByConversation,
  getLatestAnalysisNotebookRevision,
  getLatestAnalysisPreviewSession,
  createAnalysisPreviewSession,
  updateAnalysisPreviewSession,
} from "@/lib/marimo-workspaces";
import type { AnalysisPreviewSessionRecord } from "@/lib/marimo-types";
import { logStructuredError } from "@/lib/observability";

const PREVIEW_SESSION_TTL_MS = 15 * 60 * 1000;
const PREVIEW_READY_TIMEOUT_MS = 20 * 1000;
const PREVIEW_READY_POLL_MS = 300;

type ActivePreviewProcess = {
  child: ChildProcessWithoutNullStreams;
  port: number;
  revisionId: string;
  sessionId: string;
  workspaceId: string;
};

const previewProcesses = new Map<string, ActivePreviewProcess>();

function hashPreviewToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate preview port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function resolveMarimoExecutable() {
  const candidates = [
    path.resolve(process.cwd(), "packages/python-sandbox/.venv/bin/marimo"),
    path.resolve(process.cwd(), "../packages/python-sandbox/.venv/bin/marimo"),
    path.resolve(process.cwd(), "../../packages/python-sandbox/.venv/bin/marimo"),
  ];

  for (const candidate of candidates) {
    try {
      const fs = await import("node:fs/promises");
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error("Unable to locate packages/python-sandbox/.venv/bin/marimo.");
}

async function waitForPreviewReady(port: number) {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        cache: "no-store",
      });

      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, PREVIEW_READY_POLL_MS));
  }

  throw new Error("Timed out waiting for marimo preview to become ready.");
}

async function stopPreviewProcess(workspaceId: string) {
  const active = previewProcesses.get(workspaceId);

  if (!active) {
    return;
  }

  previewProcesses.delete(workspaceId);
  active.child.kill("SIGTERM");
}

async function cleanupExpiredPreviewProcesses() {
  const now = Date.now();

  for (const [workspaceId] of previewProcesses.entries()) {
    const latestSession = await getLatestAnalysisPreviewSession(workspaceId).catch(() => null);

    if (!latestSession || latestSession.expiresAt < now || latestSession.status === "failed") {
      await stopPreviewProcess(workspaceId);
    }
  }
}

async function startPreviewProcess(input: {
  notebookAbsolutePath: string;
  port: number;
  revisionId: string;
  workspaceId: string;
}) {
  const marimoExecutable = await resolveMarimoExecutable();
  const child = spawn(marimoExecutable, ["run", input.notebookAbsolutePath, "--port", String(input.port)], {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    stdio: "pipe",
  });

  child.stderr.on("data", (chunk) => {
    logStructuredError("marimo.preview.stderr", new Error(String(chunk)), {
      port: input.port,
      revisionId: input.revisionId,
      workspaceId: input.workspaceId,
    });
  });

  child.on("exit", () => {
    const active = previewProcesses.get(input.workspaceId);

    if (active && active.child.pid === child.pid) {
      previewProcesses.delete(input.workspaceId);
    }
  });

  await waitForPreviewReady(input.port);

  return child;
}

function buildProxyBaseUrl(conversationId: string) {
  return `/api/analysis/workspaces/${encodeURIComponent(conversationId)}/preview/proxy`;
}

export type AnalysisPreviewBootstrap = {
  expiresAt: number;
  fallbackHtmlUrl: string | null;
  port: number;
  proxyUrl: string;
  revisionId: string;
  sessionId: string;
  workspaceId: string;
};

export async function ensureAnalysisPreviewSession(input: {
  conversationId: string;
  forceRestart?: boolean;
  organizationId: string;
  organizationSlug: string;
  userId: string;
}) : Promise<AnalysisPreviewBootstrap> {
  await cleanupExpiredPreviewProcesses();

  const workspace = await getAnalysisWorkspaceByConversation({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    userId: input.userId,
  });

  if (!workspace) {
    throw new Error("Analysis workspace not found.");
  }

  const latestRevision = await getLatestAnalysisNotebookRevision(workspace.id);

  if (!latestRevision) {
    throw new Error("Analysis workspace does not have a notebook revision yet.");
  }

  const organizationRoot = await resolveOrganizationStorageRoot(input.organizationSlug);
  const notebookAbsolutePath = path.join(organizationRoot, ...latestRevision.notebookPath.split("/"));
  const active = previewProcesses.get(workspace.id);
  const latestSession = await getLatestAnalysisPreviewSession(workspace.id);

  let port = active?.port ?? null;
  let session: AnalysisPreviewSessionRecord | null = null;

  if (
    input.forceRestart ||
    !active ||
    active.revisionId !== latestRevision.id ||
    active.child.exitCode !== null ||
    active.child.killed
  ) {
    await stopPreviewProcess(workspace.id);
    port = await allocatePort();
    const child = await startPreviewProcess({
      notebookAbsolutePath,
      port,
      revisionId: latestRevision.id,
      workspaceId: workspace.id,
    });

    session = await createAnalysisPreviewSession({
      expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
      port,
      previewUrl: buildProxyBaseUrl(input.conversationId),
      revisionId: latestRevision.id,
      sandboxRunId: latestRevision.sandboxRunId,
      status: "ready",
      workspaceId: workspace.id,
    });

    previewProcesses.set(workspace.id, {
      child,
      port,
      revisionId: latestRevision.id,
      sessionId: session.id,
      workspaceId: workspace.id,
    });
  } else if (latestSession) {
    session = latestSession as AnalysisPreviewSessionRecord;
    await updateAnalysisPreviewSession({
      expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
      port,
      revisionId: latestRevision.id,
      sandboxRunId: latestRevision.sandboxRunId,
      sessionId: latestSession.id,
      status: "ready",
    });
  } else {
    session = await createAnalysisPreviewSession({
      expiresAt: Date.now() + PREVIEW_SESSION_TTL_MS,
      port: port ?? undefined,
      previewUrl: buildProxyBaseUrl(input.conversationId),
      revisionId: latestRevision.id,
      sandboxRunId: latestRevision.sandboxRunId,
      status: "ready",
      workspaceId: workspace.id,
    });
  }

  const previewToken = randomUUID();
  const previewTokenHash = hashPreviewToken(previewToken);
  const expiresAt = Date.now() + PREVIEW_SESSION_TTL_MS;

  await updateAnalysisPreviewSession({
    expiresAt,
    port,
    previewTokenHash,
    previewUrl: buildProxyBaseUrl(input.conversationId),
    revisionId: latestRevision.id,
    sandboxRunId: latestRevision.sandboxRunId,
    sessionId: session.id,
    status: "ready",
  });

  const fallbackHtmlUrl =
    latestRevision.htmlExportPath && latestRevision.sandboxRunId
      ? `/api/generated-files/${encodeURIComponent(latestRevision.sandboxRunId)}/${latestRevision.htmlExportPath
          .split("/")
          .map((segment) => encodeURIComponent(segment))
          .join("/")}`
      : null;

  return {
    expiresAt,
    fallbackHtmlUrl,
    port: port ?? 0,
    proxyUrl: `${buildProxyBaseUrl(input.conversationId)}/?token=${encodeURIComponent(previewToken)}`,
    revisionId: latestRevision.id,
    sessionId: session.id,
    workspaceId: workspace.id,
  };
}

export async function stopAnalysisPreviewSession(workspaceId: string) {
  await stopPreviewProcess(workspaceId);
}

export async function getAnalysisPreviewTarget(input: {
  conversationId: string;
  organizationId: string;
  previewToken: string;
  userId: string;
}) {
  const workspace = await getAnalysisWorkspaceByConversation({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    userId: input.userId,
  });

  if (!workspace) {
    return null;
  }

  const previewTokenHash = hashPreviewToken(input.previewToken);
  const session = await getAnalysisPreviewSessionByTokenHash({
    previewTokenHash,
    workspaceId: workspace.id,
  });

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  const active = previewProcesses.get(workspace.id);

  if (!active || active.sessionId !== session.id || active.child.exitCode !== null || active.child.killed) {
    return null;
  }

  return {
    port: active.port,
    revisionId: session.revisionId,
    sessionId: session.id,
    workspaceId: workspace.id,
  };
}
