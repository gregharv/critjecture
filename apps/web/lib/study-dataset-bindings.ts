import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { getAppDatabase } from "@/lib/app-db";
import {
  causalStudies,
  datasetVersionColumns,
  datasetVersions,
  datasets,
  studyDatasetBindings,
} from "@/lib/app-schema";

export type StudyDatasetCatalogItem = {
  accessScope: typeof datasets.$inferSelect.accessScope;
  activeVersionId: string | null;
  dataKind: typeof datasets.$inferSelect.dataKind;
  datasetKey: string;
  description: string | null;
  displayName: string;
  id: string;
  status: typeof datasets.$inferSelect.status;
  versions: Array<{
    contentHash: string;
    createdAt: number;
    id: string;
    ingestionStatus: typeof datasetVersions.$inferSelect.ingestionStatus;
    profileStatus: typeof datasetVersions.$inferSelect.profileStatus;
    rowCount: number | null;
    versionNumber: number;
  }>;
};

export type StudyDatasetBindingRecord = {
  bindingNote: string | null;
  bindingRole: typeof studyDatasetBindings.$inferSelect.bindingRole;
  createdAt: number;
  dataset: {
    dataKind: typeof datasets.$inferSelect.dataKind;
    datasetKey: string;
    displayName: string;
    id: string;
    status: typeof datasets.$inferSelect.status;
  };
  datasetVersion: null | {
    contentHash: string;
    id: string;
    ingestionStatus: typeof datasetVersions.$inferSelect.ingestionStatus;
    profileStatus: typeof datasetVersions.$inferSelect.profileStatus;
    rowCount: number | null;
    versionNumber: number;
  };
  id: string;
  isActive: boolean;
  updatedAt: number;
};

export type StudyDatasetSeedColumn = {
  columnName: string;
  columnOrder: number;
  description: string | null;
  displayName: string;
  id: string;
  isOutcomeCandidate: boolean;
  isTreatmentCandidate: boolean;
  nullable: boolean;
  physicalType: string;
  semanticType: typeof datasetVersionColumns.$inferSelect.semanticType;
};

export type StudyPrimaryDatasetSeedContract = {
  bindingId: string;
  columns: StudyDatasetSeedColumn[];
  dataset: {
    datasetKey: string;
    displayName: string;
    id: string;
  };
  datasetVersion: {
    id: string;
    profileStatus: typeof datasetVersions.$inferSelect.profileStatus;
    rowCount: number | null;
    versionNumber: number;
  };
};

export type StudyDatasetBindingReadiness = {
  canApproveDag: boolean;
  canCreateRun: boolean;
  primaryBinding: StudyDatasetBindingRecord | null;
  reasons: string[];
};

export type StudyDatasetBindingDetail = {
  bindings: StudyDatasetBindingRecord[];
  catalog: StudyDatasetCatalogItem[];
  readiness: StudyDatasetBindingReadiness;
  seedContract: StudyPrimaryDatasetSeedContract | null;
  studyId: string;
};

async function requireStudyOwnership(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const rows = await db
    .select()
    .from(causalStudies)
    .where(
      and(
        eq(causalStudies.id, input.studyId),
        eq(causalStudies.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  const study = rows[0] ?? null;

  if (!study) {
    throw new Error("Causal study not found.");
  }

  return study;
}

export async function listDatasetCatalogForOrganization(organizationId: string) {
  const db = await getAppDatabase();
  const datasetRows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.organizationId, organizationId))
    .orderBy(asc(datasets.displayName));

  const versionRows = await db
    .select()
    .from(datasetVersions)
    .where(eq(datasetVersions.organizationId, organizationId))
    .orderBy(desc(datasetVersions.versionNumber), desc(datasetVersions.createdAt));

  const versionsByDatasetId = new Map<string, StudyDatasetCatalogItem["versions"]>();

  for (const version of versionRows) {
    const existing = versionsByDatasetId.get(version.datasetId) ?? [];
    existing.push({
      contentHash: version.contentHash,
      createdAt: version.createdAt,
      id: version.id,
      ingestionStatus: version.ingestionStatus,
      profileStatus: version.profileStatus,
      rowCount: version.rowCount,
      versionNumber: version.versionNumber,
    });
    versionsByDatasetId.set(version.datasetId, existing);
  }

  return datasetRows.map((dataset) => ({
    accessScope: dataset.accessScope,
    activeVersionId: dataset.activeVersionId,
    dataKind: dataset.dataKind,
    datasetKey: dataset.datasetKey,
    description: dataset.description,
    displayName: dataset.displayName,
    id: dataset.id,
    status: dataset.status,
    versions: versionsByDatasetId.get(dataset.id) ?? [],
  })) satisfies StudyDatasetCatalogItem[];
}

async function listStudyBindings(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const bindingRows = await db
    .select()
    .from(studyDatasetBindings)
    .where(
      and(
        eq(studyDatasetBindings.organizationId, input.organizationId),
        eq(studyDatasetBindings.studyId, input.studyId),
      ),
    )
    .orderBy(desc(studyDatasetBindings.isActive), asc(studyDatasetBindings.createdAt));

  const datasetRows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.organizationId, input.organizationId));
  const versionRows = await db
    .select()
    .from(datasetVersions)
    .where(eq(datasetVersions.organizationId, input.organizationId));

  const datasetById = new Map(datasetRows.map((dataset) => [dataset.id, dataset]));
  const versionById = new Map(versionRows.map((version) => [version.id, version]));

  return bindingRows
    .map((binding) => {
      const dataset = datasetById.get(binding.datasetId);
      if (!dataset) {
        return null;
      }

      const version = binding.datasetVersionId ? versionById.get(binding.datasetVersionId) ?? null : null;

      return {
        bindingNote: binding.bindingNote,
        bindingRole: binding.bindingRole,
        createdAt: binding.createdAt,
        dataset: {
          dataKind: dataset.dataKind,
          datasetKey: dataset.datasetKey,
          displayName: dataset.displayName,
          id: dataset.id,
          status: dataset.status,
        },
        datasetVersion: version
          ? {
              contentHash: version.contentHash,
              id: version.id,
              ingestionStatus: version.ingestionStatus,
              profileStatus: version.profileStatus,
              rowCount: version.rowCount,
              versionNumber: version.versionNumber,
            }
          : null,
        id: binding.id,
        isActive: binding.isActive,
        updatedAt: binding.updatedAt,
      } satisfies StudyDatasetBindingRecord;
    })
    .filter((value): value is StudyDatasetBindingRecord => value !== null);
}

export async function getPrimaryStudyDatasetSeedContract(input: {
  organizationId: string;
  studyId: string;
}) {
  const db = await getAppDatabase();
  const bindingRows = await db
    .select()
    .from(studyDatasetBindings)
    .where(
      and(
        eq(studyDatasetBindings.organizationId, input.organizationId),
        eq(studyDatasetBindings.studyId, input.studyId),
        eq(studyDatasetBindings.bindingRole, "primary"),
        eq(studyDatasetBindings.isActive, true),
      ),
    )
    .limit(1);

  const binding = bindingRows[0] ?? null;

  if (!binding?.datasetVersionId) {
    return null;
  }

  const datasetRows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.id, binding.datasetId))
    .limit(1);
  const versionRows = await db
    .select()
    .from(datasetVersions)
    .where(eq(datasetVersions.id, binding.datasetVersionId))
    .limit(1);
  const columnRows = await db
    .select()
    .from(datasetVersionColumns)
    .where(eq(datasetVersionColumns.datasetVersionId, binding.datasetVersionId))
    .orderBy(asc(datasetVersionColumns.columnOrder));

  const dataset = datasetRows[0] ?? null;
  const version = versionRows[0] ?? null;

  if (!dataset || !version) {
    return null;
  }

  return {
    bindingId: binding.id,
    columns: columnRows.map((column) => ({
      columnName: column.columnName,
      columnOrder: column.columnOrder,
      description: column.description,
      displayName: column.displayName,
      id: column.id,
      isOutcomeCandidate: column.isOutcomeCandidate,
      isTreatmentCandidate: column.isTreatmentCandidate,
      nullable: column.nullable,
      physicalType: column.physicalType,
      semanticType: column.semanticType,
    })),
    dataset: {
      datasetKey: dataset.datasetKey,
      displayName: dataset.displayName,
      id: dataset.id,
    },
    datasetVersion: {
      id: version.id,
      profileStatus: version.profileStatus,
      rowCount: version.rowCount,
      versionNumber: version.versionNumber,
    },
  } satisfies StudyPrimaryDatasetSeedContract;
}

export async function getStudyDatasetBindingReadiness(input: {
  organizationId: string;
  studyId: string;
}) {
  const bindings = await listStudyBindings(input);
  const activePrimaryBindings = bindings.filter(
    (binding) => binding.bindingRole === "primary" && binding.isActive,
  );
  const primaryBinding = activePrimaryBindings[0] ?? null;
  const reasons: string[] = [];

  if (activePrimaryBindings.length === 0) {
    reasons.push("Exactly one active primary dataset binding is required.");
  }

  if (activePrimaryBindings.length > 1) {
    reasons.push("Multiple active primary dataset bindings were found.");
  }

  if (primaryBinding && !primaryBinding.datasetVersion) {
    reasons.push("The active primary dataset binding must pin an exact dataset version.");
  }

  return {
    canApproveDag: reasons.length === 0,
    canCreateRun: reasons.length === 0,
    primaryBinding,
    reasons,
  } satisfies StudyDatasetBindingReadiness;
}

export async function assertStudyHasPinnedPrimaryDataset(input: {
  organizationId: string;
  studyId: string;
}) {
  const readiness = await getStudyDatasetBindingReadiness(input);

  if (!readiness.primaryBinding || readiness.reasons.length > 0 || !readiness.primaryBinding.datasetVersion) {
    throw new Error(readiness.reasons[0] ?? "A pinned primary dataset binding is required.");
  }

  return readiness.primaryBinding;
}

export async function getStudyDatasetBindingDetail(input: {
  organizationId: string;
  studyId: string;
}) {
  await requireStudyOwnership(input);

  const [catalog, bindings, readiness, seedContract] = await Promise.all([
    listDatasetCatalogForOrganization(input.organizationId),
    listStudyBindings(input),
    getStudyDatasetBindingReadiness(input),
    getPrimaryStudyDatasetSeedContract(input),
  ]);

  return {
    bindings,
    catalog,
    readiness,
    seedContract,
    studyId: input.studyId,
  } satisfies StudyDatasetBindingDetail;
}

export async function upsertStudyDatasetBinding(input: {
  bindingNote?: string | null;
  bindingRole: typeof studyDatasetBindings.$inferInsert.bindingRole;
  createdByUserId: string;
  datasetId: string;
  datasetVersionId?: string | null;
  isActive?: boolean;
  organizationId: string;
  studyId: string;
}) {
  await requireStudyOwnership({
    organizationId: input.organizationId,
    studyId: input.studyId,
  });

  const db = await getAppDatabase();
  const datasetRows = await db
    .select()
    .from(datasets)
    .where(
      and(
        eq(datasets.id, input.datasetId),
        eq(datasets.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const dataset = datasetRows[0] ?? null;

  if (!dataset) {
    throw new Error("Dataset not found.");
  }

  let datasetVersion: typeof datasetVersions.$inferSelect | null = null;

  if (input.datasetVersionId) {
    const versionRows = await db
      .select()
      .from(datasetVersions)
      .where(
        and(
          eq(datasetVersions.id, input.datasetVersionId),
          eq(datasetVersions.datasetId, input.datasetId),
          eq(datasetVersions.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    datasetVersion = versionRows[0] ?? null;

    if (!datasetVersion) {
      throw new Error("Dataset version not found for the selected dataset.");
    }
  }

  if (input.bindingRole === "primary" && !datasetVersion) {
    throw new Error("Primary dataset bindings must pin an exact dataset version.");
  }

  const now = Date.now();
  const isActive = input.isActive ?? true;

  await db.transaction((transaction) => {
    if (input.bindingRole === "primary" && isActive) {
      transaction
        .update(studyDatasetBindings)
        .set({
          isActive: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(studyDatasetBindings.studyId, input.studyId),
            eq(studyDatasetBindings.bindingRole, "primary"),
            eq(studyDatasetBindings.isActive, true),
          ),
        )
        .run();
    }

    const existing = transaction
      .select()
      .from(studyDatasetBindings)
      .where(
        and(
          eq(studyDatasetBindings.studyId, input.studyId),
          eq(studyDatasetBindings.datasetId, input.datasetId),
          eq(studyDatasetBindings.bindingRole, input.bindingRole),
        ),
      )
      .get();

    if (existing) {
      transaction
        .update(studyDatasetBindings)
        .set({
          bindingNote: input.bindingNote ?? null,
          datasetVersionId: datasetVersion?.id ?? null,
          isActive,
          updatedAt: now,
        })
        .where(eq(studyDatasetBindings.id, existing.id))
        .run();
      return;
    }

    transaction
      .insert(studyDatasetBindings)
      .values({
        id: randomUUID(),
        studyId: input.studyId,
        organizationId: input.organizationId,
        datasetId: input.datasetId,
        datasetVersionId: datasetVersion?.id ?? null,
        bindingRole: input.bindingRole,
        isActive,
        bindingNote: input.bindingNote ?? null,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });

  return getStudyDatasetBindingDetail({
    organizationId: input.organizationId,
    studyId: input.studyId,
  });
}
