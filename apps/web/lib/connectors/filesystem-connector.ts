import "server-only";

import { readdir } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { getAppDatabase } from "@/lib/legacy-app-db";
import { dataConnections, organizations } from "@/lib/legacy-app-schema";
import {
  normalizeCompanyDataRelativePath,
  resolveCompanyDataRoot,
} from "@/lib/company-data";
import { ensureDataConnection, getConnectionSpecForSource } from "@/lib/data-connections";
import {
  createAssetVersionIfChanged,
  createOrUpdateFilesystemAsset,
  findAssetByPath,
  getLatestReadyAssetVersion,
} from "@/lib/data-assets";
import { logStructuredError, logStructuredEvent } from "@/lib/observability";

export type FilesystemConnectorSyncResult = {
  completedAt: number;
  connectionId: string;
  createdAssetCount: number;
  existingAssetCount: number;
  organizationId: string;
  organizationSlug: string;
  scannedFileCount: number;
  startedAt: number;
  unchangedFileCount: number;
  versionCreatedCount: number;
};

async function listRelativeFilePaths(rootDir: string, prefix = ""): Promise<string[]> {
  const directoryPath = prefix ? path.join(rootDir, prefix) : rootDir;
  const entries = await readdir(directoryPath, {
    recursive: false,
    withFileTypes: true,
  }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      files.push(...(await listRelativeFilePaths(rootDir, relativePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(relativePath.split(path.sep).join("/"));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function resolveOrganizationSlug(input: {
  organizationId: string;
  organizationSlug?: string;
}) {
  if (input.organizationSlug) {
    return input.organizationSlug;
  }

  const db = await getAppDatabase();
  const organization = await db.query.organizations.findFirst({
    where: eq(organizations.id, input.organizationId),
  });

  if (!organization) {
    throw new Error(`Organization not found: ${input.organizationId}`);
  }

  return organization.slug;
}

async function ensureFilesystemConnection(input: { organizationId: string }) {
  const connectionSpec = getConnectionSpecForSource({
    sourceKind: "filesystem",
  });

  return ensureDataConnection({
    configJson: connectionSpec.configJson,
    displayName: connectionSpec.displayName,
    kind: connectionSpec.kind,
    organizationId: input.organizationId,
  });
}

export async function syncFilesystemDataConnection(input: {
  organizationId: string;
  organizationSlug?: string;
  relativePaths?: string[];
}) {
  const startedAt = Date.now();
  const organizationSlug = await resolveOrganizationSlug({
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
  });
  const connection = await ensureFilesystemConnection({
    organizationId: input.organizationId,
  });
  const companyDataRoot = await resolveCompanyDataRoot(organizationSlug);
  const relativePaths =
    input.relativePaths && input.relativePaths.length > 0
      ? [...new Set(input.relativePaths.map((relativePath) => normalizeCompanyDataRelativePath(relativePath)))].sort(
          (left, right) => left.localeCompare(right),
        )
      : await listRelativeFilePaths(companyDataRoot);

  let createdAssetCount = 0;
  let existingAssetCount = 0;
  let unchangedFileCount = 0;
  let versionCreatedCount = 0;

  try {
    for (const relativePath of relativePaths) {
      const existingAsset = await findAssetByPath({
        organizationId: input.organizationId,
        relativePath,
      });
      const existingLatestVersion = existingAsset
        ? await getLatestReadyAssetVersion({
            assetId: existingAsset.id,
            organizationId: input.organizationId,
          })
        : null;

      if (existingAsset) {
        existingAssetCount += 1;
      }

      const asset = await createOrUpdateFilesystemAsset({
        connectionId: connection.id,
        organizationId: input.organizationId,
        relativePath,
      });
      const version = await createAssetVersionIfChanged({
        asset,
        organizationSlug,
        relativePath,
      });

      if (!existingAsset) {
        createdAssetCount += 1;
      }

      if (existingLatestVersion?.id === version.id) {
        unchangedFileCount += 1;
      } else {
        versionCreatedCount += 1;
      }
    }

    const completedAt = Date.now();
    const db = await getAppDatabase();
    await db
      .update(dataConnections)
      .set({
        lastSyncAt: completedAt,
        status: "active",
        updatedAt: completedAt,
      })
      .where(eq(dataConnections.id, connection.id));

    const result: FilesystemConnectorSyncResult = {
      completedAt,
      connectionId: connection.id,
      createdAssetCount,
      existingAssetCount,
      organizationId: input.organizationId,
      organizationSlug,
      scannedFileCount: relativePaths.length,
      startedAt,
      unchangedFileCount,
      versionCreatedCount,
    };

    logStructuredEvent("data_connection.filesystem_sync_completed", {
      completed_at: completedAt,
      connection_id: result.connectionId,
      created_asset_count: result.createdAssetCount,
      existing_asset_count: result.existingAssetCount,
      organizationId: result.organizationId,
      organizationSlug: result.organizationSlug,
      routeGroup: "data_connection",
      routeKey: "data_connection.filesystem.sync",
      scanned_file_count: result.scannedFileCount,
      started_at: result.startedAt,
      unchanged_file_count: result.unchangedFileCount,
      version_created_count: result.versionCreatedCount,
    });

    return result;
  } catch (caughtError) {
    const failedAt = Date.now();
    const db = await getAppDatabase();
    await db
      .update(dataConnections)
      .set({
        status: "error",
        updatedAt: failedAt,
      })
      .where(eq(dataConnections.id, connection.id));

    logStructuredError("data_connection.filesystem_sync_failed", caughtError, {
      connectionId: connection.id,
      organizationId: input.organizationId,
      organizationSlug,
      routeGroup: "data_connection",
      routeKey: "data_connection.filesystem.sync",
    });

    throw caughtError;
  }
}

export async function reconcileFilesystemDataAssets(input?: {
  organizationId?: string;
  organizationSlug?: string;
}) {
  const db = await getAppDatabase();
  const organizationsToSync = input?.organizationId
    ? await db.query.organizations.findMany({
        where: eq(organizations.id, input.organizationId),
      })
    : await db.query.organizations.findMany();

  const results: FilesystemConnectorSyncResult[] = [];

  for (const organization of organizationsToSync) {
    const organizationSlug =
      organization.id === input?.organizationId && input.organizationSlug
        ? input.organizationSlug
        : organization.slug;

    results.push(
      await syncFilesystemDataConnection({
        organizationId: organization.id,
        organizationSlug,
      }),
    );
  }

  return results;
}
