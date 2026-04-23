import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "@/lib/app-db";
import {
  analysisComparisonSnapshots,
  analysisRecentComparisons,
  analysisRuns,
  analysisStudies,
} from "@/lib/app-schema";
import { normalizeAnalysisError } from "@/lib/analysis-error-normalization";

export async function listAnalysisComparisonSnapshotsForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    return db
      .select()
      .from(analysisComparisonSnapshots)
      .where(
        and(
          eq(analysisComparisonSnapshots.organizationId, input.organizationId),
          eq(analysisComparisonSnapshots.studyId, input.studyId),
          eq(analysisComparisonSnapshots.userId, input.userId),
        ),
      )
      .orderBy(desc(analysisComparisonSnapshots.pinned), desc(analysisComparisonSnapshots.updatedAt));
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to list analysis comparison snapshots.");
  }
}

export async function listAnalysisRecentComparisonsForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    return db
      .select()
      .from(analysisRecentComparisons)
      .where(
        and(
          eq(analysisRecentComparisons.organizationId, input.organizationId),
          eq(analysisRecentComparisons.studyId, input.studyId),
          eq(analysisRecentComparisons.userId, input.userId),
        ),
      )
      .orderBy(desc(analysisRecentComparisons.updatedAt));
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to list recent analysis comparisons.");
  }
}

export async function getAnalysisComparisonStateForStudy(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const [snapshots, recentComparisons] = await Promise.all([
      listAnalysisComparisonSnapshotsForStudy(input),
      listAnalysisRecentComparisonsForStudy(input),
    ]);

    return {
      recentComparisons,
      snapshots,
    };
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to load analysis comparison state.");
  }
}

async function assertStudyExists(input: { organizationId: string; studyId: string }) {
  const db = await getAppDatabase();
  const [study] = await db
    .select({ id: analysisStudies.id })
    .from(analysisStudies)
    .where(and(eq(analysisStudies.id, input.studyId), eq(analysisStudies.organizationId, input.organizationId)));

  if (!study) {
    throw new Error("Analysis study not found.");
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
    .select({ id: analysisRuns.id })
    .from(analysisRuns)
    .where(
      and(
        eq(analysisRuns.organizationId, input.organizationId),
        eq(analysisRuns.studyId, input.studyId),
        inArray(analysisRuns.id, [input.baseRunId, input.targetRunId]),
      ),
    );

  if (runs.length !== 2) {
    throw new Error("Comparison runs must belong to the current analysis study.");
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
  try {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error("Comparison snapshot name is required.");
    }

    await assertStudyExists({ organizationId: input.organizationId, studyId: input.studyId });
    await assertRunPairBelongsToStudy(input);

    const db = await getAppDatabase();
    const existing = await listAnalysisComparisonSnapshotsForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
    const matched = existing.find((snapshot) => snapshot.name.toLowerCase() === trimmedName.toLowerCase()) ?? null;
    const now = Date.now();

    if (matched) {
      await db
        .update(analysisComparisonSnapshots)
        .set({
          baseRunId: input.baseRunId,
          name: trimmedName,
          targetRunId: input.targetRunId,
          updatedAt: now,
        })
        .where(eq(analysisComparisonSnapshots.id, matched.id));
    } else {
      await db.insert(analysisComparisonSnapshots).values({
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

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to save analysis comparison snapshot.");
  }
}

export async function renameComparisonSnapshot(input: {
  name: string;
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error("Comparison snapshot name is required.");
    }

    const db = await getAppDatabase();
    const existing = await listAnalysisComparisonSnapshotsForStudy({
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
      .update(analysisComparisonSnapshots)
      .set({
        name: trimmedName,
        updatedAt: Date.now(),
      })
      .where(eq(analysisComparisonSnapshots.id, input.snapshotId));

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to rename analysis comparison snapshot.");
  }
}

export async function togglePinComparisonSnapshot(input: {
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    const existing = await listAnalysisComparisonSnapshotsForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
    const snapshot = existing.find((entry) => entry.id === input.snapshotId) ?? null;

    if (!snapshot) {
      throw new Error("Comparison snapshot not found.");
    }

    await db
      .update(analysisComparisonSnapshots)
      .set({
        pinned: !snapshot.pinned,
        updatedAt: Date.now(),
      })
      .where(eq(analysisComparisonSnapshots.id, input.snapshotId));

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to update analysis comparison snapshot.");
  }
}

export async function deleteComparisonSnapshot(input: {
  organizationId: string;
  snapshotId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    await db
      .delete(analysisComparisonSnapshots)
      .where(
        and(
          eq(analysisComparisonSnapshots.id, input.snapshotId),
          eq(analysisComparisonSnapshots.organizationId, input.organizationId),
          eq(analysisComparisonSnapshots.studyId, input.studyId),
          eq(analysisComparisonSnapshots.userId, input.userId),
        ),
      );

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to delete analysis comparison snapshot.");
  }
}

export async function recordRecentComparison(input: {
  baseRunId: string;
  organizationId: string;
  studyId: string;
  targetRunId: string;
  userId: string;
}) {
  try {
    await assertStudyExists({ organizationId: input.organizationId, studyId: input.studyId });
    await assertRunPairBelongsToStudy(input);

    const db = await getAppDatabase();
    const existing = await listAnalysisRecentComparisonsForStudy({
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
        .update(analysisRecentComparisons)
        .set({ updatedAt: now })
        .where(eq(analysisRecentComparisons.id, matched.id));
    } else {
      await db.insert(analysisRecentComparisons).values({
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

    const recents = await listAnalysisRecentComparisonsForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
    const overflowIds = recents.slice(8).map((entry) => entry.id);

    if (overflowIds.length) {
      await db.delete(analysisRecentComparisons).where(inArray(analysisRecentComparisons.id, overflowIds));
    }

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to track recent analysis comparison.");
  }
}

export async function deleteRecentComparison(input: {
  organizationId: string;
  recentComparisonId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    await db
      .delete(analysisRecentComparisons)
      .where(
        and(
          eq(analysisRecentComparisons.id, input.recentComparisonId),
          eq(analysisRecentComparisons.organizationId, input.organizationId),
          eq(analysisRecentComparisons.studyId, input.studyId),
          eq(analysisRecentComparisons.userId, input.userId),
        ),
      );

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to delete recent analysis comparison.");
  }
}

export async function clearRecentComparisons(input: {
  organizationId: string;
  studyId: string;
  userId: string;
}) {
  try {
    const db = await getAppDatabase();
    await db
      .delete(analysisRecentComparisons)
      .where(
        and(
          eq(analysisRecentComparisons.organizationId, input.organizationId),
          eq(analysisRecentComparisons.studyId, input.studyId),
          eq(analysisRecentComparisons.userId, input.userId),
        ),
      );

    return getAnalysisComparisonStateForStudy({
      organizationId: input.organizationId,
      studyId: input.studyId,
      userId: input.userId,
    });
  } catch (error) {
    throw normalizeAnalysisError(error, "Failed to clear recent analysis comparisons.");
  }
}
