import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  causalComparisonSnapshots,
  causalRecentComparisons,
  causalRuns,
  causalStudies,
} from "@/lib/app-schema";

export async function listComparisonSnapshotsForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(causalComparisonSnapshots)
    .where(
      and(
        eq(causalComparisonSnapshots.organizationId, input.organizationId),
        eq(causalComparisonSnapshots.studyId, input.studyId),
        eq(causalComparisonSnapshots.userId, input.userId),
      ),
    )
    .orderBy(desc(causalComparisonSnapshots.pinned), desc(causalComparisonSnapshots.updatedAt));
}

export async function listRecentComparisonsForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  return db
    .select()
    .from(causalRecentComparisons)
    .where(
      and(
        eq(causalRecentComparisons.organizationId, input.organizationId),
        eq(causalRecentComparisons.studyId, input.studyId),
        eq(causalRecentComparisons.userId, input.userId),
      ),
    )
    .orderBy(desc(causalRecentComparisons.updatedAt));
}

export async function getComparisonStateForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  const [snapshots, recentComparisons] = await Promise.all([
    listComparisonSnapshotsForStudy(input),
    listRecentComparisonsForStudy(input),
  ]);

  return {
    recentComparisons,
    snapshots,
  };
}

async function assertStudyExists(input: { organizationId: string; studyId: string }) {
  const db = await getAppDatabase();
  const [study] = await db
    .select({ id: causalStudies.id })
    .from(causalStudies)
    .where(and(eq(causalStudies.id, input.studyId), eq(causalStudies.organizationId, input.organizationId)));

  if (!study) {
    throw new Error("Causal study not found.");
  }
}

async function assertRunPairBelongsToStudy(input: {
  baseRunId: string;
  organizationId: string;
  studyId: string;
  targetRunId: string;
}) {
  const db = await getAppDatabase();
  const runs = await db
    .select({ id: causalRuns.id })
    .from(causalRuns)
    .where(
      and(
        eq(causalRuns.organizationId, input.organizationId),
        eq(causalRuns.studyId, input.studyId),
        inArray(causalRuns.id, [input.baseRunId, input.targetRunId]),
      ),
    );

  if (runs.length !== 2) {
    throw new Error("Comparison runs must belong to the current causal study.");
  }
}

export async function saveComparisonSnapshot(input: {
  baseRunId: string;
  name: string;
  organizationId: string;
  studyId: string;
  targetRunId: string;
  userId: string;
}) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Comparison snapshot name is required.");
  }

  await assertStudyExists({ organizationId: input.organizationId, studyId: input.studyId });
  await assertRunPairBelongsToStudy(input);

  const db = await getAppDatabase();
  const existing = await listComparisonSnapshotsForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
  const matched = existing.find((snapshot) => snapshot.name.toLowerCase() === trimmedName.toLowerCase()) ?? null;
  const now = Date.now();

  if (matched) {
    await db
      .update(causalComparisonSnapshots)
      .set({
        baseRunId: input.baseRunId,
        name: trimmedName,
        targetRunId: input.targetRunId,
        updatedAt: now,
      })
      .where(eq(causalComparisonSnapshots.id, matched.id));
  } else {
    await db.insert(causalComparisonSnapshots).values({
      baseRunId: input.baseRunId,
      createdAt: now,
      id: randomUUID(),
      name: trimmedName,
      organizationId: input.organizationId,
      pinned: false,
      studyId: input.studyId,
      targetRunId: input.targetRunId,
      updatedAt: now,
      userId: input.userId,
    });
  }

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function renameComparisonSnapshot(input: {
  name: string;
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Comparison snapshot name is required.");
  }

  const db = await getAppDatabase();
  const existing = await listComparisonSnapshotsForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
  const snapshot = existing.find((entry) => entry.id === input.snapshotId) ?? null;

  if (!snapshot) {
    throw new Error("Comparison snapshot not found.");
  }

  const conflicting = existing.find(
    (entry) => entry.id !== input.snapshotId && entry.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  if (conflicting) {
    throw new Error("A comparison snapshot with that name already exists.");
  }

  await db
    .update(causalComparisonSnapshots)
    .set({
      name: trimmedName,
      updatedAt: Date.now(),
    })
    .where(eq(causalComparisonSnapshots.id, input.snapshotId));

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function togglePinComparisonSnapshot(input: {
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  const existing = await listComparisonSnapshotsForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
  const snapshot = existing.find((entry) => entry.id === input.snapshotId) ?? null;

  if (!snapshot) {
    throw new Error("Comparison snapshot not found.");
  }

  await db
    .update(causalComparisonSnapshots)
    .set({
      pinned: !snapshot.pinned,
      updatedAt: Date.now(),
    })
    .where(eq(causalComparisonSnapshots.id, input.snapshotId));

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function deleteComparisonSnapshot(input: {
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  await db
    .delete(causalComparisonSnapshots)
    .where(
      and(
        eq(causalComparisonSnapshots.id, input.snapshotId),
        eq(causalComparisonSnapshots.organizationId, input.organizationId),
        eq(causalComparisonSnapshots.studyId, input.studyId),
        eq(causalComparisonSnapshots.userId, input.userId),
      ),
    );

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function recordRecentComparison(input: {
  baseRunId: string;
  organizationId: string;
  studyId: string;
  targetRunId: string;
  userId: string;
}) {
  await assertStudyExists({ organizationId: input.organizationId, studyId: input.studyId });
  await assertRunPairBelongsToStudy(input);

  const db = await getAppDatabase();
  const existing = await listRecentComparisonsForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
  const matched = existing.find(
    (entry) => entry.baseRunId === input.baseRunId && entry.targetRunId === input.targetRunId,
  ) ?? null;
  const now = Date.now();

  if (matched) {
    await db
      .update(causalRecentComparisons)
      .set({ updatedAt: now })
      .where(eq(causalRecentComparisons.id, matched.id));
  } else {
    await db.insert(causalRecentComparisons).values({
      baseRunId: input.baseRunId,
      createdAt: now,
      id: randomUUID(),
      organizationId: input.organizationId,
      studyId: input.studyId,
      targetRunId: input.targetRunId,
      updatedAt: now,
      userId: input.userId,
    });
  }

  const recents = await listRecentComparisonsForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
  const overflowIds = recents.slice(8).map((entry) => entry.id);

  if (overflowIds.length) {
    await db.delete(causalRecentComparisons).where(inArray(causalRecentComparisons.id, overflowIds));
  }

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function deleteRecentComparison(input: {
  organizationId: string;
  recentComparisonId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  await db
    .delete(causalRecentComparisons)
    .where(
      and(
        eq(causalRecentComparisons.id, input.recentComparisonId),
        eq(causalRecentComparisons.organizationId, input.organizationId),
        eq(causalRecentComparisons.studyId, input.studyId),
        eq(causalRecentComparisons.userId, input.userId),
      ),
    );

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}

export async function clearRecentComparisons(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  const db = await getAppDatabase();
  await db
    .delete(causalRecentComparisons)
    .where(
      and(
        eq(causalRecentComparisons.organizationId, input.organizationId),
        eq(causalRecentComparisons.studyId, input.studyId),
        eq(causalRecentComparisons.userId, input.userId),
      ),
    );

  return getComparisonStateForStudy({
    organizationId: input.organizationId,
    studyId: input.studyId,
    userId: input.userId,
  });
}
