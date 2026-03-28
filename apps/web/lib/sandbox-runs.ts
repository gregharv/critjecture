import "server-only";

import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/audit-db";
import { sandboxRuns } from "@/lib/audit-schema";
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
  toolName: string;
  userId: string;
  workspaceId: string;
}) {
  const db = await getAppDatabase();

  await db
    .insert(sandboxRuns)
    .values({
      createdAt: Date.now(),
      generatedAssetsJson: JSON.stringify(input.generatedAssets),
      toolName: input.toolName,
      userId: input.userId,
      workspaceId: input.workspaceId,
    })
    .onConflictDoUpdate({
      target: sandboxRuns.workspaceId,
      set: {
        createdAt: Date.now(),
        generatedAssetsJson: JSON.stringify(input.generatedAssets),
        toolName: input.toolName,
        userId: input.userId,
      },
    });
}

export async function getSandboxRunByWorkspaceId(workspaceId: string) {
  const db = await getAppDatabase();
  const row = await db.query.sandboxRuns.findFirst({
    where: eq(sandboxRuns.workspaceId, workspaceId),
  });

  if (!row) {
    return null;
  }

  return {
    createdAt: row.createdAt,
    generatedAssets: parseGeneratedAssetsJson(row.generatedAssetsJson),
    toolName: row.toolName,
    userId: row.userId,
    workspaceId: row.workspaceId,
  };
}
