import "server-only";

import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import { sandboxRuns } from "@/lib/app-schema";
import type { GeneratedSandboxAsset } from "@/lib/python-sandbox";

function parseGeneratedAssetsJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function recordSandboxRun(input: {
  generatedAssets: GeneratedSandboxAsset[];
  organizationId: string;
  runId: string;
  toolName: string;
  userId: string;
}) {
  const db = await getAppDatabase();

  await db
    .insert(sandboxRuns)
    .values({
      createdAt: Date.now(),
      generatedAssetsJson: JSON.stringify(input.generatedAssets),
      organizationId: input.organizationId,
      runId: input.runId,
      toolName: input.toolName,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: sandboxRuns.runId,
      set: {
        createdAt: Date.now(),
        generatedAssetsJson: JSON.stringify(input.generatedAssets),
        organizationId: input.organizationId,
        toolName: input.toolName,
        userId: input.userId,
      },
    });
}

export async function getSandboxRunByRunId(runId: string) {
  const db = await getAppDatabase();
  const row = await db.query.sandboxRuns.findFirst({
    where: eq(sandboxRuns.runId, runId),
  });

  if (!row) {
    return null;
  }

  return {
    createdAt: row.createdAt,
    generatedAssets: parseGeneratedAssetsJson(row.generatedAssetsJson),
    organizationId: row.organizationId,
    runId: row.runId,
    toolName: row.toolName,
    userId: row.userId,
  };
}
