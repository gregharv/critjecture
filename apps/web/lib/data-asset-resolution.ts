import "server-only";

import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, inArray, like } from "drizzle-orm";

import { canRoleAccessKnowledgeScope } from "@/lib/access-control";
import { getAppDatabase } from "@/lib/app-db";
import {
  dataAssets,
  dataAssetVersions,
  documents,
  workflowRunResolvedInputs,
} from "@/lib/app-schema";
import {
  createAssetVersionIfChanged,
  ensureDocumentAsset,
  ensureFilesystemAssetVersion,
  findAssetByPath,
  getLatestReadyAssetVersion,
  type AssetBackedDocumentDescriptor,
  type DataAssetRecord,
  type DataAssetVersionRecord,
} from "@/lib/data-assets";
import { resolveCompanyDataRoot } from "@/lib/company-data";
import type { UserRole } from "@/lib/roles";
import type { WorkflowVersionContractsV1 } from "@/lib/workflow-types";

export class DataAssetResolutionError extends Error {
  readonly code: string;

  constructor(message: string, code = "data_asset_resolution_error") {
    super(message);
    this.code = code;
    this.name = "DataAssetResolutionError";
  }
}

export type ResolvedWorkflowAssetInput = {
  accessScope: "admin" | "public";
  assetId: string;
  assetVersionId: string;
  contentSha256: string;
  displayName: string;
  documentId: string | null;
  id: string;
  materializedPath: string;
  mimeType: string | null;
  resolvedAt: number | null;
  rowCount: number | null;
  schemaHash: string | null;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserId: string | null;
};

type ManagedDocumentSelectorRow = {
  accessScope: "admin" | "public";
  byteSize: number | null;
  contentSha256: string;
  displayName: string;
  id: string;
  lastIndexedAt: number | null;
  mimeType: string | null;
  organizationId: string;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserId: string | null;
};

type WorkflowSelectorBinding = Extract<
  WorkflowVersionContractsV1["inputBindings"]["bindings"][number]["binding"],
  { kind: "selector" }
>;


function parseJsonRecord(value: string | null | undefined) {
  if (!value) {
    return {} as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function inferAccessScopeFromPath(relativePath: string) {
  return relativePath.startsWith("admin/") ? ("admin" as const) : ("public" as const);
}

function inferMimeTypeFromPath(relativePath: string) {
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (extension === ".csv") {
    return "text/csv";
  }

  if (extension === ".md") {
    return "text/markdown";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".json") {
    return "application/json";
  }

  if (extension === ".tsv") {
    return "text/tab-separated-values";
  }

  if (extension === ".txt" || extension === ".log") {
    return "text/plain";
  }

  return null;
}

function toDocumentDescriptor(row: {
  accessScope: "admin" | "public";
  byteSize: number | null;
  contentSha256: string;
  displayName: string;
  id: string;
  lastIndexedAt: number | null;
  mimeType: string | null;
  organizationId: string;
  sourcePath: string;
  sourceType: string;
  updatedAt: number;
  uploadedByUserId: string | null;
}): AssetBackedDocumentDescriptor {
  return {
    accessScope: row.accessScope,
    byteSize: row.byteSize,
    contentSha256: row.contentSha256,
    displayName: row.displayName,
    documentId: row.id,
    lastIndexedAt: row.lastIndexedAt,
    mimeType: row.mimeType,
    organizationId: row.organizationId,
    sourcePath: row.sourcePath,
    sourceType: row.sourceType,
    updatedAt: row.updatedAt,
    uploadedByUserId: row.uploadedByUserId,
  } satisfies AssetBackedDocumentDescriptor;
}

function toResolvedWorkflowAssetInput(input: {
  asset: DataAssetRecord;
  metadata?: Record<string, unknown>;
  version: DataAssetVersionRecord;
}) {
  const versionMetadata = input.metadata ?? parseJsonRecord(input.version.metadataJson);
  const documentId = typeof versionMetadata.document_id === "string" ? versionMetadata.document_id : null;
  const sourceType =
    typeof versionMetadata.source_type === "string"
      ? versionMetadata.source_type
      : typeof versionMetadata.source_kind === "string"
        ? versionMetadata.source_kind
        : "asset";
  const uploadedByUserId =
    typeof versionMetadata.uploaded_by_user_id === "string"
      ? versionMetadata.uploaded_by_user_id
      : null;

  return {
    accessScope: input.asset.accessScope,
    assetId: input.asset.id,
    assetVersionId: input.version.id,
    contentSha256: input.version.contentHash,
    displayName: input.asset.displayName,
    documentId,
    id: documentId ?? input.asset.id,
    materializedPath: input.version.materializedPath,
    mimeType: input.version.mimeType,
    resolvedAt: null,
    rowCount: input.version.rowCount,
    schemaHash: input.version.schemaHash,
    sourcePath: input.version.materializedPath,
    sourceType,
    updatedAt: input.version.sourceModifiedAt ?? input.version.updatedAt,
    uploadedByUserId,
  } satisfies ResolvedWorkflowAssetInput;
}

async function listRelativeFiles(
  companyDataRoot: string,
  currentPath: string,
): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(companyDataRoot, entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(companyDataRoot, entryPath).replaceAll("\\", "/"));
    }
  }

  return files;
}

function matchesFilesystemSelector(input: {
  relativePath: string;
  selector: WorkflowSelectorBinding["selector"];
}) {
  const basename = path.posix.basename(input.relativePath);

  if (input.selector.access_scope_in && input.selector.access_scope_in.length > 0) {
    const accessScope = inferAccessScopeFromPath(input.relativePath);

    if (!input.selector.access_scope_in.includes(accessScope)) {
      return false;
    }
  }

  if (input.selector.display_name_equals && basename !== input.selector.display_name_equals) {
    return false;
  }

  if (input.selector.display_name_regex) {
    let regex: RegExp;

    try {
      regex = new RegExp(input.selector.display_name_regex);
    } catch {
      throw new DataAssetResolutionError(
        `Invalid selector display_name_regex pattern: ${input.selector.display_name_regex}`,
        "invalid_selector_regex",
      );
    }

    if (!regex.test(basename)) {
      return false;
    }
  }

  if (input.selector.mime_type_in && input.selector.mime_type_in.length > 0) {
    const mimeType = inferMimeTypeFromPath(input.relativePath);

    if (!mimeType || !input.selector.mime_type_in.includes(mimeType)) {
      return false;
    }
  }

  return true;
}

async function resolveFilesystemSelectorAssets(input: {
  binding: WorkflowSelectorBinding;
  organizationId: string;
  organizationSlug: string;
}) {
  if (input.binding.selector.source_type_in && input.binding.selector.source_type_in.length > 0) {
    return [] as ResolvedWorkflowAssetInput[];
  }

  const companyDataRoot = await resolveCompanyDataRoot(input.organizationSlug);
  const relativeFiles = await listRelativeFiles(companyDataRoot, companyDataRoot);
  const matchingPaths = relativeFiles
    .filter((relativePath) =>
      matchesFilesystemSelector({
        relativePath,
        selector: input.binding.selector,
      }),
    )
    .sort((left, right) => left.localeCompare(right));

  const resolvedInputs: ResolvedWorkflowAssetInput[] = [];

  for (const relativePath of matchingPaths) {
    const { asset, version } = await ensureFilesystemAssetVersion({
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      relativePath,
    });

    resolvedInputs.push(
      toResolvedWorkflowAssetInput({
        asset,
        version,
      }),
    );
  }

  const orderedResolvedInputs =
    input.binding.selection === "all_matching"
      ? resolvedInputs
      : [...resolvedInputs].sort((left, right) => {
          if (right.updatedAt === left.updatedAt) {
            return left.sourcePath.localeCompare(right.sourcePath);
          }

          return right.updatedAt - left.updatedAt;
        });

  return orderedResolvedInputs.slice(0, Math.min(Math.max(input.binding.max_documents, 1), 100));
}

async function resolveSelectorDocuments(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
}): Promise<ManagedDocumentSelectorRow[]> {
  if (input.binding.binding.kind !== "selector") {
    return [];
  }

  const selector = input.binding.binding.selector;
  const whereClauses = [
    eq(documents.organizationId, input.organizationId),
    eq(documents.ingestionStatus, "ready"),
  ];

  if (selector.access_scope_in && selector.access_scope_in.length > 0) {
    whereClauses.push(inArray(documents.accessScope, selector.access_scope_in));
  }

  if (selector.source_type_in && selector.source_type_in.length > 0) {
    whereClauses.push(inArray(documents.sourceType, selector.source_type_in));
  }

  if (selector.mime_type_in && selector.mime_type_in.length > 0) {
    whereClauses.push(inArray(documents.mimeType, selector.mime_type_in));
  }

  if (selector.display_name_equals) {
    whereClauses.push(eq(documents.displayName, selector.display_name_equals));
  }

  if (selector.uploaded_by_user_id) {
    whereClauses.push(eq(documents.uploadedByUserId, selector.uploaded_by_user_id));
  }

  const db = await getAppDatabase();
  const maxDocuments = Math.min(Math.max(input.binding.binding.max_documents, 1), 100);
  const fetchLimit = Math.min(Math.max(maxDocuments * 5, 50), 500);
  const baseQuery = db
    .select({
      accessScope: documents.accessScope,
      byteSize: documents.byteSize,
      contentSha256: documents.contentSha256,
      displayName: documents.displayName,
      id: documents.id,
      lastIndexedAt: documents.lastIndexedAt,
      mimeType: documents.mimeType,
      organizationId: documents.organizationId,
      sourcePath: documents.sourcePath,
      sourceType: documents.sourceType,
      updatedAt: documents.updatedAt,
      uploadedByUserId: documents.uploadedByUserId,
    })
    .from(documents)
    .where(and(...whereClauses));

  const orderedQuery =
    input.binding.binding.selection === "latest_indexed_at"
      ? baseQuery.orderBy(desc(documents.lastIndexedAt), desc(documents.updatedAt))
      : baseQuery.orderBy(desc(documents.updatedAt));

  const candidateRows = await orderedQuery.limit(fetchLimit);
  const regex = selector.display_name_regex
    ? (() => {
        try {
          return new RegExp(selector.display_name_regex);
        } catch {
          throw new DataAssetResolutionError(
            `Invalid selector display_name_regex pattern: ${selector.display_name_regex}`,
            "invalid_selector_regex",
          );
        }
      })()
    : null;
  const filteredRows = regex
    ? candidateRows.filter((row) => regex.test(row.displayName))
    : candidateRows;

  return filteredRows.slice(0, maxDocuments);
}

async function resolveDocumentBindingAssetInputs(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
}) {
  if (input.binding.binding.kind !== "document_id") {
    return [] as ResolvedWorkflowAssetInput[];
  }

  const db = await getAppDatabase();
  const documentRow = await db.query.documents.findFirst({
    where: and(
      eq(documents.organizationId, input.organizationId),
      eq(documents.id, input.binding.binding.document_id),
      eq(documents.ingestionStatus, "ready"),
    ),
  });

  if (!documentRow) {
    return [];
  }

  const { asset, version } = await ensureDocumentAsset({
    document: toDocumentDescriptor(documentRow),
  });

  return [
    toResolvedWorkflowAssetInput({
      asset,
      version,
    }),
  ];
}

async function resolveSelectorBindingAssetInputs(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
  organizationSlug: string;
}) {
  if (input.binding.binding.kind !== "selector") {
    return [] as ResolvedWorkflowAssetInput[];
  }

  const documentRows = await resolveSelectorDocuments({
    binding: input.binding,
    organizationId: input.organizationId,
  });

  if (documentRows.length > 0) {
    const resolvedInputs: ResolvedWorkflowAssetInput[] = [];

    for (const documentRow of documentRows) {
      const { asset, version } = await ensureDocumentAsset({
        document: toDocumentDescriptor(documentRow),
      });

      resolvedInputs.push(
        toResolvedWorkflowAssetInput({
          asset,
          version,
        }),
      );
    }

    return resolvedInputs;
  }

  return resolveFilesystemSelectorAssets({
    binding: input.binding.binding,
    organizationId: input.organizationId,
    organizationSlug: input.organizationSlug,
  });
}

async function refreshAssetVersionBestEffort(input: {
  asset: DataAssetRecord;
  organizationSlug: string;
}) {
  const assetMetadata = parseJsonRecord(input.asset.metadataJson);
  const relativePath =
    typeof assetMetadata.relative_path === "string" ? assetMetadata.relative_path : input.asset.assetKey;

  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return;
  }

  try {
    await createAssetVersionIfChanged({
      asset: input.asset,
      organizationSlug: input.organizationSlug,
      relativePath,
    });
  } catch {
    // Preserve the latest ready version if the source file was removed after binding.
  }
}

async function resolveLockedAssetVersion(input: {
  asset: DataAssetRecord;
  binding: Extract<WorkflowVersionContractsV1["inputBindings"]["bindings"][number]["binding"], { kind: "asset_id" }>;
  organizationId: string;
}) {
  const db = await getAppDatabase();

  if (typeof input.binding.lock_to_asset_version_id === "string" && input.binding.lock_to_asset_version_id) {
    const rows = await db
      .select()
      .from(dataAssetVersions)
      .where(
        and(
          eq(dataAssetVersions.organizationId, input.organizationId),
          eq(dataAssetVersions.assetId, input.asset.id),
          eq(dataAssetVersions.id, input.binding.lock_to_asset_version_id),
          eq(dataAssetVersions.ingestionStatus, "ready"),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  if (typeof input.binding.lock_to_content_hash === "string" && input.binding.lock_to_content_hash) {
    const rows = await db
      .select()
      .from(dataAssetVersions)
      .where(
        and(
          eq(dataAssetVersions.organizationId, input.organizationId),
          eq(dataAssetVersions.assetId, input.asset.id),
          eq(dataAssetVersions.contentHash, input.binding.lock_to_content_hash),
          eq(dataAssetVersions.ingestionStatus, "ready"),
        ),
      )
      .orderBy(desc(dataAssetVersions.createdAt), desc(dataAssetVersions.updatedAt))
      .limit(1);

    return rows[0] ?? null;
  }

  return getLatestReadyAssetVersion({
    assetId: input.asset.id,
    organizationId: input.organizationId,
  });
}

async function resolveAssetBindingAssetInputs(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
  organizationSlug: string;
}) {
  if (input.binding.binding.kind !== "asset_id") {
    return [] as ResolvedWorkflowAssetInput[];
  }

  const db = await getAppDatabase();
  const asset = await db.query.dataAssets.findFirst({
    where: and(
      eq(dataAssets.organizationId, input.organizationId),
      eq(dataAssets.id, input.binding.binding.asset_id),
    ),
  });

  if (!asset) {
    return [];
  }

  await refreshAssetVersionBestEffort({
    asset,
    organizationSlug: input.organizationSlug,
  });

  const version = await resolveLockedAssetVersion({
    asset,
    binding: input.binding.binding,
    organizationId: input.organizationId,
  });

  if (!version) {
    return [];
  }

  return [
    toResolvedWorkflowAssetInput({
      asset,
      version,
    }),
  ];
}

async function resolveAssetSelectorBindingAssetInputs(input: {
  binding: WorkflowVersionContractsV1["inputBindings"]["bindings"][number];
  organizationId: string;
  organizationSlug: string;
}) {
  if (input.binding.binding.kind !== "asset_selector") {
    return [] as ResolvedWorkflowAssetInput[];
  }

  const selector = input.binding.binding.selector;
  const whereClauses = [eq(dataAssets.organizationId, input.organizationId)];

  if (selector.access_scope_in && selector.access_scope_in.length > 0) {
    whereClauses.push(inArray(dataAssets.accessScope, selector.access_scope_in));
  }

  if (selector.asset_key_equals) {
    whereClauses.push(eq(dataAssets.assetKey, selector.asset_key_equals));
  }

  if (selector.asset_key_prefix) {
    whereClauses.push(like(dataAssets.assetKey, `${selector.asset_key_prefix}%`));
  }

  if (selector.connection_id) {
    whereClauses.push(eq(dataAssets.connectionId, selector.connection_id));
  }

  if (selector.data_kind_in && selector.data_kind_in.length > 0) {
    whereClauses.push(inArray(dataAssets.dataKind, selector.data_kind_in));
  }

  if (selector.external_object_id) {
    whereClauses.push(eq(dataAssets.externalObjectId, selector.external_object_id));
  }

  const db = await getAppDatabase();
  const maxAssets = Math.min(Math.max(input.binding.binding.max_assets, 1), 100);
  const candidateAssets = await db
    .select()
    .from(dataAssets)
    .where(and(...whereClauses))
    .orderBy(desc(dataAssets.updatedAt), desc(dataAssets.createdAt))
    .limit(input.binding.binding.selection === "all_matching" ? maxAssets : Math.max(maxAssets * 3, 10));
  const resolvedInputs: ResolvedWorkflowAssetInput[] = [];

  for (const asset of candidateAssets) {
    await refreshAssetVersionBestEffort({
      asset,
      organizationSlug: input.organizationSlug,
    });

    const version = await getLatestReadyAssetVersion({
      assetId: asset.id,
      organizationId: input.organizationId,
    });

    if (!version) {
      continue;
    }

    resolvedInputs.push(
      toResolvedWorkflowAssetInput({
        asset,
        version,
      }),
    );
  }

  const orderedInputs =
    input.binding.binding.selection === "all_matching"
      ? resolvedInputs
      : [...resolvedInputs].sort((left, right) => {
          if (right.updatedAt === left.updatedAt) {
            return left.sourcePath.localeCompare(right.sourcePath);
          }

          return right.updatedAt - left.updatedAt;
        });

  return orderedInputs.slice(0, maxAssets);
}

export async function loadFrozenWorkflowInputSnapshot(input: {
  organizationId: string;
  runId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db.query.workflowRunResolvedInputs.findMany({
    orderBy: [workflowRunResolvedInputs.inputKey, workflowRunResolvedInputs.inputItemIndex],
    where: and(
      eq(workflowRunResolvedInputs.organizationId, input.organizationId),
      eq(workflowRunResolvedInputs.runId, input.runId),
    ),
  });

  if (rows.length === 0) {
    return null;
  }

  const resolvedInputs = new Map<string, ResolvedWorkflowAssetInput[]>();

  for (const row of rows) {
    const metadata = parseJsonRecord(row.metadataJson);
    const entries = resolvedInputs.get(row.inputKey) ?? [];

    entries.push({
      accessScope:
        metadata.access_scope === "public" || metadata.access_scope === "admin"
          ? metadata.access_scope
          : "admin",
      assetId: row.assetId,
      assetVersionId: row.assetVersionId,
      contentSha256: row.contentHash,
      displayName: row.displayName,
      documentId: typeof metadata.document_id === "string" ? metadata.document_id : null,
      id:
        typeof metadata.document_id === "string" && metadata.document_id
          ? metadata.document_id
          : row.assetId,
      materializedPath: row.materializedPath,
      mimeType: typeof metadata.mime_type === "string" ? metadata.mime_type : null,
      resolvedAt: row.resolvedAt,
      rowCount: typeof metadata.row_count === "number" ? metadata.row_count : null,
      schemaHash: row.schemaHash,
      sourcePath: row.materializedPath,
      sourceType: typeof metadata.source_type === "string" ? metadata.source_type : "asset",
      updatedAt:
        typeof metadata.updated_at === "number"
          ? metadata.updated_at
          : row.resolvedAt,
      uploadedByUserId:
        typeof metadata.uploaded_by_user_id === "string" ? metadata.uploaded_by_user_id : null,
    });
    resolvedInputs.set(row.inputKey, entries);
  }

  return resolvedInputs;
}

export async function freezeWorkflowInputSnapshot(input: {
  organizationId: string;
  resolvedAt?: number;
  resolvedInputs: Map<string, ResolvedWorkflowAssetInput[]>;
  runId: string;
}) {
  const db = await getAppDatabase();
  const resolvedAt = input.resolvedAt ?? Date.now();

  await db
    .delete(workflowRunResolvedInputs)
    .where(
      and(
        eq(workflowRunResolvedInputs.organizationId, input.organizationId),
        eq(workflowRunResolvedInputs.runId, input.runId),
      ),
    );

  const rows = [...input.resolvedInputs.entries()].flatMap(([inputKey, resolvedEntries]) =>
    resolvedEntries.map((entry, index) => ({
      assetId: entry.assetId,
      assetVersionId: entry.assetVersionId,
      contentHash: entry.contentSha256,
      createdAt: resolvedAt + index,
      displayName: entry.displayName,
      id: randomUUID(),
      inputItemIndex: index,
      inputKey,
      materializedPath: entry.materializedPath,
      metadataJson: JSON.stringify({
        access_scope: entry.accessScope,
        asset_version_id: entry.assetVersionId,
        document_id: entry.documentId,
        mime_type: entry.mimeType,
        row_count: entry.rowCount,
        schema_hash: entry.schemaHash,
        source_type: entry.sourceType,
        updated_at: entry.updatedAt,
        uploaded_by_user_id: entry.uploadedByUserId,
      }),
      organizationId: input.organizationId,
      resolvedAt,
      runId: input.runId,
      schemaHash: entry.schemaHash,
      updatedAt: resolvedAt,
    })),
  );

  if (rows.length === 0) {
    return;
  }

  await db.insert(workflowRunResolvedInputs).values(rows);
}

export async function resolveWorkflowInputBindings(input: {
  contracts: WorkflowVersionContractsV1;
  executionRole: UserRole;
  organizationId: string;
  organizationSlug: string;
}) {
  const inputByKey = new Map(
    input.contracts.inputContract.inputs.map((spec) => [spec.input_key, spec]),
  );
  const resolvedInputDocuments = new Map<string, ResolvedWorkflowAssetInput[]>();

  for (const binding of input.contracts.inputBindings.bindings) {
    const inputSpec = inputByKey.get(binding.input_key);

    if (!inputSpec) {
      throw new DataAssetResolutionError(
        `Unknown input binding key: ${binding.input_key}`,
        "invalid_input_binding",
      );
    }

    const resolvedCandidates =
      binding.binding.kind === "asset_id"
        ? await resolveAssetBindingAssetInputs({
            binding,
            organizationId: input.organizationId,
            organizationSlug: input.organizationSlug,
          })
        : binding.binding.kind === "asset_selector"
          ? await resolveAssetSelectorBindingAssetInputs({
              binding,
              organizationId: input.organizationId,
              organizationSlug: input.organizationSlug,
            })
          : binding.binding.kind === "document_id"
            ? await resolveDocumentBindingAssetInputs({
                binding,
                organizationId: input.organizationId,
              })
            : await resolveSelectorBindingAssetInputs({
                binding,
                organizationId: input.organizationId,
                organizationSlug: input.organizationSlug,
              });

    const accessibleDocuments = resolvedCandidates.filter((documentRow) =>
      canRoleAccessKnowledgeScope(input.executionRole, documentRow.accessScope),
    );

    if (accessibleDocuments.length !== resolvedCandidates.length) {
      throw new DataAssetResolutionError(
        `Workflow input ${binding.input_key} resolved files that are no longer accessible to the run identity.`,
        "identity_invalid_document_access",
      );
    }

    const normalizedDocuments =
      inputSpec.multiplicity === "one"
        ? accessibleDocuments.slice(0, 1)
        : accessibleDocuments;

    resolvedInputDocuments.set(binding.input_key, normalizedDocuments);
  }

  for (const inputSpec of input.contracts.inputContract.inputs) {
    if (!resolvedInputDocuments.has(inputSpec.input_key)) {
      resolvedInputDocuments.set(inputSpec.input_key, []);
    }
  }

  return resolvedInputDocuments;
}

export async function ensureAssetRegisteredForSearchResult(input: {
  organizationId: string;
  organizationSlug: string;
  relativePath: string;
}) {
  const existing = await findAssetByPath({
    organizationId: input.organizationId,
    relativePath: input.relativePath,
  });

  if (existing) {
    try {
      await createAssetVersionIfChanged({
        asset: existing,
        organizationSlug: input.organizationSlug,
        relativePath: input.relativePath,
      });
    } catch {
      // Best-effort sync during search.
    }

    return existing;
  }

  try {
    const { asset } = await ensureFilesystemAssetVersion({
      organizationId: input.organizationId,
      organizationSlug: input.organizationSlug,
      relativePath: input.relativePath,
    });

    return asset;
  } catch {
    return null;
  }
}
